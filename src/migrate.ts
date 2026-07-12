import 'dotenv/config'
import { db } from './db'

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id        SERIAL PRIMARY KEY,
      name      TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✅ Table sessions créée')
  await db.end()
}

migrate()
