// @bench category=command-injection cwe=CWE-78 framework=express pair=express-ping-host title="host from the request body concatenated onto a ping command"
import express, { Request, Response } from 'express';
import { exec } from 'child_process';

const app = express();
app.use(express.json());

app.post('/diagnostics/ping', (req: Request, res: Response) => {
  const host: string = req.body.host;
  const command = 'ping -c 2 ' + host;
  exec(command, { timeout: 5000 }, (error, stdout) => { // expect: security/no-shell-interpolation
    if (error) {
      res.status(502).json({ reachable: false });
      return;
    }
    res.json({ reachable: true, raw: stdout });
  });
});

app.listen(3000);
