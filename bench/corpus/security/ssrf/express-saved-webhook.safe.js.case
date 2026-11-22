// @bench category=ssrf cwe=CWE-918 framework=express pair=express-saved-webhook title="stored webhook URL rechecked against the allowed hosts at send time"
// ok
const express = require('express');
const { db } = require('./fake-db');

const router = express.Router();
const HOOK_HOSTS = new Set(['hooks.example.com', 'events.example.com']);

router.post('/orders/:id/notify', async (req, res) => {
  const hook = await db.webhooks.findOne({ accountId: req.user.accountId });
  const order = await db.orders.findOne({ id: req.params.id });
  if (!hook || !order) return res.sendStatus(404);
  const target = new URL(hook.url);
  if (target.protocol !== 'https:' || !HOOK_HOSTS.has(target.hostname)) {
    return res.status(422).json({ error: 'webhook host not allowed' });
  }
  const result = await fetch(target, { method: 'POST', body: JSON.stringify(order) });
  res.json({ delivered: result.ok });
});

module.exports = router;
