const express = require('express');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const AlexaRemote = require('alexa-remote2');

const app = express();
app.use(express.json({ limit: '10mb' })); // support base64 images
app.use(express.static(path.join(__dirname)));

let db;

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable is not set');
  const client = new MongoClient(uri);
  await client.connect();
  db = client.db('homedb');
  console.log('Connected to MongoDB');
}

// ── GET all items (optional ?room= and ?location= filters) ─
app.get('/api/items', async (req, res) => {
  try {
    const filter = {};
    if (req.query.room)     filter.room     = req.query.room;
    if (req.query.location) filter.location = req.query.location;
    const items = await db.collection('items').find(filter).toArray();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST new item ──────────────────────────────────────────
app.post('/api/items', async (req, res) => {
  try {
    const item = { ...req.body, addedDate: new Date().toISOString() };
    const result = await db.collection('items').insertOne(item);
    res.json({ ...item, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT update item ────────────────────────────────────────
app.put('/api/items/:id', async (req, res) => {
  try {
    const { _id, ...updates } = req.body;
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
app.delete('/api/items/:id', async (req, res) => {
  try {
    await db.collection('items').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST bulk import ───────────────────────────────────────
app.post('/api/items/bulk', async (req, res) => {
  try {
    const items = req.body.items.map(item => ({ ...item, addedDate: new Date().toISOString() }));
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
    cookieRefreshInterval: 7 * 24 * 60 * 60 * 1000, // refresh every 7 days
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
app.get('/api/alexa/status', (_req, res) => {
  res.json({
    ready:      alexaReady,
    error:      alexaError,
    configured: !!(process.env.AMAZON_EMAIL && process.env.AMAZON_PASSWORD),
  });
});

// ── GET devices ────────────────────────────────────────────
app.get('/api/alexa/devices', (_req, res) => {
  if (!alexaReady || !alexa) {
    return res.status(503).json({ error: alexaError || 'Alexa not initialised. Set AMAZON_EMAIL and AMAZON_PASSWORD on the server.' });
  }
  alexa.getSmarthomeDevices((err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result); // { devices: [...] }
  });
});

// ── POST command (on / off) ────────────────────────────────
app.post('/api/alexa/devices/:entityId/command', (req, res) => {
  if (!alexaReady || !alexa) {
    return res.status(503).json({ error: 'Alexa not initialised' });
  }
  const { command } = req.body; // 'on' | 'off'
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
// NFC TAGS
// ============================================================

// ── GET all tags ───────────────────────────────────────────
app.get('/api/nfc', async (_req, res) => {
  try {
    const tags = await db.collection('nfc_tags').find().toArray();
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET single tag ─────────────────────────────────────────
app.get('/api/nfc/:tagId', async (req, res) => {
  try {
    const tag = await db.collection('nfc_tags').findOne({ tagId: req.params.tagId });
    if (!tag) return res.status(404).json({ error: 'Not found' });
    res.json(tag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST register tag ──────────────────────────────────────
app.post('/api/nfc', async (req, res) => {
  try {
    const tag = { ...req.body, registeredAt: new Date().toISOString() };
    await db.collection('nfc_tags').insertOne(tag);
    res.json(tag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT update tag ─────────────────────────────────────────
app.put('/api/nfc/:tagId', async (req, res) => {
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

// ── DELETE tag ─────────────────────────────────────────────
app.delete('/api/nfc/:tagId', async (req, res) => {
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
