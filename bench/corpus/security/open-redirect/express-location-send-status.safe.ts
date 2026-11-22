// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-location-send-status title="next mapped through a destination table to fixed paths"
// ok
import express, { Request, Response } from 'express';

const app = express();

const DESTINATIONS = new Map<string, string>([
  ['billing', '/settings/billing'],
  ['profile', '/settings/profile'],
]);

app.get('/jump', (req: Request, res: Response) => {
  res.set('Cache-Control', 'private, max-age=0');
  const destination = DESTINATIONS.get(String(req.query.next)) ?? '/';
  res.location(destination).sendStatus(302);
});

app.listen(3000);
