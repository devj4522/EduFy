import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';
import { MongoClient } from 'mongodb';

dotenv.config();

const app = express();
app.use(bodyParser.json());

// --------- CORS (allow list from .env) ----------
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || '') // comma separated
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (FRONTEND_ORIGINS.length) {
  app.use(cors({ origin: FRONTEND_ORIGINS }));
  console.log('CORS origins:', FRONTEND_ORIGINS);
} else {
  // development fallback (open) — change in production!
  app.use(cors());
  console.warn('CORS: no FRONTEND_ORIGINS set, allowing all origins (change in production!)');
}

// --------- rate limiter ----------
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: Number(process.env.RATE_LIMIT_MAX) || 80,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// --------- OpenAI client (from env) ----------
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.warn('Warning: OPENAI_API_KEY not set in .env — OpenAI routes will return 503 until configured.');
}

let openai = null;
try {
  if (OPENAI_KEY) {
    openai = new OpenAI({ apiKey: OPENAI_KEY });
    console.log('OpenAI client created.');
  }
} catch (err) {
  console.error('Failed to create OpenAI client:', err);
  openai = null;
}

function requireOpenAI(res) {
  if (!openai) {
    res.status(503).json({ error: 'OpenAI API key not configured on server' });
    return false;
  }
  return true;
}

// --------- MongoDB connection ----------
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'aiMentor';

let db, chatsCol, tasksCol, progressCol, plansCol;

async function connectToMongo() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(MONGO_DB_NAME);
    chatsCol = db.collection('chats');
    tasksCol = db.collection('tasks');
    progressCol = db.collection('progress');
    plansCol = db.collection('plans');
    console.log('✅ Connected to MongoDB:', MONGO_DB_NAME);
  } catch (err) {
    console.error('MongoDB connection failed:', err);
    throw err;
  }
}

function getUserFromReq(req) {
  if (req.body && req.body.user) return String(req.body.user).trim();
  if (req.query && req.query.user) return String(req.query.user).trim();
  return 'guest_user';
}

// health
app.get('/health', (req, res) => {
  res.json({ ok: true, openai: !!openai });
});

// POST /chat
app.post('/chat', async (req, res) => {
  try {
    if (!requireOpenAI(res)) return;

    const user = getUserFromReq(req);
    const prompt = req.body.prompt || '';
    if (!prompt) return res.status(400).json({ error: 'prompt missing' });

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful AI tutor. Provide clear, step-by-step solutions and short practice problems.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: Number(process.env.OPENAI_MAX_TOKENS) || 800,
    });

    const reply = completion?.choices?.[0]?.message?.content || 'No response from AI';

    // save chat (non-blocking)
    chatsCol?.insertOne({ user, prompt, reply, time: new Date() }).catch(err => console.warn('save chat failed:', err));

    res.json({ reply });
  } catch (err) {
    console.error('chat error', err);
    res.status(500).json({ error: 'AI error' });
  }
});

// POST /chats -> store chat explicitly
app.post('/chats', async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const doc = { user, prompt: req.body.prompt, reply: req.body.reply, time: new Date() };
    await chatsCol.insertOne(doc);
    res.json({ ok: true });
  } catch (e) {
    console.error('save chat failed', e);
    res.status(500).json({ error: 'save failed' });
  }
});

// GET /tasks -> return saved tasks for a user (use ?user=NAME)
app.get('/tasks', async (req, res) => {
  try {
    const user = req.query.user || 'guest_user';
    const doc = await tasksCol.findOne({ user });
    res.json({ tasks: doc ? doc.tasks : [] });
  } catch (e) {
    console.error('tasks fetch error', e);
    res.status(500).json({ error: 'db error' });
  }
});

// POST /tasks -> save tasks for a user
app.post('/tasks', async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const payload = { user, tasks: req.body.tasks || [], updatedAt: new Date() };
    await tasksCol.updateOne({ user }, { $set: payload }, { upsert: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('tasks save error', e);
    res.status(500).json({ error: 'db error' });
  }
});

// GET /progress -> latest progress for user (use ?user=NAME)
app.get('/progress', async (req, res) => {
  try {
    const user = req.query.user || 'guest_user';
    const doc = await progressCol.findOne(
      { user },
      { sort: { timestamp: -1 } }
    );
    res.json({
      progress: doc ? doc.data : { completed: 0, total: 0 }
    });
  } catch (e) {
    console.error('progress fetch error', e);
    res.status(500).json({ error: 'db error' });
  }
});

// POST /progress -> save progress & auto-generate plan
app.post('/progress', async (req, res) => {
  try {
    const user = getUserFromReq(req);
    const data = req.body || {};

    await progressCol.insertOne({
      user,
      data: {
        completed: data.completed || 0,
        total: data.total || 0
      },
      timestamp: new Date()
    });

    const pct = (data.total && data.completed)
      ? data.completed / data.total
      : 0;

    let plan = null;

    if (pct < 0.7) {
      const pctValue = Number.isFinite(pct) ? Math.round(pct * 100) : 0;

      plan = {
        summary: `You have completed ${pctValue}%. Focus next: 30m theory + 30m practice on weak topics.`
      };

      plansCol?.insertOne({ user, plan, time: new Date() }).catch(() => {});
    }

    res.json({ ok: true, plan });

  } catch (e) {
    console.error('progress save error', e);
    res.status(500).json({ error: 'db error' });
  }
});

// POST /generate-plan -> generate plan via OpenAI (sends user in body too)
app.post('/generate-plan', async (req, res) => {
  try {
    if (!requireOpenAI(res)) return;

    const user = getUserFromReq(req);
    const { tasks = [], progress = {} } = req.body || {};

    const tasksList = (Array.isArray(tasks) && tasks.length)
      ? tasks.map(t => String(t.title || t).replace(/[\n\r]+/g,' ').trim()).join(', ')
      : 'none';

    const prompt = `You are an AI mentor. Create a short JSON study plan for a student.\nTasks: ${tasksList}.\nProgress: completed ${progress.completed || 0} of ${progress.total || 0}.\nReturn JSON with keys: summary (short string), dailyTasks (array of {title,durationMinutes}), and tips (optional).\nKeep it concise and return valid JSON only.`;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful AI study planner. Return valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: Number(process.env.OPENAI_MAX_TOKENS) || 400,
      temperature: 0.2
    });

    const rawReply = completion?.choices?.[0]?.message?.content || '';
    const replyTrim = String(rawReply).trim();

    let plan = { summary: replyTrim };
    try {
      const first = replyTrim.indexOf('{');
      const last = replyTrim.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        const jsonStr = replyTrim.substring(first, last + 1);
        plan = JSON.parse(jsonStr);
      } else {
        plan = JSON.parse(replyTrim);
      }
    } catch (parseErr) {
      console.warn('generate-plan: failed to parse AI reply as JSON, saving raw text as summary', parseErr);
      plan = { summary: replyTrim };
    }

    plansCol?.insertOne({ user, plan, time: new Date() }).catch(err => console.warn('save plan failed', err));

    res.json({ plan });
  } catch (e) {
    console.error('generate-plan error', e);
    res.status(500).json({ error: 'plan error' });
  }
});

// --------- start server ----------
async function start() {
  try {
    await connectToMongo();
    const port = process.env.PORT || 5001;
    app.listen(port, () => console.log('AI Mentor Backend running on', port));
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
