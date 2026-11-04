// المتغيرات المطلوبة (بتتضاف في إعدادات الاستضافة / Secrets، مش في الكود):
//   DATABASE_URL           رابط اتصال قاعدة البيانات (Neon / Postgres) ولازم يكون فيه ?sslmode=require
//   OPENAI_API_KEY         مفتاح OpenAI
//   ADMIN_API_KEY          مفتاح سري لقراءة الاستفسارات، بيتبعت في الهيدر x-api-key
// متغيرات اختيارية:
//   PORT                   رقم البورت (الافتراضي 3000)
//   RATE_LIMIT_PER_MINUTE  أقصى عدد طلبات POST في الدقيقة لكل IP (الافتراضي 10)
//   TRUST_PROXY            عدد الـ proxies اللي قدام السيرفر (غالبًا 1 على الاستضافات)
const crypto = require('crypto');
const express = require('express');
const OpenAI = require('openai');

// السيرفر مينفعش يشتغل من غير قاعدة بيانات ومفتاح OpenAI، فنوقفه فورًا برسالة واضحة
for (const name of ['DATABASE_URL', 'OPENAI_API_KEY']) {
  if (!process.env[name]) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
}
if (!process.env.ADMIN_API_KEY) {
  console.warn('ADMIN_API_KEY is not set: GET /queries will answer 503 until you add it');
}

// الاتصال بقاعدة البيانات بيجي من متغير البيئة DATABASE_URL (شوف src/db.js)
const pool = require('./db');

// إعداد OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // تأكد إنك ضايفه في متغير البيئة
});

const app = express();
app.disable('x-powered-by'); // مش لازم نعلن إن السيرفر Express

// لو السيرفر ورا proxy واحد (زي معظم الاستضافات) ضيف TRUST_PROXY=1 عشان الـ IP الحقيقي للزائر يتقرا صح.
// من غيرها كل الزوار بيبانوا بـ IP الـ proxy نفسه، فالـ rate limit هيتحسب عليهم كلهم مع بعض.
const trustProxyHops = Number(process.env.TRUST_PROXY);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set('trust proxy', trustProxyHops);
}

app.use(express.json({ limit: '10kb' }));

// حدود المدخلات عشان نتحكم في تكلفة OpenAI وحجم البيانات المتخزنة
const MAX_EMAIL_LENGTH = 254;
const MAX_QUERY_LENGTH = 2000;

// حد بسيط لعدد طلبات POST لكل IP (محفوظ في الذاكرة) عشان محدش يستهلك رصيد OpenAI.
// بيتصفّر لما السيرفر يعمل restart، ومش مشترك لو شغّلت أكتر من نسخة من السيرفر.
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 10;
const RATE_WINDOW_MS = 60 * 1000;
const requestCounts = new Map(); // IP -> { count, resetAt }

// تنظيف الـ IPs اللي مدتها خلصت عشان الذاكرة متكبرش
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of requestCounts) {
    if (entry.resetAt <= now) requestCounts.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

function rateLimit(req, res, next) {
  const now = Date.now();
  let entry = requestCounts.get(req.ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    requestCounts.set(req.ip, entry);
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_PER_MINUTE) {
    res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Too many requests, please try again later' });
  }
  next();
}

// حماية الـ endpoints الإدارية بمفتاح سري في الهيدر x-api-key
function requireAdminKey(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return res.status(503).json({ error: 'ADMIN_API_KEY is not configured' });
  }
  const sha = (value) => crypto.createHash('sha256').update(String(value)).digest();
  if (!crypto.timingSafeEqual(sha(req.get('x-api-key') || ''), sha(expected))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// إضافة استفسار جديد وتوليد رد من الذكاء الاصطناعي
app.post('/queries', rateLimit, async (req, res) => {
  const { email, query } = req.body || {};
  if (!email || !query) {
    return res.status(400).json({ error: 'Email and query are required' });
  }
  if (
    typeof email !== 'string' || typeof query !== 'string' ||
    email.length > MAX_EMAIL_LENGTH || query.length > MAX_QUERY_LENGTH
  ) {
    return res.status(400).json({ error: 'Invalid email or query' });
  }

  try {
    // توليد الرد من GPT
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini", // تقدر تغير الموديل لو حابب
      max_completion_tokens: 500, // سقف لطول الرد عشان التكلفة
      messages: [
        { role: "system", content: "You are a helpful support assistant for Squarespace-related issues." },
        { role: "user", content: query }
      ]
    });

    const responseText = aiResponse.choices[0].message.content;

    // حفظ البيانات في قاعدة البيانات
    const result = await pool.query(
      'INSERT INTO customer_queries (customer_email, query, response) VALUES ($1, $2, $3) RETURNING *',
      [email, query, responseText]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error processing query' });
  }
});

// جلب كل الاستفسارات (للإدارة فقط: لازم الهيدر x-api-key)
app.get('/queries', requireAdminKey, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customer_queries ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// معالج أخطاء عام: بيرجّع JSON بسيط بدل صفحة HTML فيها تفاصيل الخطأ
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
