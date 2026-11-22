// @bench category=ssrf cwe=CWE-918 framework=express pair=express-saved-webhook title="stored webhook URL is read back from the db and posted to"
const express = require('express');
const { db } = require('./fake-db');

const router = express.Router();

router.post('/orders/:id/notify', async (req, res) => {
  const hook = await db.webhooks.findOne({ accountId: req.user.accountId });
  const order = await db.orders.findOne({ id: req.params.id });
  if (!hook || !order) return res.sendStatus(404);
  const result = await fetch(hook.url, { method: 'POST', body: JSON.stringify(order) }); // expect: security/no-user-controlled-fetch-url
  res.json({ delivered: result.ok });
});

module.exports = router;
