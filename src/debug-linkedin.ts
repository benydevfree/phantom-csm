import 'dotenv/config'
import { scrapeLinkedInProfile } from './linkedin-scraper'

async function main() {
  const t0 = Date.now()
  const profile = await scrapeLinkedInProfile('https://www.linkedin.com/in/williamhgates')
  console.log(`✅ Done in ${Date.now() - t0}ms\n`)
  console.log(JSON.stringify(profile, null, 2))
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1) })
