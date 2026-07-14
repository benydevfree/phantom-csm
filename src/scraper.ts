import { chromium } from 'playwright'

export type JobOffer = {
  title: string
  location: string
  company: string
  contractType: string
  salary: string | null
  description: string
  sourceUrl: string
}

export async function scrapeJobOffer(url: string): Promise<JobOffer> {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  await page.goto(url, { waitUntil: 'networkidle' })

  // Attendre que le h1 de l'offre soit présent
  await page.waitForSelector('h1', { timeout: 10000 })

  // Titre — h1 = "Offre n° 208VNHTDéveloppeur..." — le numéro est collé au titre
  const rawTitle = await page.locator('h1').filter({ hasText: /Offre n°/ }).textContent() ?? ''
  // On coupe tout jusqu'au premier mot en minuscule ou avec accent après le numéro d'offre
  const title = rawTitle.replace(/.*Offre n°\s*[A-Z0-9]+([A-Z])/i, '$1').trim()

  // Localisation — texte qui matche "XX - VILLE"
  const location = await page.locator('text=/^\\d{2} - /').first().textContent().catch(() => '') ?? ''

  // Description — on extrait depuis le body text en cherchant la section offre
  const bodyText2 = await page.locator('body').textContent() ?? ''
  const descMatch = bodyText2.match(/Notre entreprise([\s\S]*?)Type de contrat/)
  const description = descMatch ? descMatch[0].replace('Type de contrat', '').trim() : ''

  // Entreprise — h3 dans la section qui suit le heading "Employeur"
  const employeurSection = page.getByRole('heading', { name: 'Employeur' }).locator('~ *')
  const company = await employeurSection.getByRole('heading').first().textContent()
    .catch(() => page.locator('h3').nth(1).textContent())
    .catch(() => '') ?? ''

  // Contrat et salaire — on cherche dans tout le texte de la page
  const pageText = await page.locator('body').textContent() ?? ''
  const contractMatch = pageText.match(/Type de contrat\s*\n?\s*([\w\s]+)/)?.[1]?.trim() ?? ''
  const salaryMatch = pageText.match(/Salaire brut\s*:\s*([^\n]+)/)?.[1]?.trim() ?? null

  const contractType = contractMatch.split('\n')[0].trim()
  const salary = salaryMatch?.split(/Intéressement|Titres|Profil/)[0].trim() ?? null

  await browser.close()

  return {
    title,
    location: location.trim(),
    company: company.trim(),
    contractType,
    salary,
    description: description.slice(0, 500).trim(),
    sourceUrl: url,
  }
}

async function extractAfterLabel(container: any, label: string): Promise<string> {
  const labelEl = container.getByText(label, { exact: true }).first()
  const parent = labelEl.locator('..')
  const text = await parent.textContent() ?? ''
  return text.replace(label, '').trim()
}
