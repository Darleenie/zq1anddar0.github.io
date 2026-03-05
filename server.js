const express  = require('express');
const path     = require('path');
const crypto   = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');
const AlexaRemote = require('alexa-remote2');
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

// ── Catch-all (must be AFTER API routes) ──────────────────
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Start ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
connectDB()
  .then(() => {
    initAlexa();
    app.listen(PORT, () => console.log(`Listening on ${PORT}`));
    // Run bill reminder check immediately and every 6 hours
    checkBillReminders();
    setInterval(checkBillReminders, 6 * 60 * 60 * 1000);
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
