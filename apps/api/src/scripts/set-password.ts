/**
 * Resets a user's password.
 *   npm run set-password -- <email> [new-password]
 *   docker compose exec app node apps/api/dist/scripts/set-password.js <email>
 * Without a password argument it is read from the terminal.
 */
import { eq } from 'drizzle-orm';
import { createInterface } from 'node:readline/promises';
import { openDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import { loadConfig } from '../lib/config.js';
import { hashPassword } from '../lib/passwords.js';

async function main() {
  const [email, passwordArg] = process.argv.slice(2);
  if (!email) {
    console.error('Usage: set-password <email> [new-password]');
    process.exit(1);
  }
  let password = passwordArg;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question('New password: ');
    rl.close();
  }
  if (!password || password.length < 8) {
    console.error('The password must be at least 8 characters.');
    process.exit(1);
  }
  const config = loadConfig(process.env, { requireSessionSecret: false });
  const { db, sqlite } = openDatabase(config.dbFile);
  const result = db
    .update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date().toISOString() })
    .where(eq(users.email, email.trim().toLowerCase()))
    .run();
  sqlite.close();
  if (result.changes === 0) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }
  console.log(`Password updated for ${email}`);
}

void main();
