const express  = require('express');
const path     = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const AlexaRemote = require('alexa-remote2');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

let db;

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable is not set');
  const client = new MongoClient(uri);
  await client.connect();
  db = client.db('homedb');
  console.log('Connected to MongoDB');
  await seedUsers();
}

// Seed zq1 and dar0 users from env vars on first run
async function seedUsers() {
  for (const [username, envKey] of [['zq1','ZQ1_PASSWORD'],['dar0','DAR0_PASSWORD']]) {
    const pw = process.env[envKey];
    if (!pw) continue;
    if (!await db.collection('users').findOne({ username })) {
      await db.collection('users').insertOne({ username, passwordHash: bcrypt.hashSync(pw, 10) });
      console.log(`Seeded user: ${username}`);
    }
  }
}

// ── Auth middleware ─────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function optionalAuth(req, _res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) try { req.user = jwt.verify(token, JWT_SECRET); } catch {}
  next();
}

// ============================================================
// AUTH ENDPOINTS
// ============================================================

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.collection('users').findOne({ username });
    if (!user || !bcrypt.compareSync(password, user.passwordHash))
      return res.status(401).json({ error: 'Invalid username or password' });
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

// ============================================================
// ITEMS
// ============================================================

// ── GET all items (optional ?room= and ?location= filters) ─
app.get('/api/items', optionalAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.room)     filter.room     = req.query.room;
    if (req.query.location) filter.location = req.query.location;

    if (req.user) {
      // Logged in: public items + own private items
      filter.$or = [
        { visibility: { $ne: 'private' } },
        { visibility: 'private', owner: req.user.username },
      ];
    } else {
      // Guest: public only (missing visibility = public)
      filter.$or = [{ visibility: { $ne: 'private' } }];
    }

    const items = await db.collection('items').find(filter).toArray();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST new item ──────────────────────────────────────────
app.post('/api/items', optionalAuth, async (req, res) => {
  try {
    const item = { ...req.body, addedDate: new Date().toISOString() };
    if (!req.user) {
      // Guest: always public, no owner
      item.visibility = 'public';
      item.owner = null;
    } else {
      item.visibility = item.visibility || 'public';
      item.owner = item.visibility === 'private' ? req.user.username : null;
    }
    const result = await db.collection('items').insertOne(item);
    res.json({ ...item, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT update item ────────────────────────────────────────
app.put('/api/items/:id', requireAuth, async (req, res) => {
  try {
    const existing = await db.collection('items').findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.owner && existing.owner !== req.user.username)
      return res.status(403).json({ error: 'Not your item' });

    const { _id, ...updates } = req.body;
    if (updates.visibility === 'private') updates.owner = req.user.username;
    else if (updates.visibility === 'public') updates.owner = null;

    await db.collection('items').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updates }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE item ────────────────────────────────────────────
app.delete('/api/items/:id', requireAuth, async (req, res) => {
  try {
    const existing = await db.collection('items').findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.owner && existing.owner !== req.user.username)
      return res.status(403).json({ error: 'Not your item' });

    await db.collection('items').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST bulk import ───────────────────────────────────────
app.post('/api/items/bulk', optionalAuth, async (req, res) => {
  try {
    const now = new Date().toISOString();
    const items = req.body.items.map(item => {
      const out = { ...item, addedDate: now };
      if (!req.user) {
        out.visibility = 'public';
        out.owner = null;
      } else {
        out.visibility = out.visibility || 'public';
        out.owner = out.visibility === 'private' ? req.user.username : null;
      }
      return out;
    });
    const result = await db.collection('items').insertMany(items);
    res.json({ inserted: result.insertedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ALEXA (alexa-remote2 proxy — credentials stay server-side)
// ============================================================
let alexa = null;
let alexaReady = false;
let alexaError = null;

function initAlexa() {
  const email    = process.env.AMAZON_EMAIL;
  const password = process.env.AMAZON_PASSWORD;
  if (!email || !password) {
    console.log('Alexa: AMAZON_EMAIL / AMAZON_PASSWORD not set — skipping');
    return;
  }

  alexa = new AlexaRemote();
  alexa.init({
    email,
    password,
    cookieRefreshInterval: 7 * 24 * 60 * 60 * 1000,
    alexaServiceHost: 'alexa.amazon.com',
    amazonPage:       'amazon.com',
    acceptLanguage:   'en-US',
    useWsMqtt:        false,
  }, (err) => {
    if (err) {
      console.error('Alexa init error:', err.message || err);
      alexaError = err.message || String(err);
      alexaReady = false;
    } else {
      console.log('Alexa connected');
      alexaReady = true;
      alexaError = null;
    }
  });
}

// ── GET status ─────────────────────────────────────────────
app.get('/api/alexa/status', requireAuth, (_req, res) => {
  res.json({
    ready:      alexaReady,
    error:      alexaError,
    configured: !!(process.env.AMAZON_EMAIL && process.env.AMAZON_PASSWORD),
  });
});

// ── GET devices ────────────────────────────────────────────
app.get('/api/alexa/devices', requireAuth, (_req, res) => {
  if (!alexaReady || !alexa) {
    return res.status(503).json({ error: alexaError || 'Alexa not initialised.' });
  }
  alexa.getSmarthomeDevices((err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

// ── POST command (on / off) ────────────────────────────────
app.post('/api/alexa/devices/:entityId/command', requireAuth, (req, res) => {
  if (!alexaReady || !alexa) {
    return res.status(503).json({ error: 'Alexa not initialised' });
  }
  const { command } = req.body;
  const { entityId } = req.params;
  const operationName = command === 'on' ? 'TurnOn' : 'TurnOff';

  alexa.executeSmarthomeDeviceOperation({
    entityId,
    entityType: 'APPLIANCE',
    operationRequest: {
      nspace:        'Alexa.PowerController',
      operationName,
      entityId,
    },
  }, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ============================================================
// NFC TAGS  (all require login)
// ============================================================

app.get('/api/nfc', requireAuth, async (_req, res) => {
  try {
    const tags = await db.collection('nfc_tags').find().toArray();
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/nfc/:tagId', requireAuth, async (req, res) => {
  try {
    const tag = await db.collection('nfc_tags').findOne({ tagId: req.params.tagId });
    if (!tag) return res.status(404).json({ error: 'Not found' });
    res.json(tag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/nfc', requireAuth, async (req, res) => {
  try {
    const tag = { ...req.body, registeredAt: new Date().toISOString() };
    await db.collection('nfc_tags').insertOne(tag);
    res.json(tag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/nfc/:tagId', requireAuth, async (req, res) => {
  try {
    const { _id, tagId, registeredAt, ...updates } = req.body;
    await db.collection('nfc_tags').updateOne(
      { tagId: req.params.tagId },
      { $set: updates }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/nfc/:tagId', requireAuth, async (req, res) => {
  try {
    await db.collection('nfc_tags').deleteOne({ tagId: req.params.tagId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Catch-all (must be AFTER API routes) ──────────────────
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Start ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
connectDB()
  .then(() => {
    initAlexa();
    app.listen(PORT, () => console.log(`Listening on ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
