import { describe, it, expect } from 'vitest'
import { parseLinkedInCsv } from '../csv-parser'

const HEADER_NOTE = 'Notes:,We,will,send,an,email'
const HEADER_ROW = 'First Name,Last Name,URL,Email Address,Company,Position,Connected On'

function makeCsv(rows: string[]): string {
  return [HEADER_NOTE, HEADER_ROW, ...rows].join('\n')
}

describe('parseLinkedInCsv', () => {
  it('CSV nominal avec 3 contacts retourne 3 ParsedContact', () => {
    const csv = makeCsv([
      'Alice,Dupont,https://linkedin.com/in/alice,alice@example.com,Acme,Engineer,01 Jan 2024',
      'Bob,Martin,https://linkedin.com/in/bob,bob@example.com,Corp,Manager,02 Jan 2024',
      'Claire,Leroy,https://linkedin.com/in/claire,claire@example.com,Startup,CTO,03 Jan 2024',
    ])
    const result = parseLinkedInCsv(csv)
    expect(result).toHaveLength(3)
    expect(result[0].full_name).toBe('Alice Dupont')
    expect(result[1].full_name).toBe('Bob Martin')
    expect(result[2].full_name).toBe('Claire Leroy')
  })

  it('email vide => champ email null', () => {
    const csv = makeCsv([
      'Jean,Paul,https://linkedin.com/in/jean,,Société,Dev,05 Jan 2024',
    ])
    const result = parseLinkedInCsv(csv)
    expect(result[0].email).toBeNull()
  })

  it('lignes vides ignorées', () => {
    const csv = makeCsv([
      'Alice,Dupont,https://linkedin.com/in/alice,alice@example.com,Acme,Engineer,01 Jan 2024',
      '',
      '   ',
      'Bob,Martin,https://linkedin.com/in/bob,bob@example.com,Corp,Manager,02 Jan 2024',
    ])
    const result = parseLinkedInCsv(csv)
    expect(result).toHaveLength(2)
  })

  it('noms avec accents', () => {
    const csv = makeCsv([
      'Éléonore,Beauchêne,https://linkedin.com/in/el,el@example.com,Société Générale,Analyste,10 Jan 2024',
    ])
    const result = parseLinkedInCsv(csv)
    expect(result[0].first_name).toBe('Éléonore')
    expect(result[0].last_name).toBe('Beauchêne')
    expect(result[0].full_name).toBe('Éléonore Beauchêne')
  })

  it('valeurs trimées', () => {
    const csv = makeCsv([
      '  Alice , Dupont , https://linkedin.com/in/alice , alice@example.com , Acme , Engineer , 01 Jan 2024',
    ])
    const result = parseLinkedInCsv(csv)
    expect(result[0].first_name).toBe('Alice')
    expect(result[0].last_name).toBe('Dupont')
  })
})
