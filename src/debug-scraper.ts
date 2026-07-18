import { scrapeJobOffer } from './scraper'

async function main() {
  const result = await scrapeJobOffer('https://candidat.francetravail.fr/offres/recherche/detail/208VNHT')
  console.log(JSON.stringify(result, null, 2))
}

main().catch(console.error)
