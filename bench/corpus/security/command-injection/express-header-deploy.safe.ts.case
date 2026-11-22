// @bench category=command-injection cwe=CWE-78 framework=express pair=express-header-deploy title="environment header checked against a Set allowlist before execaCommand"
// ok
import express from 'express';
import { execaCommand } from 'execa';

const app = express();
const ENVIRONMENTS = new Set(['staging', 'qa', 'production']);

app.post('/hooks/deploy', async (req, res) => {
  const target = req.get('x-deploy-env') ?? 'staging';
  if (!ENVIRONMENTS.has(target)) {
    res.status(400).json({ status: 'unknown environment' });
    return;
  }
  try {
    const { stdout } = await execaCommand(`./scripts/deploy.sh ${target}`);
    res.json({ status: 'deployed', stdout });
  } catch (err) {
    res.status(500).json({ status: 'failed' });
  }
});

app.listen(9000);
