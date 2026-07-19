import { describe, it, expect } from 'vitest'
import { scoreContact } from '../scoring'
import type { Criterion } from '../llm'

const criteria: Criterion[] = [
  { field: 'role', positive_values: ['engineer', 'developer'], negative_values: [], weight: 50, rationale: '' },
  { field: 'sector', positive_values: ['saas', 'tech'], negative_values: [], weight: 50, rationale: '' },
]

describe('scoreContact', () => {
  it('contact qui matche tous les critères → score proche de 100', () => {
    const { score } = scoreContact(
      { id: '1', tenant_id: 't', headline: 'Senior Software Engineer', company: 'SaaS Corp', sector: 'tech' },
      criteria
    )
    expect(score).toBe(100)
  })

  it('contact qui ne matche rien → score 0', () => {
    const { score } = scoreContact(
      { id: '2', tenant_id: 't', headline: 'Chef cuisinier', company: 'Restaurant du coin', sector: 'restauration' },
      criteria
    )
    expect(score).toBe(0)
  })

  it('contact avec headline vide → ne plante pas, score partiel', () => {
    const { score } = scoreContact(
      { id: '3', tenant_id: 't', headline: null, company: 'SaaS Ltd', sector: 'saas' },
      criteria
    )
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('criteria vide → score 0', () => {
    const { score } = scoreContact(
      { id: '4', tenant_id: 't', headline: 'Engineer', company: 'Tech Corp', sector: 'tech' },
      []
    )
    expect(score).toBe(0)
  })

  it('retourne matched avec les critères qui ont matché', () => {
    const { matched } = scoreContact(
      { id: '5', tenant_id: 't', headline: 'Software Engineer', company: 'Corp', sector: 'finance' },
      criteria
    )
    expect(matched).toHaveLength(1)
    expect(matched[0].field).toBe('role')
  })
})
