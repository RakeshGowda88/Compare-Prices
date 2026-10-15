// Reads products.json (written by the site), fetches each product link,
// extracts the AUD price from the page's structured data, writes prices.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = 'PersonalPriceTracker/1.0 (+https://github.com; personal use, once daily)';
const products = existsSync('products.json') ? JSON.parse(readFileSync('products.json', 'utf8')) : [];

const num = v => { const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return n > 0 ? n : null; };

function fromOffer(o) {
  if (!o || typeof o !== 'object') return null;
  if (Array.isArray(o)) { const v = o.map(fromOffer).filter(Boolean); return v.length ? Math.min(...v) : null; }
  if (o.priceCurrency && o.priceCurrency !== 'AUD') return null;
  if (o.lowPrice != null) return num(o.lowPrice);
  if (o.price != null) return num(o.price);
  return fromOffer(o.priceSpecification) ?? fromOffer(o.offers);
}
function walk(n) {
  if (!n || typeof n !== 'object') return null;
  if (Array.isArray(n)) { for (const x of n) { const r = walk(x); if (r) return r; } return null; }
  if ([].concat(n['@type'] || []).includes('Product')) { const p = fromOffer(n.offers); if (p) return p; }
  return n['@graph'] ? walk(n['@graph']) : null;
}
export function extract(html) {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const p = walk(JSON.parse(m[1].trim())); if (p) return p; } catch {}
  }
  const m = html.match(/<meta[^>]+(?:property|itemprop|name)=["'](?:product:price:amount|og:price:amount)["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|itemprop|name)=["'](?:product:price:amount|og:price:amount)["']/i);
  return m ? num(m[1]) : null;
}

async function check(url) {
  if (/(^|\.)amazon\./i.test(new URL(url).hostname)) return { status: 'manual only (Amazon terms)' };
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-AU' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { status: `blocked or unavailable (HTTP ${r.status})` };
    const price = extract(await r.text());
    return price ? { status: 'ok', price } : { status: 'price not found in page' };
  } catch { return { status: 'request failed' }; }
}

async function main() {
  const results = {};
  for (const p of products) {
    for (const [store, url] of Object.entries(p.urls || {})) {
      let u; try { u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { continue; }
      const r = await check(u.href);
      (results[p.id] ??= {})[store] = { t: new Date().toISOString(), ...r };
      console.log(`${p.title} | ${store} | ${r.status} ${r.price ?? ''}`);
      await new Promise(res => setTimeout(res, 2000));
    }
  }
  writeFileSync('prices.json', JSON.stringify({ updated: new Date().toISOString(), results }, null, 2) + '\n');
}
if (!process.env.PT_NOMAIN) main();
