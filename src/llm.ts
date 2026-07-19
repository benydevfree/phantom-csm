import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface Criterion {
  field: string
  positive_values: string[]
  negative_values: string[]
  weight: number
  rationale: string
}

export async function analyzeOfferCriteria(offer: {
  name: string
  description?: string
  target_persona?: string
}): Promise<Criterion[]> {
  const prompt = `Voici une offre commerciale :
Nom : ${offer.name}
Description : ${offer.description ?? 'N/A'}
Persona cible : ${offer.target_persona ?? 'N/A'}

Identifie 5 critères discriminants pour trouver les contacts les plus susceptibles d'être intéressés. Réponds UNIQUEMENT en JSON valide :
{ "criteria": [ { "field": "string", "positive_values": ["string"], "negative_values": ["string"], "weight": number, "rationale": "string" } ] }`

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content.find(b => b.type === 'text')?.text ?? ''

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON found in LLM response')

  const parsed = JSON.parse(jsonMatch[0]) as { criteria: Criterion[] }
  return parsed.criteria
}
