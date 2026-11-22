// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-react-bio title="bio rendered as a React text child, no raw HTML"
// ok
import express from 'express';
import { renderToString } from 'react-dom/server';
import { getBio } from './bios';

function ProfilePage({ bio }: { bio: string }) {
  return (
    <main>
      <h1>Profile</h1>
      <div className="bio">{bio}</div>
    </main>
  );
}

const app = express();

app.get('/profile/:id', async (req, res) => {
  const bio = await getBio(req.params.id);
  res.send('<!doctype html>' + renderToString(<ProfilePage bio={bio} />));
});

app.listen(3005);
