import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Datadog expects "message" not "msg" — remap
  messageKey: 'message',
  // Standard timestamp format (epoch ms → Datadog auto-parses)
  timestamp: pino.stdTimeFunctions.isoTime,
  // In prod: plain JSON for Datadog log ingestion
  // In dev: pretty-print for readability
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
  // Base fields added to every log line — Datadog uses "service" and "env" for filtering
  base: {
    service: 'phantom-csm',
    env: process.env.NODE_ENV ?? 'development',
    version: process.env.npm_package_version ?? '1.0.0',
  },
})
