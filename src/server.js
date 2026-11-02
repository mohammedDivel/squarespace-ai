// المتغيرات المطلوبة (بتتضاف في إعدادات الاستضافة / Secrets، مش في الكود):
//   DATABASE_URL    رابط اتصال قاعدة البيانات (Neon / Postgres)
//   OPENAI_API_KEY  مفتاح OpenAI
//   ADMIN_API_KEY   مفتاح سري لقراءة الاستفسارات، بيتبعت في الهيدر x-api-key
//   PORT            اختياري (الافتراضي 3000)
const crypto = require('crypto');
const express = require('express');
const OpenAI = require('openai');

// الاتصال بقاعدة البيانات بيجي من متغير البيئة DATABASE_URL (شوف src/db.js)
const pool = require('./db');

// إعداد OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // تأكد إنك ضايفه في متغير البيئة
});

const app = express();
app.use(express.json({ limit: '10kb' }));

// حدود المدخلات عشان نتحكم في تكلفة OpenAI وحجم البيانات المتخزنة
const MAX_EMAIL_LENGTH = 254;
const MAX_QUERY_LENGTH = 2000;

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
app.post('/queries', async (req, res) => {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
