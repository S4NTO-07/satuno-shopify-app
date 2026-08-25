/**
 * SATUNO Bitcoin Pricing — Shopify App v1.0.0
 *
 * Routes:
 *   GET  /               — Install entry point
 *   GET  /auth           — Start OAuth
 *   GET  /auth/callback  — OAuth callback
 *   GET  /app            — Admin dashboard
 *   POST /api/settings   — Save merchant settings
 *   GET  /api/settings   — Get merchant settings
 *   GET  /api/rate       — Get live BTC rate
 *   GET  /widget.js      — Serve widget per merchant
 *   GET  /health         — Health check
 */

require('dotenv').config();

const express      = require('express');
const session      = require('express-session');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const crypto       = require('crypto');
const fetch        = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3001;

const SHOPIFY_API_KEY    = process.env.SHOPIFY_API_KEY    || '';
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || '';
const SHOPIFY_SCOPES     = process.env.SHOPIFY_SCOPES     || 'read_products,read_themes';
const APP_URL            = (process.env.APP_URL || 'http://localhost:3001').replace('http://', 'https://');
const SESSION_SECRET     = process.env.SESSION_SECRET     || 'satuno-dev-secret';
const SATUNO_API_URL     = process.env.SATUNO_API_URL     || 'https://satuno-api-production.up.railway.app';

// ── Merchant store with Railway Volume persistence ────────────────
const fs_store  = require('fs');
const path_store = require('path');

// Railway volumes mount at /data — fallback to /tmp
const DATA_DIR   = fs_store.existsSync('/data') ? '/data' : '/tmp';
const STORE_PATH = path_store.join(DATA_DIR, 'satuno-merchants.json');

function loadMerchants() {
  try {
    if (fs_store.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs_store.readFileSync(STORE_PATH, 'utf8'));
      console.log('Loaded merchants from:', STORE_PATH, Object.keys(data).length, 'stores');
      return data;
    }
  } catch(e) { console.error('Load merchants error:', e.message); }
  return {};
}

function saveMerchants(data) {
  try {
    fs_store.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
    console.log('Merchants saved to:', STORE_PATH);
  } catch(e) { console.error('Save merchants error:', e.message); }
}

const merchants = loadMerchants();

// ── Middleware ────────────────────────────────────────────────────
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// ── Helpers ───────────────────────────────────────────────────────
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function validateHmac(query) {
  const { hmac, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('&');
  const digest  = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(message).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

async function getAccessToken(shop, code) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code }),
  });
  return res.json();
}

async function getShopInfo(shop, token) {
  const res = await fetch(`https://${shop}/admin/api/2025-10/shop.json`, {
    headers: { 'X-Shopify-Access-Token': token }
  });
  return res.json();
}

async function getBTCRate(currency) {
  try {
    const res  = await fetch(`${SATUNO_API_URL}/v1/rates?currency=${currency}`);
    const data = await res.json();
    return data.btc_price || null;
  } catch(e) {
    try {
      const res  = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${currency.toLowerCase()}`);
      const data = await res.json();
      return data?.bitcoin?.[currency.toLowerCase()] || null;
    } catch(e2) { return null; }
  }
}

function defaultSettings(currency) {
  return {
    currency:     currency || 'MXN',
    denomination: 'sats',
    lightning:    '',
    showBadge:    true,
    showCheckout: false,
    badgeColor:   '#FF8A00',
    plan:         'free',
  };
}

// ── Routes ────────────────────────────────────────────────────────

// Root — install entry point
app.get('/', (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.send(`
      <html><body style="font-family:system-ui;padding:48px;background:#0d0d0d;color:#fff;text-align:center">
        <div style="font-size:48px;margin-bottom:16px">🟠</div>
        <h1 style="font-size:24px;margin-bottom:8px">SATUNO Bitcoin Pricing</h1>
        <p style="color:#666;margin-bottom:24px">Bitcoin, made useful. Install from the Shopify App Store.</p>
        <a href="https://satuno.com" style="color:#FF8A00;font-size:13px">satuno.com</a>
      </body></html>
    `);
  }
  res.redirect(`/auth?shop=${shop}`);
});

// Start OAuth
app.get('/auth', (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).send('Missing shop parameter');

  const nonce = generateNonce();

  // Store nonce in cookie (more reliable than session in stateless deploys)
  res.cookie('satuno_nonce', nonce, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 60000 });
  res.cookie('satuno_shop', shop, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 60000 });

  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}` +
    `&scope=${SHOPIFY_SCOPES}` +
    `&redirect_uri=${APP_URL}/auth/callback` +
    `&state=${nonce}`;

  res.redirect(authUrl);
});

// OAuth callback
app.get('/auth/callback', async (req, res) => {
  const { shop, code, state } = req.query;

  const storedNonce = req.cookies.satuno_nonce;
  const storedShop  = req.cookies.satuno_shop;

  if (!storedNonce || state !== storedNonce) {
    console.log('State mismatch:', { state, storedNonce });
    return res.status(403).send('State mismatch — please try installing again. <a href="/auth?shop=' + (shop||storedShop||'') + '">Retry</a>');
  }
  if (!validateHmac(req.query)) {
    return res.status(403).send('Invalid HMAC');
  }

  try {
    const tokenData = await getAccessToken(shop, code);
    const { access_token } = tokenData;
    if (!access_token) return res.status(400).send('Token exchange failed');

    const shopData = await getShopInfo(shop, access_token);
    const shopInfo = shopData.shop || {};

    merchants[shop] = {
      shop,
      accessToken: access_token,
      name:        shopInfo.name || shop,
      email:       shopInfo.email || '',
      installedAt: new Date().toISOString(),
      settings:    defaultSettings(shopInfo.currency),
    };

    saveMerchants(merchants);
    req.session.shop        = shop;
    req.session.accessToken = access_token;

    console.log(`✅ Installed: ${shop} (${shopInfo.name})`);
    res.redirect(`/app?shop=${shop}`);

  } catch(err) {
    console.error('Auth error:', err);
    res.status(500).send('Authentication failed. Please try again.');
  }
});

// Admin dashboard
app.get('/app', (req, res) => {
  const shop     = req.query.shop || req.session.shop;
  const merchant = merchants[shop];

  if (!merchant) return res.redirect(`/auth?shop=${shop || ''}`);

  const s     = merchant.settings;
  const isPro = s.plan === 'pro';

  res.setHeader('Content-Security-Policy',
    "frame-ancestors https://*.myshopify.com https://admin.shopify.com"
  );

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SATUNO Bitcoin Pricing</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --o:#FF8A00;--odim:rgba(255,138,0,0.08);--obrd:rgba(255,138,0,0.22);
  --bg:#0D0D0D;--card:#1A1816;--card2:#222018;
  --line:rgba(255,255,255,0.08);--text:#F2F0ED;--muted:#7A7570;
  --green:#22c55e;--gdim:rgba(34,197,94,0.08);--gbrd:rgba(34,197,94,0.2);
}
body{background:var(--bg);color:var(--text);font-family:'Space Grotesk',system-ui,sans-serif;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.page{max-width:640px;margin:0 auto;padding:32px 20px 80px}
.hdr{display:flex;align-items:center;gap:12px;margin-bottom:28px;padding-bottom:24px;border-bottom:1px solid var(--line)}
.hdr-logo{width:38px;height:38px;background:var(--o);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#000;flex-shrink:0}
.hdr-title{font-size:17px;font-weight:700;letter-spacing:-.3px}
.hdr-sub{font-size:12px;color:var(--muted);margin-top:2px}
.plan-pill{margin-left:auto;font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;background:${isPro?'var(--o)':'var(--card2)'};color:${isPro?'#000':'var(--muted)'};border:1px solid ${isPro?'var(--o)':'var(--line)'}}
.status{background:var(--gdim);border:1px solid var(--gbrd);border-radius:9px;padding:10px 14px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--green);margin-bottom:24px}
.status-dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.sec{margin-bottom:22px}
.sec-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:9px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.row{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--line);gap:12px}
.row:last-child{border-bottom:none}
.rl{font-size:13px;font-weight:500}
.rs{font-size:11px;color:var(--muted);margin-top:2px}
.lock{font-size:10px;color:var(--muted);margin-left:4px}
.sel{background:var(--card2);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:7px 10px;font-size:12px;font-family:inherit;outline:none;cursor:pointer;min-width:100px}
.sel:focus{border-color:var(--o)}
.inp{background:var(--card2);border:1px solid var(--line);color:var(--text);border-radius:7px;padding:8px 12px;font-size:12px;font-family:inherit;outline:none;width:200px;transition:border-color .15s}
.inp:focus{border-color:var(--o)}
.inp::placeholder{color:var(--muted);opacity:.5}
.tog{position:relative;width:42px;height:24px;flex-shrink:0}
.tog input{opacity:0;width:0;height:0;position:absolute}
.tog-t{position:absolute;inset:0;background:var(--card2);border:1px solid var(--line);border-radius:24px;cursor:pointer;transition:all .2s}
.tog-t::before{content:'';position:absolute;width:18px;height:18px;left:2px;top:2px;background:var(--muted);border-radius:50%;transition:all .2s}
.tog input:checked + .tog-t{background:var(--o);border-color:var(--o)}
.tog input:checked + .tog-t::before{transform:translateX(18px);background:#000}
.tog input:disabled + .tog-t{opacity:.4;cursor:not-allowed}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:8px;padding:11px 22px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;transition:all .15s;border:none;width:100%;margin-top:4px}
.btn-o{background:var(--o);color:#000}
.btn-o:hover{opacity:.88}
.preview{background:#000;border:1px solid var(--line);border-radius:9px;padding:16px;margin-top:12px}
.prev-price{font-size:20px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.prev-badge{background:rgba(255,138,0,0.08);border:1px solid rgba(255,138,0,0.25);border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600;color:var(--o)}
.pro-card{background:var(--card);border:1px solid var(--obrd);border-radius:12px;overflow:hidden;margin-top:28px}
.pro-hdr{background:linear-gradient(135deg,rgba(255,138,0,0.1),rgba(255,138,0,0.03));padding:16px;border-bottom:1px solid rgba(255,138,0,0.15);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.pro-name{font-size:14px;font-weight:700;display:flex;align-items:center;gap:7px}
.pro-lbl{background:var(--o);color:#000;font-size:9px;font-weight:800;padding:2px 7px;border-radius:4px;letter-spacing:.8px}
.pro-sub{font-size:11px;color:var(--muted);margin-top:2px}
.pro-feats{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line)}
.pro-feat{text-align:center;padding:12px 6px;border-right:1px solid var(--line);font-size:11px}
.pro-feat:last-child{border-right:none}
.pro-feat-i{font-size:16px;margin-bottom:3px}
.pro-feat-t{font-weight:600;color:var(--text)}
.pro-feat-s{color:var(--muted);margin-top:1px;font-size:10px}
.upgrade-btn{display:inline-flex;align-items:center;gap:5px;background:var(--o);color:#000;text-decoration:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:700;white-space:nowrap}
.upgrade-btn:hover{opacity:.88}
.save-toast{display:none;font-size:12px;color:var(--green);text-align:center;margin-top:8px;padding:8px;background:var(--gdim);border-radius:7px;border:1px solid var(--gbrd)}
.footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--muted)}
.footer a{color:var(--muted);text-decoration:none}
.footer a:hover{color:var(--o)}
</style>
</head>
<body>
<div class="page">

<div class="hdr">
  <div class="hdr-logo">₿</div>
  <div>
    <div class="hdr-title">SATUNO Bitcoin Pricing</div>
    <div class="hdr-sub">${merchant.name}</div>
  </div>
  <span class="plan-pill">${isPro ? 'PRO' : 'FREE'}</span>
</div>

<div class="status">
  <div class="status-dot"></div>
  Widget active · Showing Bitcoin prices on your store
</div>

<form id="settingsForm">

  <div class="sec">
    <div class="sec-label">General</div>
    <div class="card">
      <div class="row">
        <div><div class="rl">Store currency</div><div class="rs">Used to calculate sats prices</div></div>
        <select class="sel" name="currency" id="currencySelect">
          <option value="MXN" ${s.currency==='MXN'?'selected':''}>MXN — Mexican Peso</option>
          <option value="USD" ${s.currency==='USD'?'selected':''}>USD — US Dollar</option>
          <option value="ARS" ${s.currency==='ARS'?'selected':''}>ARS — Argentine Peso</option>
          <option value="COP" ${s.currency==='COP'?'selected':''}>COP — Colombian Peso</option>
          <option value="BRL" ${s.currency==='BRL'?'selected':''}>BRL — Brazilian Real</option>
          <option value="CLP" ${s.currency==='CLP'?'selected':''}>CLP — Chilean Peso</option>
          <option value="EUR" ${s.currency==='EUR'?'selected':''}>EUR — Euro</option>
          <option value="GBP" ${s.currency==='GBP'?'selected':''}>GBP — British Pound</option>
        </select>
      </div>
      <div class="row">
        <div><div class="rl">Display denomination</div><div class="rs">How to show Bitcoin prices</div></div>
        <select class="sel" name="denomination" id="denomSelect">
          <option value="sats" ${s.denomination==='sats'||!s.denomination?'selected':''}>⚡ Sats</option>
          <option value="btc" ${s.denomination==='btc'?'selected':''}>₿ BTC</option>
          <option value="both" ${s.denomination==='both'?'selected':''}>+ Both</option>
        </select>
      </div>
      <div class="row">
        <div><div class="rl">Show sats badge</div><div class="rs">Display sats price next to every product</div></div>
        <label class="tog"><input type="checkbox" name="showBadge" ${s.showBadge?'checked':''}><span class="tog-t"></span></label>
      </div>
      <div class="row">
        <div><div class="rl">Badge color</div><div class="rs">Accent color for the sats badge</div></div>
        <input type="color" name="badgeColor" value="${s.badgeColor||'#FF8A00'}" class="sel" style="width:56px;height:34px;padding:2px;cursor:pointer"/>
      </div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-label">Lightning payments</div>
    <div class="card">
      <div class="row">
        <div><div class="rl">Your Lightning address</div><div class="rs">Customers send payments here</div></div>
        <input type="text" class="inp" name="lightning" value="${s.lightning||''}" placeholder="you@walletofsatoshi.com"/>
      </div>
      <div class="row">
        <div>
          <div class="rl">Lightning button at checkout${!isPro?'<span class="lock">🔒 Pro</span>':''}</div>
          <div class="rs">Show "Pay with Lightning" on cart page</div>
        </div>
        <label class="tog"><input type="checkbox" name="showCheckout" ${s.showCheckout?'checked':''} ${!isPro?'disabled':''}><span class="tog-t"></span></label>
      </div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-label">Preview</div>
    <div class="card" style="padding:14px 16px">
      <div class="rs" style="margin-bottom:10px">How prices will look on your store:</div>
      <div class="preview">
        <div style="font-size:11px;color:#444;margin-bottom:8px">Product card</div>
        <div class="prev-price">
          <span id="prevPrice">$900.00</span>
          <span class="prev-badge" id="prevBadge">loading...</span>
        </div>
      </div>
    </div>
  </div>

  <button type="submit" class="btn btn-o">Save settings</button>
  <div class="save-toast" id="toast">✅ Settings saved successfully</div>

</form>

${!isPro ? `
<div class="pro-card">
  <div class="pro-hdr">
    <div>
      <div class="pro-name"><span class="pro-lbl">PRO</span>SATUNO Pro</div>
      <div class="pro-sub">Unlock Lightning payments + analytics</div>
    </div>
    <a href="mailto:satunohq@proton.me?subject=SATUNO Pro — ${shop}" class="upgrade-btn">
      Upgrade — $9/mo
    </a>
  </div>
  <div class="pro-feats">
    <div class="pro-feat"><div class="pro-feat-i">⚡</div><div class="pro-feat-t">Lightning checkout</div><div class="pro-feat-s">Pay button on cart</div></div>
    <div class="pro-feat"><div class="pro-feat-i">📊</div><div class="pro-feat-t">Analytics</div><div class="pro-feat-s">Payment stats</div></div>
    <div class="pro-feat"><div class="pro-feat-i">🎨</div><div class="pro-feat-t">Custom widget</div><div class="pro-feat-s">Full control</div></div>
  </div>
</div>
` : ''}

<div class="footer">
  <span>🟠 SATUNO · Bitcoin, made useful.</span>
  <div style="display:flex;gap:16px">
    <a href="https://satuno.com" target="_blank">satuno.com</a>
    <a href="mailto:satunohq@proton.me">Support</a>
    <a href="https://twitter.com/SatunoHQ" target="_blank">@SatunoHQ</a>
  </div>
</div>

</div>
<script>
var rateCache = {};

function loadPreview() {
  var cur   = document.getElementById('currencySelect').value;
  var denom = document.getElementById('denomSelect') ? document.getElementById('denomSelect').value : 'sats';
  fetch('/api/rate?currency=' + cur)
    .then(function(r){ return r.json(); })
    .then(function(d) {
      if (!d.rate) return;
      rateCache[cur] = d.rate;
      var price = cur === 'USD' ? 50 : cur === 'EUR' ? 45 : 900;
      var sats  = Math.round((price / d.rate) * 1e8);
      var btc   = (price / d.rate).toFixed(6);
      var sLabel = sats >= 1000 ? Math.round(sats/1000) + 'k sats' : sats + ' sats';
      var bLabel = '₿' + btc;
      var label  = denom === 'btc' ? bLabel : denom === 'both' ? sLabel + ' / ' + bLabel : sLabel;
      document.getElementById('prevBadge').textContent = '~' + label;
      document.getElementById('prevPrice').textContent = '$' + price.toFixed(2);
    }).catch(function(){
      document.getElementById('prevBadge').textContent = '~69k sats';
    });
}

document.getElementById('currencySelect').addEventListener('change', loadPreview);
if(document.getElementById('denomSelect')) document.getElementById('denomSelect').addEventListener('change', loadPreview);
loadPreview();

document.getElementById('settingsForm').addEventListener('submit', function(e) {
  e.preventDefault();
  var fd = new FormData(e.target);
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shop: '${shop}',
      settings: {
        currency:     fd.get('currency'),
        denomination: fd.get('denomination') || 'sats',
        lightning:    fd.get('lightning') || '',
        showBadge:    fd.get('showBadge') === 'on',
        showCheckout: fd.get('showCheckout') === 'on',
        badgeColor:   fd.get('badgeColor') || '#FF8A00',
      }
    })
  })
  .then(function(r){ return r.json(); })
  .then(function(d) {
    if (d.success) {
      var t = document.getElementById('toast');
      t.style.display = 'block';
      setTimeout(function(){ t.style.display = 'none'; }, 3000);
    }
  });
});
</script>
</body>
</html>`);
});

// API — live BTC rate
app.get('/api/rate', async (req, res) => {
  const currency = (req.query.currency || 'MXN').toUpperCase();
  const rate = await getBTCRate(currency);
  res.json({ rate, currency, updated: new Date().toISOString() });
});

// API — save settings
app.post('/api/settings', (req, res) => {
  const { shop, settings } = req.body;
  if (!shop || !merchants[shop]) return res.status(404).json({ success: false });
  merchants[shop].settings = { ...merchants[shop].settings, ...settings };
  saveMerchants(merchants);
  console.log('Settings updated:', shop, merchants[shop].settings);
  res.json({ success: true, settings: merchants[shop].settings });
});

// API — get settings (called by widget)
app.get('/api/settings', (req, res) => {
  const { shop } = req.query;
  // Always reload from file to get latest settings
  const fresh = loadMerchants();
  if (!shop || !fresh[shop]) return res.status(404).json({ error: 'Not found' });
  // Also update in-memory store
  if (fresh[shop]) merchants[shop] = fresh[shop];
  const s = fresh[shop].settings;
  res.json({ currency: s.currency, denomination: s.denomination||'sats', lightning: s.lightning||'', showBadge: s.showBadge !== false, showCheckout: !!s.showCheckout, badgeColor: s.badgeColor||'#FF8A00', plan: s.plan||'free' });
});

// Widget script — served from static file
const fs   = require('fs');
const path = require('path');

app.get('/widget.js', (req, res) => {
  const shop = req.query.shop || '';
  const widgetPath = path.join(__dirname, '../public/widget-base.js');

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const widgetCode = fs.readFileSync(widgetPath, 'utf8');
    res.send(widgetCode);
  } catch(err) {
    console.error('Widget file not found:', err);
    res.status(500).send('// Widget unavailable');
  }
});

// Webhook — uninstalled — uninstalled
app.post('/webhooks/app/uninstalled', (req, res) => {
  const shop = req.headers['x-shopify-shop-domain'];
  if (shop && merchants[shop]) { delete merchants[shop]; console.log(`Uninstalled: ${shop}`); }
  res.sendStatus(200);
});

// Health + debug
app.get('/health', (req, res) => {
  const fs2 = require('fs');
  res.json({
    status: 'ok',
    merchants: Object.keys(merchants).length,
    merchant_list: Object.keys(merchants),
    store_path: STORE_PATH,
    store_exists: fs2.existsSync(STORE_PATH),
    data_dir_exists: fs2.existsSync('/data'),
    ts: new Date().toISOString()
  });
});

// Debug — get merchant settings directly
app.get('/debug/merchant', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.json({ error: 'missing shop' });
  const m = merchants[shop];
  res.json({ found: !!m, settings: m ? m.settings : null });
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🟠 SATUNO Shopify App`);
  console.log(`   Port:    ${PORT}`);
  console.log(`   App URL: ${APP_URL}`);
  console.log(`   Install: ${APP_URL}?shop=STORE.myshopify.com\n`);
});

module.exports = app;
