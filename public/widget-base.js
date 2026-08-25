/* SATUNO Bitcoin Pricing Widget v1.0.0 */
(function(){
'use strict';

// CONFIG — injected by server via query params
var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
var API = script ? (script.getAttribute('data-api') || 'https://satuno-shopify-app-production.up.railway.app') : 'https://satuno-shopify-app-production.up.railway.app';
var SHOP = script ? script.getAttribute('data-shop') : '';

var CONFIG = {
  currency:    'USD',
  denomination:'sats',
  color:       '#FF8A00',
  lightning:   '',
  showCheckout: false,
  plan:        'free',
};

var rate = 0;
var BADGE = 'stn-badge';

function log(msg) { console.log('[SATUNO]', msg); }

// Load settings from server
function loadSettings(cb) {
  if (!SHOP) { cb(); return; }
  fetch(API + '/api/settings?shop=' + SHOP)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.currency)     CONFIG.currency     = d.currency;
      if (d.denomination) CONFIG.denomination = d.denomination;
      if (d.badgeColor)   CONFIG.color        = d.badgeColor;
      if (d.lightning)    CONFIG.lightning    = d.lightning;
      CONFIG.showCheckout = !!d.showCheckout;
      CONFIG.plan         = d.plan || 'free';
      log('Settings: currency=' + CONFIG.currency + ' denom=' + CONFIG.denomination);
      cb();
    })
    .catch(function() { cb(); });
}

// Fetch BTC rate
function fetchRate(cb) {
  fetch(API + '/api/rate?currency=' + CONFIG.currency)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d && d.rate) {
        rate = d.rate;
        log('Rate: ' + rate + ' ' + CONFIG.currency);
        cb();
      }
    })
    .catch(function(e) { log('Rate error: ' + e); });
}

// Format sats/btc
function fmt(price) {
  var s = Math.round((price / rate) * 1e8);
  var btc = (price / rate).toFixed(6);
  var sLabel = s >= 1000000 ? (s/1000000).toFixed(1)+'M sats' : s >= 1000 ? Math.round(s/1000)+'k sats' : s+' sats';
  var bLabel = '\u20bf' + btc;
  if (CONFIG.denomination === 'btc')  return bLabel;
  if (CONFIG.denomination === 'both') return sLabel + ' / ' + bLabel;
  return sLabel;
}

// Inject CSS
function addStyles() {
  if (document.getElementById('stn-css')) return;
  var s = document.createElement('style');
  s.id = 'stn-css';
  s.textContent =
    '.stn-badge{display:inline-flex;align-items:center;background:rgba(255,138,0,.1);border:1px solid rgba(255,138,0,.3);border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;color:#FF8A00;margin-left:6px;white-space:nowrap;vertical-align:middle;font-family:system-ui,sans-serif;line-height:1.6}' +
    '.stn-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:999999;align-items:center;justify-content:center;padding:20px}' +
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

// Lightning modal
function openModal(sats, label) {
  var ex = document.getElementById('stn-modal');
  if (ex) ex.remove();
  var ln = CONFIG.lightning;
  var qrData = ln ? 'lightning:' + ln : 'lightning:satunohq@proton.me';
  var qr = 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=' + encodeURIComponent(qrData);
  var m = document.createElement('div');
  m.id = 'stn-modal';
  m.className = 'stn-modal open';
  m.innerHTML =
    '<div class="stn-card">' +
    '<button class="stn-x" id="stn-x">\u00d7</button>' +
    '<div style="font-size:15px;font-weight:700">\u26a1 Pay with Lightning</div>' +
    '<div class="stn-amt">' + sats.toLocaleString() + ' sats</div>' +
    '<div class="stn-sub">' + label + '</div>' +
    '<div class="stn-qw"><img src="' + qr + '" alt="QR"/></div>' +
    '<div class="stn-addr"><span>' + (ln || 'satunohq@proton.me') + '</span><button class="stn-cp" id="stn-cp">Copy</button></div>' +
    '<div class="stn-ws">' +
    '<a class="stn-wa" href="https://walletofsatoshi.com" target="_blank">Wallet of Satoshi</a>' +
    '<a class="stn-wa" href="https://strike.me" target="_blank">Strike</a>' +
    '<a class="stn-wa" href="https://muun.com" target="_blank">Muun</a>' +
    '</div>' +
    '<div style="font-size:10px;color:#333">Powered by SATUNO</div>' +
    '</div>';
  document.body.appendChild(m);
  document.getElementById('stn-x').onclick = function() { m.remove(); };
  m.onclick = function(e) { if (e.target === m) m.remove(); };
  document.getElementById('stn-cp').onclick = function() {
    var btn = this;
    navigator.clipboard.writeText(ln || 'satunohq@proton.me').then(function() {
      btn.textContent = '\u2713';
      setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
    });
  };
}

// Add badge to price element
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

  // Extract price — get first token with digits
  var text = el.textContent.trim();
  var tokens = text.split(/\s+/);
  var priceToken = '';
  for (var i = 0; i < tokens.length; i++) {
    if (/[0-9]/.test(tokens[i])) { priceToken = tokens[i]; break; }
  }
  if (!priceToken) return;

  var cleaned = priceToken.replace(/[^0-9.]/g, '');
  var price = parseFloat(cleaned);
  if (!price || price <= 0 || price > 9999999) return;

  el.dataset.stnDone = '1';
  var badge = document.createElement('span');
  badge.className = BADGE;
  badge.textContent = '~' + fmt(price);
  el.appendChild(badge);
}

// Add Lightning button on cart
function addCartButton() {
  if (!CONFIG.showCheckout) return;
  if (document.getElementById('stn-cart-btn')) return;

  var checkout =
    document.querySelector('[name="checkout"]') ||
    document.querySelector('.cart__checkout-button') ||
    document.querySelector('button[type="submit"][name="checkout"]');
  if (!checkout) return;

  var totalEl =
    document.querySelector('.totals__total-value') ||
    document.querySelector('.cart__total') ||
    document.querySelector('.cart-subtotal__price');

  var total = totalEl ? parseFloat(totalEl.textContent.replace(/[^0-9.]/g, '')) : 0;
  var sats = total ? Math.round((total / rate) * 1e8) : 0;

  var btn = document.createElement('button');
  btn.id = 'stn-cart-btn';
  btn.className = 'stn-cart';
  btn.innerHTML = '\u26a1 Pay with Lightning' + (sats ? ' \u00b7 ' + Math.round(sats/1000) + 'k sats' : '');
  btn.onclick = function() { openModal(sats, CONFIG.currency + ' ' + total.toLocaleString()); };
  checkout.parentNode.insertBefore(btn, checkout);
}

// Scan page
function scan() {
  var count = 0;
  SELECTORS.forEach(function(sel) {
    try {
      document.querySelectorAll(sel).forEach(function(el) {
        addBadge(el);
        count++;
      });
    } catch(e) {}
  });
  log('Scanned ' + count + ' elements');
  if (window.location.pathname.indexOf('/cart') > -1) addCartButton();
}

// Init
function init() {
  log('Widget starting — shop: ' + SHOP);
  addStyles();
  loadSettings(function() {
    log('Settings loaded — currency: ' + CONFIG.currency + ', denom: ' + CONFIG.denomination);
    fetchRate(function() {
      scan();
      if (window.MutationObserver) {
        new MutationObserver(function(muts) {
          var changed = muts.some(function(m) { return m.addedNodes.length > 0; });
          if (changed) setTimeout(scan, 500);
        }).observe(document.body, { childList: true, subtree: true });
      }
    });
  });
}

// Global API
window.SatunoWidget = {
  version: '1.0.0',
  refresh: function() {
    document.querySelectorAll('.' + BADGE).forEach(function(b) { b.remove(); });
    document.querySelectorAll('[data-stn-done]').forEach(function(el) { delete el.dataset.stnDone; });
    scan();
  },
  reloadSettings: function(cb) {
    loadSettings(function() {
      document.querySelectorAll('.' + BADGE).forEach(function(b) { b.remove(); });
      document.querySelectorAll('[data-stn-done]').forEach(function(el) { delete el.dataset.stnDone; });
      scan();
      if (cb) cb(CONFIG);
    });
  },
  config: function() { return CONFIG; }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
