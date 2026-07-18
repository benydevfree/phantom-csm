import 'dotenv/config'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { router } from './router'
import { log } from './middlewares/logingMiddleware'
import { auth } from './middlewares/authMiddleware'
import { logger } from './logger'

const app = new Koa()

app.use(log())
app.use(koaBody())
app.use(auth())
app.use(router.routes())
app.use(router.allowedMethods())

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  logger.info({ port: PORT }, `phantom-csm running on port ${PORT}`)
})
