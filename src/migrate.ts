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

  await db.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id        SERIAL PRIMARY KEY,
     user_id   TEXT NOT NULL,
     plan      TEXT CHECK (plan IN ('free', 'pro', 'enterprise')) NOT NULL,
     max_sessions INTEGER NOT NULL,
     sessions_used INTEGER DEFAULT 0,
     created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✅ Table subscriptions créée')

  await db.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id        SERIAL PRIMARY KEY,
      token     TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked   BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✅ Table refresh_tokens créée')

  await db.query(`
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id TEXT;
  `)
  console.log('✅ Colonne user_id ajoutée à la table sessions') 


  await db.query(`
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired'));
  `)
  console.log('✅ Colonne status ajoutée à la table subscriptions')

  await db.end()
}

migrate()
