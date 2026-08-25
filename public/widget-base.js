/* SATUNO Bitcoin Pricing Widget v2.0 */
(function(){
'use strict';

var script = document.currentScript || document.querySelector('script[src*="widget.js"]');

function getParam(key, def) {
  try {
    var url = new URL(script ? script.src : '');
    return url.searchParams.get(key) || def;
  } catch(e) { return def; }
}

var API      = 'https://satuno-shopify-app-production.up.railway.app';
var CURRENCY = getParam('currency', 'USD');
var COLOR    = getParam('color', '#FF8A00');
var LIGHTNING = getParam('lightning', '');
var SHOW_CHECKOUT = getParam('checkout', 'false') === 'true';

// User preference stored in localStorage
var DENOM_KEY = 'satuno_denom';
var denom = localStorage.getItem(DENOM_KEY) || 'sats';

var rate = 0;
var BADGE = 'stn-badge';

function log(m) { console.log('[SATUNO]', m); }

// ── Styles ────────────────────────────────────────────────────────
function addStyles() {
  if (document.getElementById('stn-css')) return;
  var s = document.createElement('style');
  s.id = 'stn-css';
  s.textContent =
    '.stn-badge{display:inline-flex;align-items:center;background:rgba(255,138,0,.1);border:1px solid rgba(255,138,0,.3);border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;color:' + COLOR + ';margin-left:6px;white-space:nowrap;vertical-align:middle;font-family:system-ui,sans-serif;line-height:1.6}' +

    // Visitor toggle pill
    '#stn-toggle{position:fixed;bottom:20px;left:20px;z-index:999990;display:flex;align-items:center;gap:6px;background:#1a1a1a;border:1px solid #333;border-radius:30px;padding:6px 10px;font-family:system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.3)}' +
    '#stn-toggle .stn-lbl{font-size:11px;font-weight:700;color:#FF8A00;margin-right:2px}' +
    '#stn-toggle button{background:none;border:1px solid #444;color:#888;border-radius:20px;padding:3px 9px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s}' +
    '#stn-toggle button.active{background:#FF8A00;color:#000;border-color:#FF8A00}' +
    '#stn-toggle button:hover:not(.active){border-color:#FF8A00;color:#FF8A00}' +

    // Modal
    '.stn-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9999999;align-items:center;justify-content:center;padding:20px}' +
    '.stn-modal.open{display:flex}' +
    '.stn-card{background:#1a1a1a;border-radius:16px;padding:24px;max-width:320px;width:100%;text-align:center;font-family:system-ui,sans-serif;color:#fff;position:relative}' +
    '.stn-x{position:absolute;top:10px;right:14px;background:none;border:none;color:#666;font-size:22px;cursor:pointer}' +
    '.stn-x:hover{color:#fff}' +
    '.stn-amt{font-size:26px;font-weight:800;color:#FF8A00;margin:12px 0 4px}' +
    '.stn-sub{font-size:12px;color:#666;margin-bottom:14px}' +
    '.stn-qw{background:#fff;border-radius:8px;padding:8px;display:inline-block;margin-bottom:12px}' +
    '.stn-qw img{display:block;width:150px;height:150px}' +
    '.stn-addr{display:flex;align-items:center;gap:6px;background:#111;border:1px solid #222;border-radius:7px;padding:7px 10px;margin-bottom:12px}' +
    '.stn-addr span{flex:1;font-size:11px;font-family:monospace;color:#999;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.stn-cp{background:none;border:1px solid #333;color:#777;border-radius:4px;padding:3px 7px;font-size:10px;cursor:pointer}' +
    '.stn-ws{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:12px}' +
    '.stn-wa{font-size:11px;color:#FF8A00;text-decoration:none;background:rgba(255,138,0,.08);border:1px solid rgba(255,138,0,.2);border-radius:5px;padding:4px 9px}' +
    '.stn-cart{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:#FF8A00;color:#000;border:none;border-radius:8px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:10px;font-family:system-ui,sans-serif}' +
    '.stn-cart:hover{opacity:.88}';
  document.head.appendChild(s);
}

// ── Format price ──────────────────────────────────────────────────
function fmt(price) {
  var s = Math.round((price / rate) * 1e8);
  var btc = (price / rate).toFixed(6);
  var sLabel = s >= 1000000 ? (s/1000000).toFixed(1)+'M sats' : s >= 1000 ? Math.round(s/1000)+'k sats' : s+' sats';
  var bLabel = '\u20bf' + btc;
  if (denom === 'btc')  return bLabel;
  if (denom === 'both') return sLabel + ' / ' + bLabel;
  return sLabel;
}

// ── Visitor toggle ────────────────────────────────────────────────
function createToggle() {
  if (document.getElementById('stn-toggle')) return;
  var div = document.createElement('div');
  div.id = 'stn-toggle';
  div.innerHTML =
    '<span class="stn-lbl">\u20bf</span>' +
    '<button id="stn-btn-sats" class="' + (denom==='sats'?'active':'') + '">sats</button>' +
    '<button id="stn-btn-btc"  class="' + (denom==='btc' ?'active':'') + '">BTC</button>' +
    '<button id="stn-btn-both" class="' + (denom==='both'?'active':'') + '">both</button>';
  document.body.appendChild(div);

  ['sats','btc','both'].forEach(function(d) {
    document.getElementById('stn-btn-'+d).addEventListener('click', function() {
      denom = d;
      localStorage.setItem(DENOM_KEY, d);
      // Update active button
      ['sats','btc','both'].forEach(function(x) {
        document.getElementById('stn-btn-'+x).className = x === d ? 'active' : '';
      });
      // Refresh all badges
      document.querySelectorAll('.' + BADGE).forEach(function(b) { b.remove(); });
      document.querySelectorAll('[data-stn-done]').forEach(function(el) { delete el.dataset.stnDone; });
      scan();
    });
  });
}

// ── Lightning modal ───────────────────────────────────────────────
function openModal(sats, label) {
  var ex = document.getElementById('stn-modal');
  if (ex) ex.remove();
  var ln = LIGHTNING;
  var qr = 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=' + encodeURIComponent(ln ? 'lightning:'+ln : 'lightning:satunohq@proton.me');
  var m = document.createElement('div');
  m.id = 'stn-modal'; m.className = 'stn-modal open';
  m.innerHTML =
    '<div class="stn-card">' +
    '<button class="stn-x" id="stn-x">\u00d7</button>' +
    '<div style="font-size:15px;font-weight:700">\u26a1 Pay with Lightning</div>' +
    '<div class="stn-amt">'+sats.toLocaleString()+' sats</div>' +
    '<div class="stn-sub">'+label+'</div>' +
    '<div class="stn-qw"><img src="'+qr+'" alt="QR"/></div>' +
    '<div class="stn-addr"><span>'+(ln||'satunohq@proton.me')+'</span><button class="stn-cp" id="stn-cp">Copy</button></div>' +
    '<div class="stn-ws">' +
    '<a class="stn-wa" href="https://walletofsatoshi.com" target="_blank">Wallet of Satoshi</a>' +
    '<a class="stn-wa" href="https://strike.me" target="_blank">Strike</a>' +
    '<a class="stn-wa" href="https://muun.com" target="_blank">Muun</a>' +
    '</div><div style="font-size:10px;color:#333">Powered by SATUNO</div></div>';
  document.body.appendChild(m);
  document.getElementById('stn-x').onclick = function(){ m.remove(); };
  m.onclick = function(e){ if(e.target===m) m.remove(); };
  document.getElementById('stn-cp').onclick = function(){
    var b=this;
    navigator.clipboard.writeText(ln||'satunohq@proton.me').then(function(){
      b.textContent='\u2713'; setTimeout(function(){ b.textContent='Copy'; },1500);
    });
  };
}

// ── Badges ────────────────────────────────────────────────────────
var SELECTORS = [
  '.price-item--regular',
  '.price-item--sale',
  '.price__regular .price-item',
  '.price__sale .price-item--sale',
  '.product-price__price',
];

function addBadge(el) {
  if (!rate) return;
  if (el.dataset.stnDone) return;
  if (el.querySelector('.' + BADGE)) return;
  if (el.closest('header,nav,footer,[class*="announcement"]')) return;
  if (el.querySelector('.price-item')) return;

  var tokens = el.textContent.trim().split(/\s+/);
  var priceToken = '';
  for (var i = 0; i < tokens.length; i++) {
    if (/[0-9]/.test(tokens[i])) { priceToken = tokens[i]; break; }
  }
  if (!priceToken) return;

  var price = parseFloat(priceToken.replace(/[^0-9.]/g, ''));
  if (!price || price <= 0 || price > 9999999) return;

  el.dataset.stnDone = '1';
  var b = document.createElement('span');
  b.className = BADGE;
  b.textContent = '~' + fmt(price);
  el.appendChild(b);
}

function addCartButton() {
  if (!SHOW_CHECKOUT) return;
  if (document.getElementById('stn-cart-btn')) return;
  var checkout =
    document.querySelector('#CartDrawer-Checkout') ||
    document.querySelector('[name="checkout"]') ||
    document.querySelector('.cart__checkout-button');
  if (!checkout || !checkout.offsetParent) return;
  var totalEl =
    document.querySelector('.cart-drawer__footer .totals__total-value') ||
    document.querySelector('.totals__total-value') ||
    document.querySelector('.cart__total') ||
    document.querySelector('.cart-subtotal__price');
  var total = totalEl ? parseFloat(totalEl.textContent.replace(/[^0-9.]/g,'')) : 0;
  var sats = total ? Math.round((total/rate)*1e8) : 0;
  var label = sats >= 1000 ? Math.round(sats/1000)+'k sats' : sats+' sats';
  var btn = document.createElement('button');
  btn.id = 'stn-cart-btn'; btn.className = 'stn-cart';
  btn.innerHTML = '\u26a1 Pay with Lightning' + (sats ? ' \u00b7 ~'+label : '');
  btn.onclick = function(){ openModal(sats, CURRENCY+' '+total.toLocaleString()); };
  checkout.parentNode.insertBefore(btn, checkout);
  log('Lightning button added');
}

function scan() {
  SELECTORS.forEach(function(sel) {
    try { document.querySelectorAll(sel).forEach(addBadge); } catch(e) {}
  });
  addCartButton();
}

// ── Rate ──────────────────────────────────────────────────────────
function fetchRate(cb) {
  fetch(API + '/api/rate?currency=' + CURRENCY)
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.rate) { rate = d.rate; log('Rate: '+rate+' '+CURRENCY); cb(); }
    })
    .catch(function(e){ log('Rate error: '+e); });
}

// ── Init ──────────────────────────────────────────────────────────
function init() {
  log('Starting — currency:'+CURRENCY+' denom:'+denom);
  addStyles();
  fetchRate(function() {
    scan();
    createToggle();
    if (window.MutationObserver) {
      new MutationObserver(function(muts) {
        var ch = muts.some(function(m){ return m.addedNodes.length > 0; });
        if (ch) setTimeout(scan, 500);
      }).observe(document.body, { childList: true, subtree: true });
    }
  });
}

window.SatunoWidget = {
  version: '2.0',
  setDenom: function(d) {
    document.getElementById('stn-btn-'+d) && document.getElementById('stn-btn-'+d).click();
  },
  config: function() { return { currency: CURRENCY, denom: denom, rate: rate }; }
};

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', init)
  : init();

})();
