// @bench category=command-injection cwe=CWE-78 framework=express pair=express-ping-host title="host passed as an argument array to execFile, no shell"
// ok
import express, { Request, Response } from 'express';
import { execFile } from 'child_process';

const app = express();
app.use(express.json());

app.post('/diagnostics/ping', (req: Request, res: Response) => {
  const host: string = req.body.host;
  execFile('ping', ['-c', '2', host], { timeout: 5000 }, (error, stdout) => {
    if (error) {
      res.status(502).json({ reachable: false });
      return;
    }
    res.json({ reachable: true, raw: stdout });
  });
});

app.listen(3000);
