const express = require('express');
const { Pool } = require('pg');
const OpenAI = require('openai');

// إعداد اتصال Neon (هنا ضع رابط اتصالك مباشرة)
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_ipt7Uunohx4V@ep-jolly-leaf-ab97q52m-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
});

// إعداد OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // تأكد إنك ضايفه في متغير البيئة
});

const app = express();
app.use(express.json());

// إضافة استفسار جديد وتوليد رد من الذكاء الاصطناعي
app.post('/queries', async (req, res) => {
  const { email, query } = req.body;
  if (!email || !query) {
    return res.status(400).json({ error: 'Email and query are required' });
  }

  try {
    // توليد الرد من GPT
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini", // تقدر تغير الموديل لو حابب
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

// جلب كل الاستفسارات
app.get('/queries', async (req, res) => {
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
