export interface ParsedContact {
  first_name: string
  last_name: string
  full_name: string
  linkedin_url: string | null
  email: string | null
  company: string | null
  position: string | null
  connected_on: string | null
}

export function parseLinkedInCsv(content: string): ParsedContact[] {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  // LinkedIn CSV has 2 header lines: a note line and the actual header
  // Find the header line (contains "First Name")
  const headerIdx = lines.findIndex(l => l.includes('First Name'))
  if (headerIdx === -1) return []

  const headers = parseCsvLine(lines[headerIdx])
  const colIdx = (name: string) => headers.indexOf(name)

  const firstNameIdx = colIdx('First Name')
  const lastNameIdx = colIdx('Last Name')
  const urlIdx = colIdx('URL')
  const emailIdx = colIdx('Email Address')
  const companyIdx = colIdx('Company')
  const positionIdx = colIdx('Position')
  const connectedOnIdx = colIdx('Connected On')

  const contacts: ParsedContact[] = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    const firstName = (cols[firstNameIdx] ?? '').trim()
    const lastName = (cols[lastNameIdx] ?? '').trim()
    const email = (cols[emailIdx] ?? '').trim() || null
    const url = (cols[urlIdx] ?? '').trim() || null
    const company = (cols[companyIdx] ?? '').trim() || null
    const position = (cols[positionIdx] ?? '').trim() || null
    const connectedOn = (cols[connectedOnIdx] ?? '').trim() || null

    contacts.push({
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`.trim(),
      linkedin_url: url,
      email,
      company,
      position,
      connected_on: connectedOn,
    })
  }

  return contacts
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}
