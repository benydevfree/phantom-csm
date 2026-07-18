import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client'

export const registry = new Registry()
registry.setDefaultLabels({ service: 'phantom-csm' })

collectDefaultMetrics({ register: registry })

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [registry],
})

export const httpDurationMs = new Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
})

export const scrapeJobsTotal = new Counter({
  name: 'scrape_jobs_total',
  help: 'Total scrape jobs processed',
  labelNames: ['status'],  // success | error
  registers: [registry],
})

export const scrapeJobDurationMs = new Histogram({
  name: 'scrape_job_duration_ms',
  help: 'Scrape job duration in milliseconds',
  buckets: [500, 1000, 2500, 5000, 10000, 30000],
  registers: [registry],
})

export const activeSessionsGauge = new Gauge({
  name: 'active_sessions',
  help: 'Number of active sessions being processed',
  registers: [registry],
})
