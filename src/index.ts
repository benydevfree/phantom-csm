import 'dotenv/config'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { router } from './router'
import { log } from './middlewares/logingMiddleware'
import { auth } from './middlewares/authMiddleware'
import { tenant } from './middlewares/tenantMiddleware'
import { logger } from './logger'
import { startCron } from './cron'

const app = new Koa()

app.use(log())
app.use(koaBody({ multipart: true }))
app.use(auth())
app.use(tenant())
app.use(router.routes())
app.use(router.allowedMethods())

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  logger.info({ port: PORT }, `phantom-csm running on port ${PORT}`)
  startCron()
})
