import { spawn } from 'child_process'
import cron, { ScheduledTask } from 'node-cron'

const CLAUDE_BIN = '/Users/beny/.local/bin/claude'

export function spawnWake(source: string): void {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY

  const child = spawn(CLAUDE_BIN, ['--print'], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  })

  child.stdin.write('.')
  child.stdin.end()

  child.on('close', (code) => {
    console.log(`[wake] claude exited with code ${code} (source: ${source})`)
  })
  child.on('error', (err) => {
    console.error(`[wake] failed to spawn claude (source: ${source}):`, err.message)
  })
}

export interface WakeTime {
  dayOfWeek: number  // 0=Sun … 6=Sat
  hour: number       // 0–23
  label?: string
}

// Active cron tasks — replaced on each updateSchedule() call
let activeTasks: ScheduledTask[] = []

// Default fallback schedule (15h every day)
const DEFAULT_WAKE_TIMES: WakeTime[] = [
  { dayOfWeek: 1, hour: 15, label: 'Lundi 15h (défaut)' },
  { dayOfWeek: 2, hour: 15, label: 'Mardi 15h (défaut)' },
  { dayOfWeek: 3, hour: 15, label: 'Mercredi 15h (défaut)' },
  { dayOfWeek: 4, hour: 15, label: 'Jeudi 15h (défaut)' },
  { dayOfWeek: 5, hour: 15, label: 'Vendredi 15h (défaut)' },
]

function toCronExpression(dayOfWeek: number, hour: number): string {
  // node-cron: 0 = Sunday, 1 = Monday … 6 = Saturday (same as JS Date.getDay())
  return `0 ${hour} * * ${dayOfWeek}`
}

export function updateSchedule(times: WakeTime[]): void {
  // Destroy previous tasks
  for (const task of activeTasks) {
    task.stop()
  }
  activeTasks = []

  if (times.length === 0) {
    console.log('[cron] schedule cleared — no wake times active')
    return
  }

  for (const wt of times) {
    const expr = toCronExpression(wt.dayOfWeek, wt.hour)
    const label = wt.label ?? `day${wt.dayOfWeek}@${wt.hour}h`

    const task = cron.schedule(expr, () => {
      const ts = new Date().toISOString()
      console.log(`[cron] ${ts} — wake triggered (${label})`)
      spawnWake(`cron:${label}`)
    })

    activeTasks.push(task)
    console.log(`[cron] registered "${label}" → ${expr}`)
  }
}

export function startCron(): void {
  console.log('[cron] starting with default schedule (update via PUT /wake/schedule)')
  updateSchedule(DEFAULT_WAKE_TIMES)
}
