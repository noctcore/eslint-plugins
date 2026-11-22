// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-cheerio-bio title="cheerio .text(bio) keeps the bio as plain text"
// ok
const express = require('express');
const cheerio = require('cheerio');
const { loadBio } = require('./bios');

const template = `<html><body><h1>Profile</h1><section id="bio"></section></body></html>`;
const app = express();

app.get('/bio/:id', async (req, res) => {
  const bio = await loadBio(req.params.id);
  const $ = cheerio.load(template);
  $('#bio').text(bio);
  $('h1').addClass('title');
  res.send($.html());
});

app.listen(3003);
