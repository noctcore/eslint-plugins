// @bench category=open-redirect cwe=CWE-601 framework=koa pair=koa-payment-return title="fixed done page, user value kept as an encoded query param"
// ok
import Koa from 'koa';
import Router from '@koa/router';
import { confirmPayment } from './payments';

const app = new Koa();
const router = new Router();

router.get('/payments/callback', async (ctx) => {
  const result = await confirmPayment(String(ctx.query.session_id));
  if (!result.paid) ctx.throw(402, 'payment not completed');
  ctx.state.audit('payment.paid', result.id);
  const returnUrl = String(ctx.query.return_url || '/');
  const done = `/payments/done?payment=${result.id}&return=${encodeURIComponent(returnUrl)}`;
  ctx.redirect(done);
});

app.use(router.routes());
app.listen(3000);
