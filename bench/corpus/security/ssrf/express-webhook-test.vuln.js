// @bench category=ssrf cwe=CWE-918 framework=express pair=express-webhook-test title="webhook tester posts a payload to the callbackUrl in the body"
const express = require('express');
const axios = require('axios');

const router = express.Router();

router.post('/webhooks/test', express.json(), async (req, res) => {
  const { callbackUrl, event } = req.body;
  const payload = { event, sentAt: new Date().toISOString(), test: true };
  try {
    const result = await axios.post(callbackUrl, payload, { timeout: 5000 }); // expect: security/no-user-controlled-fetch-url
    res.json({ status: result.status });
  } catch (err) {
    res.status(502).json({ error: 'delivery failed' });
  }
});

module.exports = router;
