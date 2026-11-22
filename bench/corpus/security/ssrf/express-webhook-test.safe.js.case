// @bench category=ssrf cwe=CWE-918 framework=express pair=express-webhook-test title="callback hostname must match an anchored regex on the partner domain"
// ok
const express = require('express');
const axios = require('axios');

const router = express.Router();
const PARTNER_HOST = /^([a-z0-9-]+\.)*hooks\.example\.com$/;

router.post('/webhooks/test', express.json(), async (req, res) => {
  const { callbackUrl, event } = req.body;
  const target = new URL(callbackUrl);
  if (target.protocol !== 'https:' || !PARTNER_HOST.test(target.hostname)) {
    return res.status(400).json({ error: 'callback host not allowed' });
  }
  const payload = { event, sentAt: new Date().toISOString(), test: true };
  try {
    const result = await axios.post(target.toString(), payload, { timeout: 5000 });
    res.json({ status: result.status });
  } catch (err) {
    res.status(502).json({ error: 'delivery failed' });
  }
});

module.exports = router;
