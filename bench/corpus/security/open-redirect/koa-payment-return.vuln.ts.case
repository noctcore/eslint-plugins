// @bench category=open-redirect cwe=CWE-601 framework=koa pair=koa-payment-return title="payment provider return_url query value used for the final redirect"
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
  ctx.redirect(`${returnUrl}?payment=${result.id}`); // expect: security/no-user-controlled-redirect
});

app.use(router.routes());
app.listen(3000);
