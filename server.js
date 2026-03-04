const express = require('express');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

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

// ── GET all items ──────────────────────────────────────────
app.get('/api/items', async (_req, res) => {
  try {
    const items = await db.collection('items').find().toArray();
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

// ── Catch-all (must be AFTER API routes) ──────────────────
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Start ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
connectDB()
  .then(() => app.listen(PORT, () => console.log(`Listening on ${PORT}`)))
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
