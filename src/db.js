const { Pool } = require('pg');

// التشفير (SSL) بيتحدد من ?sslmode=require في DATABASE_URL (Neon بيدّيك الرابط كده).
// مع نسخة pg المثبّتة ده بيشغّل SSL مع التحقق من شهادة السيرفر.
// مش بنعطّل التحقق هنا. لو احتجت تعطّله فعلًا، غيّر الرابط لـ sslmode=no-verify بشكل صريح.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

module.exports = pool;
