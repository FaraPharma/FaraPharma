/**
 * اسکریپت یکبارمصرف (مستقل از bootstrap) — فقط با جدول users کار میکند:
 * ۱) حساب admin@pharma.app را غیرفعال میکند (فقط users؛ profiles دست نمیخورد)
 * ۲) حساب ادمین 1989alikh1368@gmail.com را با رمز تصادفی امن میسازد/بهروز میکند
 * ۳) در صورت ساخت کاربر جدید، ردیف profiles فقط با ستونهای متعارف
 *    schema.ts ساخته میشود: id, owner_user_id, name, status, subscription_ends_at
 * ۴) رمز جدید فقط یکبار در خروجی چاپ میشود
 * اجرا: DATABASE_URL=... npx -y tsx scripts/rotate-admin.ts
 */
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "../src/db/pool";

const NEW_ADMIN_EMAIL = "1989alikh1368@gmail.com";
const OLD_ADMIN_EMAIL = "admin@pharma.app";

function randomPassword(): string {
  // 16 کاراکتر تصادفی امن
  return randomBytes(12).toString("base64url").replace(/[-_]/g, (m) =>
    m === "-" ? "a" : "B"
  );
}

async function main() {
  const password = randomPassword();
  const passwordHash = await bcrypt.hash(password, 10);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ۱) غیرفعالسازی حساب قدیمی — فقط در users (بدون هیچ تغییری در profiles)
    await client.query(
      `UPDATE users SET password_hash = '!DISABLED:' || gen_random_uuid()::text
       WHERE email = $1`,
      [OLD_ADMIN_EMAIL]
    );

    // ۲) حساب ادمین جدید — فقط users
    const existing = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [NEW_ADMIN_EMAIL]
    );
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE users SET role='admin', password_hash=$2 WHERE email=$1`,
        [NEW_ADMIN_EMAIL, passwordHash]
      );
    } else {
      const uid = await client.query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, 'admin') RETURNING id`,
        [NEW_ADMIN_EMAIL, passwordHash]
      );
      const userId = uid.rows[0].id as string;
      // پروفایل متعارف — فقط ستونهای schema.ts فعلی
      await client.query(
        `INSERT INTO profiles (id, owner_user_id, name, status, subscription_ends_at)
         VALUES ($1, $2, $3, 'active', now() + interval '10 years')
         ON CONFLICT (id) DO NOTHING`,
        [userId, userId, "مدیریت سیستم"]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  console.log("OLD_ADMIN_DISABLED:", OLD_ADMIN_EMAIL);
  console.log("NEW_ADMIN_EMAIL:", NEW_ADMIN_EMAIL);
  console.log("NEW_ADMIN_PASSWORD:", password);
  console.log(
    "⚠️ این رمز فقط همینجا چاپ میشود — بلافاصله آن را تغییر دهید."
  );

  await pool.end();
}

main().catch((e) => {
  console.error("ROTATION FAILED:", e);
  process.exit(1);
});
