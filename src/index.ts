import 'dotenv/config'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { router } from './router'
import { log } from './logingMiddleware'
import { auth } from './authMiddleware'

const app = new Koa()

app.use(log())
app.use(koaBody())
app.use(auth())
app.use(router.routes())
app.use(router.allowedMethods())

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 phantom-csm running on port ${PORT}`)
})
