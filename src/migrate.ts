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

  await db.query(`
    CREATE TABLE IF NOT EXISTS prospects (
      id           SERIAL PRIMARY KEY,
      job_id       UUID NOT NULL UNIQUE,
      user_id      TEXT NOT NULL,
      source_url   TEXT NOT NULL,
      status       TEXT CHECK (status IN ('pending', 'scraping', 'done', 'failed')) DEFAULT 'pending',
      enriched_data JSONB,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✅ Table prospects créée')

  await db.query(`
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  `)
  console.log('✅ Colonne tenant_id ajoutée à la table prospects')

  await db.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    TEXT NOT NULL,
      full_name    TEXT,
      headline     TEXT,
      location     TEXT,
      email        TEXT,
      phone        TEXT,
      linkedin_url TEXT,
      company      TEXT,
      sector       TEXT,
      source       TEXT CHECK (source IN ('linkedin_csv', 'linkedin_scrape', 'gmail', 'manual', 'csv')) NOT NULL,
      raw_data     JSONB,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✅ Table contacts créée')

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_linkedin_idx ON contacts (tenant_id, linkedin_url)
    WHERE linkedin_url IS NOT NULL;
  `)
  console.log('✅ Index (tenant_id, linkedin_url) créé sur contacts')

  await db.query(`
    CREATE TABLE IF NOT EXISTS offers (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             TEXT NOT NULL,
      name                  TEXT NOT NULL,
      description           TEXT,
      target_persona        TEXT,
      bp_initiative_id      TEXT,
      discriminant_criteria JSONB,
      status                TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'analyzing', 'done', 'error')),
      created_at            TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✅ Table offers créée')

  await db.query(`
    CREATE TABLE IF NOT EXISTS contact_scores (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id        TEXT NOT NULL,
      contact_id       UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      offer_id         UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
      score            INTEGER CHECK (score >= 0 AND score <= 100),
      matched_criteria JSONB,
      computed_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✅ Table contact_scores créée')

  await db.end()
}

migrate()
