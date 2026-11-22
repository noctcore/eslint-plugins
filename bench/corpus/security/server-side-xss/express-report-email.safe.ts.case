// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-report-email title="customer name cleaned with sanitize-html before the report"
// ok
import express, { Request, Response } from 'express';
import sanitizeHtml from 'sanitize-html';
import { loadOrders } from './orders';

const app = express();

app.get('/reports/orders', async (req: Request, res: Response) => {
  const customer = String(req.query.customer ?? 'unknown');
  const orders = await loadOrders(customer);
  let html = '<html><body><h1>Order report</h1>';
  const safeName = sanitizeHtml(customer, { allowedTags: [], allowedAttributes: {} });
  html += '<h2>Customer: ' + safeName + '</h2><ul>';
  for (const order of orders) {
    html += '<li>' + order.id + ': ' + order.total + '</li>';
  }
  html += '</ul></body></html>';
  res.send(html);
});

app.listen(3004);
