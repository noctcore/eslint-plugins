// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-location-send-status title="res.location with the next query value then a 302 status"
import express, { Request, Response } from 'express';

const app = express();

const DESTINATIONS = new Map<string, string>([
  ['billing', '/settings/billing'],
  ['profile', '/settings/profile'],
]);

app.get('/jump', (req: Request, res: Response) => {
  res.set('Cache-Control', 'private, max-age=0');
  res.location(String(req.query.next)).sendStatus(302); // expect: security/no-user-controlled-redirect
});

app.listen(3000);
