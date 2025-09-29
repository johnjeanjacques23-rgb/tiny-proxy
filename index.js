const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

function filterHeaders(headers) {
  const out = {};
  headers.forEach((v,k) => {
    const kl = k.toLowerCase();
    if (kl === 'x-frame-options' || kl === 'content-security-policy' || kl === 'strict-transport-security') return;
    out[k] = v;
  });
  return out;
}

function isHtmlContentType(ct) {
  if (!ct) return false;
  ct = ct.toLowerCase();
  return ct.includes('text/html') || ct.includes('application/xhtml+xml');
}

app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('Missing url parameter');

  let parsed;
  try {
    parsed = new URL(target);
  } catch (e) {
    return res.status(400).send('Invalid url parameter');
  }

  try {
    const upstream = await fetch(target, {
      headers: { 'user-agent': req.headers['user-agent'] || 'Mozilla/5.0', 'accept': req.headers['accept'] || '*/*' },
      redirect: 'follow'
    });

    const headers = filterHeaders(upstream.headers);
    const contentType = upstream.headers.get('content-type') || '';

    if (isHtmlContentType(contentType)) {
      const text = await upstream.text();
      const $ = cheerio.load(text, { decodeEntities: false });
      const ATTRS = ['src','href','action','srcset'];
      $('*[src], *[href], *[action], img[srcset]').each((i, el) => {
        ATTRS.forEach(attr => {
          const val = $(el).attr(attr);
          if (!val) return;
          try {
            const abs = new URL(val, parsed).href;
            if (attr === 'srcset') {
              const parts = val.split(',');
              const newParts = parts.map(p => {
                const [urlPart, sizePart] = p.trim().split(/\s+/, 2);
                const absPart = new URL(urlPart, parsed).href;
                return `/proxy?url=${encodeURIComponent(absPart)}` + (sizePart ? ' ' + sizePart : '');
              });
              $(el).attr('srcset', newParts.join(', '));
            } else {
              $(el).attr(attr, `/proxy?url=${encodeURIComponent(abs)}`);
            }
          } catch (err) {}
        });
      });
      $('meta[http-equiv="Content-Security-Policy"]').remove();
      Object.entries(headers).forEach(([k,v]) => { try { res.setHeader(k, v); } catch(e){} });
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.send($.html());
    } else {
      const buffer = await upstream.buffer();
      Object.entries(headers).forEach(([k,v]) => { try { res.setHeader(k, v); } catch(e){} });
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('content-type', ct);
      return res.send(buffer);
    }

  } catch (err) {
    console.error('proxy error:', err);
    return res.status(500).send('Error fetching target: ' + err.message);
  }
});

app.listen(PORT, () => console.log(`Proxy server listening on port ${PORT}`));
