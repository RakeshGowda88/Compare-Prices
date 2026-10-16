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
  const m = html.match(/<meta[^>]+(?:property|itemprop|name)=["'](?:product:price:amount|og:price:amount|price)["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|itemprop|name)=["'](?:product:price:amount|og:price:amount|price)["']/i);
  return m ? num(m[1]) : null;
}

// Store-specific readers for sites without standard structured data.
const SITE = {
  // Bunnings renders the price in the page as data-locator="product-price">$416<sup>..</sup> (cents optional)
  'bunnings.com.au': h => {
    const m = h.match(/data-locator="product-price"[^>]*>\s*\$\s?(\d[\d,]*)(?:\s*<sup[^>]*>\s*\.?(\d{2})\s*<\/sup>)?/);
    return m ? num(m[1].replace(/,/g, '') + '.' + (m[2] || '00')) : null;
  },
  // Officeworks embeds the price in cents (GST included), e.g. "price":39500 = $395.00
  'officeworks.com.au': h => { const m = h.match(/"owProductPrice":\{"price":\{"[^"]+":\{"price":(\d+)/); return m ? num(m[1]) / 100 : null; },
};
export function extractSite(host, html) {
  for (const [d, f] of Object.entries(SITE)) if (host === d || host.endsWith('.' + d)) return f(html);
  return null;
}

async function check(url) {
  if (/(^|\.)amazon\./i.test(new URL(url).hostname)) return { status: 'manual only (Amazon terms)' };
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-AU' }, signal: AbortSignal.timeout(45000) });
    if (!r.ok) return { status: `blocked or unavailable (HTTP ${r.status})` };
    const html = await r.text();
    const price = extract(html) ?? extractSite(new URL(url).hostname.replace(/^www\./, ''), html);
    if (price) return { status: 'ok', price };
    const types = [...new Set([...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map(m => m[1]))].slice(0, 6).join(',');
    const title = ((html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '').trim().slice(0, 60);
    console.log(`  diag: title="${title}" length=${html.length} ldjson=${(html.match(/application\/ld\+json/g) || []).length} types=${types} priceMentions=${(html.match(/"price"/g) || []).length}`);
    [...html.matchAll(/"price"/g)].slice(0, 5).forEach(m => console.log('  price context:', html.slice(Math.max(0, m.index - 120), m.index + 80).replace(/\s+/g, ' ')));
    [...html.matchAll(/"[A-Za-z_]*[Pp]rice[A-Za-z_]*"\s*:\s*[^,}\]]{0,30}/g)].slice(0, 8).forEach(m => console.log('  price key:', m[0]));
    [...html.matchAll(/\$\s?\d{2,4}(?:\.\d{2})?/g)].slice(0, 5).forEach(m => console.log('  dollar text:', html.slice(Math.max(0, m.index - 80), m.index + 40).replace(/\s+/g, ' ')));
    return { status: 'price not found in page' };
  } catch (e) { return { status: `request failed (${e.cause?.code || e.name})` }; }
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
