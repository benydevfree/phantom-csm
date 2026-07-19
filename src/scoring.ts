import type { Criterion } from './llm'

export interface MatchedCriterion {
  field: string
  matched_values: string[]
  weight: number
  contribution: number
}

export interface Contact {
  id: string
  tenant_id: string
  headline?: string | null
  company?: string | null
  sector?: string | null
  [key: string]: any
}

export function scoreContact(
  contact: Contact,
  criteria: Criterion[]
): { score: number; matched: MatchedCriterion[] } {
  if (!criteria || criteria.length === 0) return { score: 0, matched: [] }

  const searchText = [contact.headline, contact.company, contact.sector]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  let weightedSum = 0
  let maxWeight = 0
  const matched: MatchedCriterion[] = []

  for (const criterion of criteria) {
    maxWeight += criterion.weight
    const matchedValues = criterion.positive_values.filter(v =>
      searchText.includes(v.toLowerCase())
    )
    if (matchedValues.length > 0) {
      const contribution = criterion.weight
      weightedSum += contribution
      matched.push({
        field: criterion.field,
        matched_values: matchedValues,
        weight: criterion.weight,
        contribution,
      })
    }
  }

  const score = maxWeight > 0 ? Math.round((weightedSum / maxWeight) * 100) : 0
  return { score, matched }
}
