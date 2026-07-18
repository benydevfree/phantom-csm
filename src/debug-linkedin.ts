/**
 * LinkedIn scraper comparison: guest mode vs. authenticated mode
 *
 * Usage:
 *   npx tsx src/debug-linkedin.ts                    # guest only
 *   LINKEDIN_COOKIE=<li_at> npx tsx src/debug-linkedin.ts  # both modes
 *
 * How to get li_at cookie:
 *   1. Open linkedin.com in Chrome, sign in
 *   2. DevTools → Application → Cookies → linkedin.com → li_at → copy Value
 *   3. Add to .env: LINKEDIN_COOKIE=<value>
 */

import 'dotenv/config'
import { scrapeLinkedInProfile } from './linkedin-scraper'

const TARGET = process.argv[2] || 'https://www.linkedin.com/in/williamhgates'
const SESSION_COOKIE = process.env.LINKEDIN_COOKIE

async function run() {
  console.log(`\n🎯 Profile : ${TARGET}\n`)

  // ── Mode 1 : guest (no auth) ──────────────────────────────────────────────
  console.log('━━━ MODE 1 : Guest (no session cookie) ━━━')
  const t1 = Date.now()
  const guest = await scrapeLinkedInProfile(TARGET)
  console.log(`⏱  ${Date.now() - t1}ms`)
  printProfile(guest)

  if (!SESSION_COOKIE) {
    console.log('\n💡 Set LINKEDIN_COOKIE=<li_at> in .env to test authenticated mode')
    console.log('   How to get: DevTools → Application → Cookies → linkedin.com → li_at\n')
    return
  }

  // ── Mode 2 : authenticated ────────────────────────────────────────────────
  console.log('\n━━━ MODE 2 : Authenticated (li_at cookie) ━━━')
  const t2 = Date.now()
  const auth = await scrapeLinkedInProfile(TARGET, { sessionCookie: SESSION_COOKIE })
  console.log(`⏱  ${Date.now() - t2}ms`)
  printProfile(auth)

  // ── Diff ──────────────────────────────────────────────────────────────────
  console.log('\n━━━ DIFF : what auth unlocks ━━━')
  const gained = {
    email: auth.email ?? '(not available)',
    phone: auth.phone ?? '(not available)',
    skills: auth.skills.length > 0 ? auth.skills.join(', ') : '(not available)',
    connections: auth.connections ?? '(not available)',
    followers_guest: guest.followers,
    followers_auth: auth.followers,
  }
  console.log(JSON.stringify(gained, null, 2))
}

function printProfile(p: ReturnType<typeof scrapeLinkedInProfile> extends Promise<infer T> ? T : never) {
  console.log(`\n  authMode    : ${p.authMode}`)
  console.log(`  name        : ${p.name}`)
  console.log(`  headline    : ${p.headline}`)
  console.log(`  location    : ${p.location}`)
  console.log(`  followers   : ${p.followers}`)
  console.log(`  connections : ${p.connections ?? '(guest)'}`)
  console.log(`  about       : ${p.about?.slice(0, 80)}...`)
  console.log(`  experience  : ${p.experience.map(e => `${e.title} @ ${e.company}`).join(' | ')}`)
  console.log(`  education   : ${p.education.map(e => e.school).join(' | ')}`)
  console.log(`  skills      : ${p.skills.length > 0 ? p.skills.join(', ') : '(guest)'}`)
  console.log(`  email       : ${p.email ?? '(guest)'}`)
  console.log(`  phone       : ${p.phone ?? '(guest)'}`)
  console.log(`  posts       : ${p.recentPosts.length} articles`)
}

run().catch(err => { console.error('\n❌', err.message); process.exit(1) })
