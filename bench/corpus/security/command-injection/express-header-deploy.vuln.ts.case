// @bench category=command-injection cwe=CWE-78 framework=express pair=express-header-deploy title="environment header interpolated into execaCommand deploy script"
import express from 'express';
import { execaCommand } from 'execa';

const app = express();

app.post('/hooks/deploy', async (req, res) => {
  const target = req.get('x-deploy-env') ?? 'staging';
  try {
    const { stdout } = await execaCommand(`./scripts/deploy.sh ${target}`); // expect: security/no-shell-interpolation
    res.json({ status: 'deployed', stdout });
  } catch (err) {
    res.status(500).json({ status: 'failed' });
  }
});

app.listen(9000);
