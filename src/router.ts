import Router from '@koa/router'
import authRouter from './routes/auth'
import sessionsRouter from './routes/sessions'
import subscriptionsRouter from './routes/subscriptions'
import prospectsRouter from './routes/prospects'

const router = new Router()

router.get('/health', (ctx) => {
  ctx.body = { status: 'ok' }
})

router.use(authRouter.routes())
router.use(sessionsRouter.routes(), sessionsRouter.allowedMethods())
router.use(subscriptionsRouter.routes(), subscriptionsRouter.allowedMethods())
router.use(prospectsRouter.routes(), prospectsRouter.allowedMethods())

export { router }
