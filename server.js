const express  = require('express');
const path     = require('path');
const crypto   = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function getMailTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

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
  for (const [username, pwKey, emailKey] of [
    ['zq1',  'ZQ1_PASSWORD',  'ZQ1_EMAIL'],
    ['dar0', 'DAR0_PASSWORD', 'DAR0_EMAIL'],
  ]) {
    const pw    = process.env[pwKey];
    const email = process.env[emailKey];
    const existing = await db.collection('users').findOne({ username });
    if (!existing) {
      if (!pw) continue;
      await db.collection('users').insertOne({
        username,
        passwordHash: bcrypt.hashSync(pw, 10),
        email: email || null,
      });
      console.log(`Seeded user: ${username}`);
    } else if (email && !existing.email) {
      // Backfill email if added later
      await db.collection('users').updateOne({ username }, { $set: { email } });
      console.log(`Backfilled email for user: ${username}`);
    } else {
      console.log(`User ${username} exists, email in DB: ${existing.email || '(none)'}`);
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

// POST /api/auth/forgot  — send password-reset email
app.post('/api/auth/forgot', async (req, res) => {
  try {
    const { username } = req.body;
    const user = await db.collection('users').findOne({ username });
    if (!user) { console.log(`[forgot] no user found: ${username}`); return res.json({ ok: true }); }
    if (!user.email) { console.log(`[forgot] user ${username} has no email in DB`); return res.json({ ok: true }); }

    const rawToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires   = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.collection('users').updateOne(
      { username },
      { $set: { resetToken: tokenHash, resetExpires: expires } }
    );

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const link   = `${appUrl}/pages/reset-password.html?token=${rawToken}`;

    const transporter = getMailTransporter();
    if (!transporter) {
      console.log(`[forgot] GMAIL_USER/GMAIL_APP_PASSWORD not set — reset link for ${username}: ${link}`);
    } else {
      console.log(`[forgot] sending email to ${user.email} for ${username}`);
      await transporter.sendMail({
        to:      user.email,
        from:    process.env.GMAIL_USER,
        subject: 'Set your password — zq1 & dar0 Home',
        html: `
          <p>Hi ${username},</p>
          <p>Click the link below to set your password. It expires in 1 hour.</p>
          <p><a href="${link}">${link}</a></p>
          <p>If you didn't request this, ignore this email.</p>
        `,
      });
      console.log(`[forgot] email sent to ${user.email}`);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset  — validate token and save new password
app.post('/api/auth/reset', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'Invalid request' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await db.collection('users').findOne({
      resetToken:   tokenHash,
      resetExpires: { $gt: new Date() },
    });
    if (!user) return res.status(400).json({ error: 'Link is invalid or has expired' });

    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set:   { passwordHash: bcrypt.hashSync(newPassword, 10) },
        $unset: { resetToken: '', resetExpires: '' },
      }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
// GOVEE  (official Platform API — key stays server-side)
// ============================================================
// Govee publishes a real public API, so unlike Alexa this is a
// first-class integration: apply for a key in the Govee Home app
// (Profile → ⚙ Settings → "Apply for API Key"), paste it in the
// Smart Home settings, done. Key is stored in Mongo with an env
// fallback (GOVEE_API_KEY) for Heroku config vars.

const GOVEE_BASE    = 'https://openapi.api.govee.com/router/api/v1';
const GOVEE_CRED_ID = 'govee_credentials';

async function getGoveeKeyInfo() {
  try {
    const doc = await db.collection('settings').findOne({ _id: GOVEE_CRED_ID });
    if (doc?.apiKey) return { key: doc.apiKey, source: 'db' };
  } catch {}
  if (process.env.GOVEE_API_KEY) return { key: process.env.GOVEE_API_KEY, source: 'env' };
  return { key: null, source: null };
}

async function getGoveeKey() {
  return (await getGoveeKeyInfo()).key;
}

async function goveeFetch(apiKey, path, body) {
  const res = await fetch(GOVEE_BASE + path, {
    method:  body ? 'POST' : 'GET',
    headers: { 'Govee-API-Key': apiKey, 'Content-Type': 'application/json' },
    body:    body ? JSON.stringify(body) : undefined,
  });

  let json = null;
  try { json = JSON.parse(await res.text()); } catch {}

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('Govee rejected the API key.'), { status: 401 });
  }
  if (res.status === 429) {
    throw Object.assign(new Error('Govee rate limit reached — wait a minute and retry.'), { status: 429 });
  }
  if (!res.ok || (json && json.code && json.code !== 200)) {
    const detail = json?.message || json?.msg || `HTTP ${res.status}`;
    throw Object.assign(new Error(`Govee error: ${detail}`), { status: res.status });
  }
  return json || {};
}

// Normalise the capability list of a device from GET /user/devices
function goveeCaps(device) {
  const caps = device.capabilities || [];
  const has  = (type, instance) =>
    caps.some(c => c.type === `devices.capabilities.${type}` && c.instance === instance);
  return {
    onOff:      has('on_off', 'powerSwitch'),
    brightness: has('range', 'brightness'),
    color:      has('color_setting', 'colorRgb'),
  };
}

// Pull the values we care about out of a /device/state response
function goveeStateValues(payload) {
  const out = { online: null, on: null, brightness: null };
  for (const cap of payload?.capabilities || []) {
    const v = cap.state?.value;
    if (cap.type === 'devices.capabilities.online' && cap.instance === 'online') {
      out.online = v === true || v === 'true';
    } else if (cap.type === 'devices.capabilities.on_off' && cap.instance === 'powerSwitch') {
      out.on = v === 1 || v === '1' || v === true;
    } else if (cap.type === 'devices.capabilities.range' && cap.instance === 'brightness') {
      out.brightness = typeof v === 'number' ? v : null;
    }
  }
  return out;
}

// ── GET status ─────────────────────────────────────────────
app.get('/api/govee/status', requireAuth, async (_req, res) => {
  const info = await getGoveeKeyInfo();
  res.json({ configured: !!info.key, source: info.source });
});

// ── POST key — validate against Govee, then save ───────────
app.post('/api/govee/key', requireAuth, async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();
    if (!apiKey) return res.status(400).json({ error: 'Paste your Govee API key first.' });

    const result = await goveeFetch(apiKey, '/user/devices');
    const count  = (result.data || []).length;

    await db.collection('settings').updateOne(
      { _id: GOVEE_CRED_ID },
      { $set: { apiKey, updatedAt: new Date() } },
      { upsert: true },
    );
    res.json({ success: true, deviceCount: count });
  } catch (err) {
    res.status(err.status === 401 ? 400 : 502).json({ error: err.message });
  }
});

// ── DELETE key ─────────────────────────────────────────────
app.delete('/api/govee/key', requireAuth, async (_req, res) => {
  try {
    await db.collection('settings').deleteOne({ _id: GOVEE_CRED_ID });
    // A GOVEE_API_KEY config var keeps the connection alive regardless —
    // tell the client so it can explain instead of claiming disconnection
    res.json({ success: true, envFallback: !!process.env.GOVEE_API_KEY });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET devices (normalised) ───────────────────────────────
app.get('/api/govee/devices', requireAuth, async (_req, res) => {
  try {
    const key = await getGoveeKey();
    if (!key) return res.status(503).json({ error: 'Govee not connected.' });

    const result  = await goveeFetch(key, '/user/devices');
    const devices = (result.data || []).map(d => {
      const caps = goveeCaps(d);
      return {
        deviceId: d.device,
        sku:      d.sku,
        label:    d.deviceName || d.sku,
        type:     (d.type || '').replace('devices.types.', ''),
        supportsOnOff:      caps.onOff,
        supportsBrightness: caps.brightness,
        supportsColor:      caps.color,
      };
    });
    res.json({ devices });
  } catch (err) {
    res.status(err.status === 401 ? 401 : 502).json({ error: err.message });
  }
});

// ── POST state — current values for one device ─────────────
// (POST because Govee device ids are MAC addresses with colons)
app.post('/api/govee/state', requireAuth, async (req, res) => {
  try {
    const key = await getGoveeKey();
    if (!key) return res.status(503).json({ error: 'Govee not connected.' });

    const { sku, device } = req.body || {};
    if (!sku || !device) return res.status(400).json({ error: 'sku and device are required' });

    const result = await goveeFetch(key, '/device/state', {
      requestId: crypto.randomUUID(),
      payload:   { sku, device },
    });
    res.json(goveeStateValues(result.payload));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST control — on/off, brightness ──────────────────────
app.post('/api/govee/control', requireAuth, async (req, res) => {
  try {
    const key = await getGoveeKey();
    if (!key) return res.status(503).json({ error: 'Govee not connected.' });

    const { sku, device, command } = req.body || {};
    if (!sku || !device || !command?.name) {
      return res.status(400).json({ error: 'sku, device and command.name are required' });
    }

    let capability;
    if (command.name === 'onoff') {
      capability = {
        type:     'devices.capabilities.on_off',
        instance: 'powerSwitch',
        value:    command.value ? 1 : 0,
      };
    } else if (command.name === 'brightness') {
      const v = Math.max(1, Math.min(100, Number(command.value) || 0));
      capability = {
        type:     'devices.capabilities.range',
        instance: 'brightness',
        value:    v,
      };
    } else {
      return res.status(400).json({ error: `Unknown command: ${command.name}` });
    }

    await goveeFetch(key, '/device/control', {
      requestId: crypto.randomUUID(),
      payload:   { sku, device, capability },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
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

// ============================================================
// CART  (per-user, requireAuth)
// ============================================================

app.get('/api/cart', requireAuth, async (req, res) => {
  try {
    const cart = await db.collection('carts').findOne({ username: req.user.username });
    res.json(cart ? cart.items : []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cart/items', requireAuth, async (req, res) => {
  try {
    const { name, qty = 1, note = '' } = req.body;
    const item = { id: crypto.randomUUID(), name, qty, note };
    await db.collection('carts').updateOne(
      { username: req.user.username },
      { $push: { items: item } },
      { upsert: true }
    );
    res.json(item);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/cart/items/:id', requireAuth, async (req, res) => {
  try {
    await db.collection('carts').updateOne(
      { username: req.user.username },
      { $pull: { items: { id: req.params.id } } }
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/cart', requireAuth, async (req, res) => {
  try {
    await db.collection('carts').updateOne(
      { username: req.user.username },
      { $set: { items: [] } }
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// SHOPPING LISTS  (requireAuth)
// ============================================================

app.get('/api/shopping-lists', requireAuth, async (_req, res) => {
  try {
    const lists = await db.collection('shopping_lists').find().sort({ createdAt: -1 }).toArray();
    res.json(lists);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shopping-lists', requireAuth, async (req, res) => {
  try {
    const list = {
      items:       req.body.items || [],
      createdBy:   req.user.username,
      createdAt:   new Date().toISOString(),
      completed:   false,
      completedAt: null,
    };
    const result = await db.collection('shopping_lists').insertOne(list);
    res.json({ ...list, _id: result.insertedId });

    // Fire-and-forget: email the creator their list
    (async () => {
      const transporter = getMailTransporter();
      if (!transporter) return;
      const creator = await db.collection('users').findOne({ username: req.user.username });
      if (!creator?.email) return;
      const itemsHtml = list.items.map(i =>
        `<li>${i.name} ×${i.qty}${i.isLowStock ? ' <em>(low stock)</em>' : ''}</li>`
      ).join('');
      await transporter.sendMail({
        from: process.env.GMAIL_USER,
        to: creator.email,
        subject: 'Your shopping list is ready!',
        html: `<h2>Ready to shop!</h2><p>Hi <strong>${req.user.username}</strong>, your list has been generated:</p><ul>${itemsHtml}</ul><p>Happy shopping!</p>`,
      });
    })().catch(err => console.error('[shopping-list-email]', err));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function buildCSV(pricedItems, total) {
  const rows = ['"Item","Qty","Unit Price","Line Total"'];
  for (const it of pricedItems) {
    rows.push(`"${it.name}",${it.qty},${Number(it.unitPrice || 0).toFixed(2)},${Number(it.lineTotal || 0).toFixed(2)}`);
  }
  rows.push(`"Grand Total",,,${Number(total).toFixed(2)}`);
  return rows.join('\r\n');
}

app.post('/api/shopping-lists/:id/complete', requireAuth, async (req, res) => {
  try {
    const { mode, pricedItems, totalAmount, splitWith, splitAmounts, receipt } = req.body;
    const list = await db.collection('shopping_lists').findOne({ _id: new ObjectId(req.params.id) });
    if (!list) return res.status(404).json({ error: 'Not found' });

    // Mark list complete
    await db.collection('shopping_lists').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { completed: true, completedAt: new Date().toISOString() } }
    );

    // Create bill record
    const today = new Date().toISOString().slice(0, 10);
    const listDate = new Date(list.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    await db.collection('bills').insertOne({
      name: `Shopping (${listDate})`,
      amount: Number(totalAmount) || 0,
      dueDate: today,
      recurrence: 'none',
      paid: true,
      paidAt: new Date().toISOString(),
      owner: 'shared',
      createdAt: new Date().toISOString(),
      splitWith: splitWith || [],
      splitAmounts: splitAmounts || {},
      fromShoppingList: req.params.id,
    });

    res.json({ success: true });

    // Fire-and-forget: email each person their share
    (async () => {
      const transporter = getMailTransporter();
      if (!transporter) return;

      // Build CSV for bot-assist mode
      const csvContent = (mode === 'bot' && pricedItems?.length)
        ? buildCSV(pricedItems, totalAmount)
        : null;

      // Build items HTML for email body
      const itemsHtml = (mode === 'bot' && pricedItems?.length)
        ? pricedItems.map(i =>
            `<tr><td>${i.name}</td><td style="text-align:center">${i.qty}</td><td style="text-align:right">$${Number(i.unitPrice||0).toFixed(2)}</td><td style="text-align:right">$${Number(i.lineTotal||0).toFixed(2)}</td></tr>`
          ).join('')
        : list.items.map(i =>
            `<tr><td>${i.name}</td><td style="text-align:center">${i.qty}</td><td colspan="2" style="color:#aaa">—</td></tr>`
          ).join('');

      const itemTableHeader = `<tr style="background:#f5f5f5"><th style="text-align:left;padding:4px 8px">Item</th><th style="padding:4px 8px">Qty</th><th style="padding:4px 8px">Unit $</th><th style="padding:4px 8px">Total</th></tr>`;

      for (const username of (splitWith || [])) {
        const user = await db.collection('users').findOne({ username });
        if (!user?.email) { console.log(`[shopping-complete] no email for ${username}`); continue; }
        const share = Number((splitAmounts || {})[username] || 0);

        const mailOpts = {
          from: process.env.GMAIL_USER,
          to: user.email,
          subject: `Shopping bill — your share: $${share.toFixed(2)}`,
          html: `<h2>Shopping Complete!</h2>
<p>Hi <strong>${username}</strong>, a shared shopping trip has been completed.</p>
<table style="border-collapse:collapse;margin:12px 0">
  <tr><td style="padding:4px 16px 4px 0;color:#666">Total</td><td><strong>$${Number(totalAmount||0).toFixed(2)}</strong></td></tr>
  <tr><td style="padding:4px 16px 4px 0;color:#666">Your share</td><td><strong style="color:#2e7d32">$${share.toFixed(2)}</strong></td></tr>
  <tr><td style="padding:4px 16px 4px 0;color:#666">Logged by</td><td>${req.user.username}</td></tr>
</table>
<p><strong>Items purchased:</strong></p>
<table style="border-collapse:collapse;width:100%;font-size:0.9rem">${itemTableHeader}${itemsHtml}</table>
${csvContent ? '<p style="color:#888;font-size:0.8rem">A CSV breakdown is attached.</p>' : ''}`,
          attachments: [],
        };

        if (receipt) {
          const m = receipt.match(/^data:(image\/\w+);base64,(.+)$/);
          if (m) mailOpts.attachments.push({ filename: 'receipt.jpg', content: m[2], encoding: 'base64', contentType: m[1] });
        }
        if (csvContent) {
          mailOpts.attachments.push({ filename: 'shopping.csv', content: csvContent, contentType: 'text/csv' });
        }

        await transporter.sendMail(mailOpts).catch(err => console.error(`[shopping-complete] email to ${username}:`, err));
      }
    })().catch(err => console.error('[shopping-complete]', err));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/shopping-lists/:id', requireAuth, async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.completed && !updates.completedAt) updates.completedAt = new Date().toISOString();
    if (!updates.completed) updates.completedAt = null;
    await db.collection('shopping_lists').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updates }
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/shopping-lists/:id', requireAuth, async (req, res) => {
  try {
    await db.collection('shopping_lists').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// BILLS  (requireAuth)
// ============================================================

app.get('/api/bills', requireAuth, async (_req, res) => {
  try {
    const bills = await db.collection('bills').find().sort({ dueDate: 1 }).toArray();
    res.json(bills);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/bills', requireAuth, async (req, res) => {
  try {
    const bill = { ...req.body, createdAt: new Date().toISOString() };
    const result = await db.collection('bills').insertOne(bill);
    res.json({ ...bill, _id: result.insertedId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/bills/:id', requireAuth, async (req, res) => {
  try {
    const { _id, ...updates } = req.body;
    const currentBill = await db.collection('bills').findOne({ _id: new ObjectId(req.params.id) });

    // Reset reminderSent if amount or dueDate changes so reminder fires again
    if ('amount' in updates || 'dueDate' in updates) updates.reminderSent = false;

    await db.collection('bills').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updates }
    );

    // Auto-create next cycle when a recurring bill is first marked paid
    if (updates.paid && currentBill?.recurrence && currentBill.recurrence !== 'none' && !currentBill.paid) {
      const nextDue = new Date(currentBill.dueDate + 'T00:00:00');
      if (currentBill.recurrence === 'monthly') nextDue.setMonth(nextDue.getMonth() + 1);
      else nextDue.setFullYear(nextDue.getFullYear() + 1);
      await db.collection('bills').insertOne({
        name:         currentBill.name,
        amount:       currentBill.amount,   // carries over as starting point; user can edit
        dueDate:      nextDue.toISOString().slice(0, 10),
        recurrence:   currentBill.recurrence,
        paid:         false,
        paidAt:       null,
        owner:        currentBill.owner,
        createdAt:    new Date().toISOString(),
        splitWith:    currentBill.splitWith    || [],
        splitAmounts: currentBill.splitAmounts || {},
        reminderDays: currentBill.reminderDays,
        reminderSent: false,
      });
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/bills/:id', requireAuth, async (req, res) => {
  try {
    await db.collection('bills').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Bill reminder scheduler ────────────────────────────────
async function sendBillReminderEmail(bill, daysLeft) {
  const transporter = getMailTransporter();
  if (!transporter) return;
  const targets = bill.splitWith?.length ? bill.splitWith
    : bill.owner !== 'shared' ? [bill.owner] : [];
  for (const username of targets) {
    const user = await db.collection('users').findOne({ username });
    if (!user?.email) continue;
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to:   user.email,
      subject: `Reminder: "${bill.name}" due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
      html: `<h2>Bill Reminder</h2>
<p>Hi <strong>${username}</strong>,</p>
<p>Your <strong>${bill.recurrence}</strong> bill <strong>"${bill.name}"</strong> is due in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>.</p>
<table style="border-collapse:collapse;margin:12px 0">
  <tr><td style="padding:4px 16px 4px 0;color:#666">Due date</td><td>${bill.dueDate}</td></tr>
  <tr><td style="padding:4px 16px 4px 0;color:#666">Amount</td><td><strong>$${Number(bill.amount||0).toFixed(2)}</strong> <em style="color:#888">(update if changed this cycle)</em></td></tr>
  <tr><td style="padding:4px 16px 4px 0;color:#666">Recurrence</td><td>${bill.recurrence}</td></tr>
</table>
<p>Please update the amount on the Bills page if it has changed, then mark it as paid when done.</p>`,
    }).catch(err => console.error(`[bill-reminder] ${username}:`, err));
  }
}

async function checkBillReminders() {
  try {
    const today  = new Date();
    today.setHours(0, 0, 0, 0);
    const bills  = await db.collection('bills').find({
      paid:         false,
      recurrence:   { $ne: 'none' },
      reminderDays: { $gt: 0 },
      reminderSent: { $ne: true },
    }).toArray();
    for (const bill of bills) {
      const due      = new Date(bill.dueDate + 'T00:00:00');
      const daysLeft = Math.ceil((due - today) / 86400000);
      if (daysLeft >= 0 && daysLeft <= (bill.reminderDays || 3)) {
        console.log(`[bill-reminder] sending for "${bill.name}", due in ${daysLeft}d`);
        await sendBillReminderEmail(bill, daysLeft);
        await db.collection('bills').updateOne({ _id: bill._id }, { $set: { reminderSent: true } });
      }
    }
  } catch (err) { console.error('[bill-reminder] check error:', err.message); }
}

// ============================================================
// CALENDAR — Google Calendar ICS proxy
// ============================================================
// The browser can't fetch an .ics feed directly (Google sends no CORS
// headers), so we fetch + parse server-side and hand back plain JSON.
// That's what lets the room pages render a native calendar instead of a
// fixed-width Google iframe that blows past the page boundary on a phone.

function icsUrlFor(src) {
  const value = String(src || '').trim();
  if (!value) throw new Error('No calendar source given.');

  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('Calendar URL must be https.');
    const host = url.hostname.toLowerCase();
    // Block anything that could point back at our own network
    if (/^(localhost|\[?::1\]?|0\.0\.0\.0)$/.test(host) ||
        /^(10|127|169\.254)\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
      throw new Error('That host is not allowed.');
    }
    // Google hands out webcal/basic.ics links — normalise the embed form too
    if (host.endsWith('google.com') && url.pathname.includes('/calendar/embed')) {
      const cid = url.searchParams.get('src');
      if (cid) return `https://calendar.google.com/calendar/ical/${encodeURIComponent(cid)}/public/basic.ics`;
    }
    return url.toString();
  }

  // Bare calendar id / gmail address → public ICS feed
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(value)}/public/basic.ics`;
}

// ── ICS parsing ────────────────────────────────────────────
function unfoldICS(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeICS(v) {
  return String(v || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// Offset (ms) of a named timezone at a given instant
function tzOffsetMs(utcMs, tz) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
    return asUTC - utcMs;
  } catch { return 0; }
}

// Wall-clock time in `tz` → real UTC instant
function zonedToUTC(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off   = tzOffsetMs(guess, tz);
  // One correction pass handles everything but the ambiguous DST hour
  return new Date(guess - off + (tzOffsetMs(guess - off, tz) - off));
}

// Returns the *naive* wall-clock time (encoded into a UTC Date) plus the zone
// it belongs to. Recurrences must be expanded on wall-clock, not on instants —
// otherwise a 9am weekly event silently becomes 8am when DST ends.
function parseICSDate(value, params, fallbackTz) {
  const v = String(value || '').trim();
  if (/^\d{8}$/.test(v)) {
    const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8);
    return { naive: new Date(Date.UTC(y, mo - 1, d)), tz: 'UTC', allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  return {
    naive:  new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)),
    tz:     z ? 'UTC' : (params.TZID || fallbackTz || 'UTC'),
    allDay: false,
  };
}

// naive wall-clock → real instant, and back
function naiveToReal(naive, tz) {
  if (tz === 'UTC') return new Date(naive.getTime());
  return zonedToUTC(
    naive.getUTCFullYear(), naive.getUTCMonth() + 1, naive.getUTCDate(),
    naive.getUTCHours(), naive.getUTCMinutes(), naive.getUTCSeconds(), tz,
  );
}

function realToNaive(real, tz) {
  if (tz === 'UTC') return new Date(real.getTime());
  return new Date(real.getTime() + tzOffsetMs(real.getTime(), tz));
}

function parseParams(rawKey) {
  const [name, ...rest] = rawKey.split(';');
  const params = {};
  for (const chunk of rest) {
    const eq = chunk.indexOf('=');
    if (eq > 0) params[chunk.slice(0, eq).toUpperCase()] = chunk.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params };
}

const WEEKDAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(raw) {
  const rule = {};
  for (const part of String(raw).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    rule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return rule;
}

// Expand a recurring event into concrete wall-clock starts inside [from, to].
// Everything here is naive wall-clock in the event's own zone; the caller
// converts back to real instants afterwards.
function expandRecurrence(start, rule, from, to, exdates, tz = 'UTC') {
  const out  = [];
  const freq = (rule.FREQ || '').toUpperCase();
  if (!freq) return [start];

  const interval = Math.max(1, parseInt(rule.INTERVAL, 10) || 1);
  const count    = rule.COUNT ? parseInt(rule.COUNT, 10) : null;

  // UNTIL is usually stamped in UTC — bring it into the event's wall clock
  let until = null;
  if (rule.UNTIL) {
    const parsed = parseICSDate(rule.UNTIL, {}, 'UTC');
    if (parsed) until = realToNaive(naiveToReal(parsed.naive, parsed.tz), tz);
  }
  const byDay    = rule.BYDAY
    ? rule.BYDAY.split(',').map(t => {
        const m = /^([+-]?\d)?([A-Z]{2})$/.exec(t.trim().toUpperCase());
        return m ? { nth: m[1] ? +m[1] : null, day: WEEKDAY_INDEX[m[2]] } : null;
      }).filter(x => x && x.day !== undefined)
    : null;
  const byMonthDay = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null;

  const skip = new Set((exdates || []).map(d => d.getTime()));
  const hardCap = 800;

  const push = (d) => {
    if (skip.has(d.getTime())) return true;
    if (until && d > until) return false;
    if (d >= from && d <= to) out.push(new Date(d));
    return true;
  };

  let emitted = 0;
  let cursor  = new Date(start);

  const stepCursor = () => {
    if (freq === 'DAILY')   cursor.setUTCDate(cursor.getUTCDate() + interval);
    if (freq === 'WEEKLY')  cursor.setUTCDate(cursor.getUTCDate() + 7 * interval);
    if (freq === 'MONTHLY') cursor.setUTCMonth(cursor.getUTCMonth() + interval);
    if (freq === 'YEARLY')  cursor.setUTCFullYear(cursor.getUTCFullYear() + interval);
  };

  for (let guard = 0; guard < hardCap; guard++) {
    if (cursor > to) break;
    if (count && emitted >= count) break;
    if (until && cursor > until) break;

    let instants = [];

    if (freq === 'WEEKLY' && byDay) {
      // Start of this ISO-ish week (Sunday), then pick the requested days
      const weekStart = new Date(cursor);
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      for (const { day } of byDay) {
        const d = new Date(weekStart);
        d.setUTCDate(weekStart.getUTCDate() + day);
        d.setUTCHours(start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), 0);
        if (d >= start) instants.push(d);
      }
    } else if (freq === 'MONTHLY' && byDay) {
      for (const { nth, day } of byDay) {
        const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1,
          start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
        const daysInMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
        const matches = [];
        for (let dd = 1; dd <= daysInMonth; dd++) {
          const d = new Date(first);
          d.setUTCDate(dd);
          if (d.getUTCDay() === day) matches.push(d);
        }
        if (!matches.length) continue;
        if (nth === null)     instants.push(...matches);
        else if (nth > 0)     matches[nth - 1] && instants.push(matches[nth - 1]);
        else                  matches[matches.length + nth] && instants.push(matches[matches.length + nth]);
      }
    } else if (freq === 'MONTHLY' && byMonthDay) {
      for (const dd of byMonthDay) {
        const d = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), dd,
          start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
        if (d.getUTCMonth() === cursor.getUTCMonth()) instants.push(d);
      }
    } else {
      instants = [new Date(cursor)];
    }

    instants.sort((a, b) => a - b);
    for (const d of instants) {
      if (d < start) continue;
      if (count && emitted >= count) break;
      if (!push(d)) return out;
      emitted++;
    }

    stepCursor();
  }

  return out;
}

function parseICS(text, from, to) {
  const lines  = unfoldICS(text).split('\n');
  const events = [];
  let calTz = 'UTC';
  let cur   = null;

  for (const line of lines) {
    if (line.startsWith('X-WR-TIMEZONE:')) { calTz = line.slice(14).trim() || 'UTC'; continue; }
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT')   { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const { name, params } = parseParams(line.slice(0, colon));
    const value = line.slice(colon + 1);

    switch (name) {
      case 'SUMMARY':     cur.title = unescapeICS(value); break;
      case 'DESCRIPTION': cur.description = unescapeICS(value); break;
      case 'LOCATION':    cur.location = unescapeICS(value); break;
      case 'UID':         cur.uid = value; break;
      case 'STATUS':      cur.status = value; break;
      case 'RRULE':       cur.rrule = parseRRule(value); break;
      case 'DTSTART': {
        const p = parseICSDate(value, params, calTz);
        if (p) { cur.start = p.naive; cur.tz = p.tz; cur.allDay = p.allDay; }
        break;
      }
      case 'DTEND': {
        const p = parseICSDate(value, params, calTz);
        if (p) cur.end = p.naive;
        break;
      }
      case 'EXDATE': {
        for (const chunk of value.split(',')) {
          const p = parseICSDate(chunk, params, calTz);
          if (p) cur.exdates.push(p.naive);
        }
        break;
      }
    }
  }

  const out = [];
  for (const ev of events) {
    if (!ev.start || ev.status === 'CANCELLED') continue;
    const tz = ev.tz || 'UTC';
    const durationMs = ev.end ? (ev.end - ev.start) : (ev.allDay ? 86400000 : 3600000);

    // Expand in wall-clock space over a padded window, then convert to real
    // instants and clip precisely — the padding covers the UTC offset.
    const pad       = 2 * 86400000;
    const fromNaive = realToNaive(new Date(from.getTime() - pad), tz);
    const toNaive   = realToNaive(new Date(to.getTime() + pad), tz);

    const naiveStarts = ev.rrule
      ? expandRecurrence(ev.start, ev.rrule, fromNaive, toNaive, ev.exdates, tz)
      : [ev.start];

    for (const naive of naiveStarts) {
      const s = naiveToReal(naive, tz);
      if (s < from || s > to) continue;
      out.push({
        uid:         ev.uid || null,
        title:       ev.title || '(no title)',
        description: ev.description || '',
        location:    ev.location || '',
        allDay:      !!ev.allDay,
        start:       s.toISOString(),
        end:         new Date(s.getTime() + durationMs).toISOString(),
        recurring:   !!ev.rrule,
      });
      if (out.length > 2000) break;
    }
    if (out.length > 2000) break;
  }

  out.sort((a, b) => new Date(a.start) - new Date(b.start));
  return out;
}

const calendarCache = new Map(); // icsUrl → { at, events }
const CALENDAR_TTL  = 5 * 60 * 1000;

app.get('/api/calendar', requireAuth, async (req, res) => {
  try {
    const icsUrl = icsUrlFor(req.query.src);

    const now  = Date.now();
    const from = req.query.from ? new Date(req.query.from) : new Date(now - 120 * 86400000);
    const to   = req.query.to   ? new Date(req.query.to)   : new Date(now + 400 * 86400000);

    const cacheKey = `${icsUrl}|${from.toISOString()}|${to.toISOString()}`;
    const hit = calendarCache.get(cacheKey);
    if (hit && now - hit.at < CALENDAR_TTL && !req.query.nocache) {
      return res.json({ events: hit.events, cached: true });
    }

    const resp = await fetch(icsUrl, {
      headers: { 'User-Agent': 'zq1anddar0-home/1.0' },
      redirect: 'follow',
    });

    if (!resp.ok) {
      const hint = resp.status === 404
        ? 'Calendar not found, or it is not shared publicly. In Google Calendar → Settings → your calendar → "Make available to public", then copy the calendar ID.'
        : `Google returned ${resp.status}.`;
      return res.status(502).json({ error: hint });
    }

    const text = await resp.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      return res.status(502).json({ error: 'That URL did not return a calendar feed.' });
    }

    const events = parseICS(text, from, to);
    calendarCache.set(cacheKey, { at: now, events });
    res.json({ events, cached: false });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Catch-all (must be AFTER API routes) ──────────────────
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Start ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Listening on ${PORT}`));
    // Run bill reminder check immediately and every 6 hours
    checkBillReminders();
    setInterval(checkBillReminders, 6 * 60 * 60 * 1000);
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
