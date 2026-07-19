import Router from '@koa/router'
import authRouter from './routes/auth'
import sessionsRouter from './routes/sessions'
import subscriptionsRouter from './routes/subscriptions'
import prospectsRouter from './routes/prospects'
import linkedinRouter from './routes/linkedin'
import chatRouter from './routes/chat'
import contactsRouter from './routes/contacts'
import { registry } from './metrics'

const router = new Router()

router.get('/health', (ctx) => {
  ctx.body = { status: 'ok' }
})

router.get('/metrics', async (ctx) => {
  ctx.set('Content-Type', registry.contentType)
  ctx.body = await registry.metrics()
})

router.use(authRouter.routes())
router.use(sessionsRouter.routes(), sessionsRouter.allowedMethods())
router.use(subscriptionsRouter.routes(), subscriptionsRouter.allowedMethods())
router.use(prospectsRouter.routes(), prospectsRouter.allowedMethods())
router.use(linkedinRouter.routes(), linkedinRouter.allowedMethods())
router.use(chatRouter.routes(), chatRouter.allowedMethods())
router.use(contactsRouter.routes(), contactsRouter.allowedMethods())

export { router }
