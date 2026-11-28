// Stripe for VYRO+, set up by the server itself.
//
// The only thing the owner provides is STRIPE_SECRET_KEY. With it, the server
// makes (or finds, if they already exist) everything else in the Stripe account:
//   - the "VYRO+" product, tagged as a personal-use online service for tax,
//   - its £1.99 a month price (VAT included),
//   - the webhook that tells VYRO when someone pays or cancels,
//   - the customer portal settings behind "Manage or cancel".
// What it made is remembered in the app_settings table, per Stripe key, so a
// restart or a second server never makes duplicates.
//
// Checkout uses Stripe Managed Payments (Stripe is the seller and handles VAT,
// refunds and disputes) unless STRIPE_MANAGED_PAYMENTS=0.
// STRIPE_PRICE_ID and STRIPE_WEBHOOK_SECRET still work and override what's made here.
const crypto = require('node:crypto');

const PLUS_LOOKUP_KEY = 'vyro_plus_monthly';
const PLUS_AMOUNT = 199; // pence
const PLUS_CURRENCY = 'gbp';
// "Software as a service - personal use": eligible for Managed Payments.
const PLUS_TAX_CODE = 'txcd_10103000';
const WEBHOOK_PATH = '/api/plus/stripe/webhook';
const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
];
const RETRY_AFTER_MS = 60 * 1000;

function secretKey() {
  return String(process.env.STRIPE_SECRET_KEY || '').trim();
}

function managedPayments() {
  return process.env.STRIPE_MANAGED_PAYMENTS !== '0';
}

function apiBase() {
  // Only tests point this somewhere else.
  return String(process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '');
}

function publicUrl() {
  return String(process.env.VYRO_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
}

// Settings are stored per key, so switching from a test key to a live key
// (or to another Stripe account) sets that one up separately.
function settingsKey(key) {
  return `stripe:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function loadSaved(db, key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(settingsKey(key));
  if (!row) return {};
  try {
    return JSON.parse(row.value) || {};
  } catch {
    return {};
  }
}

function save(db, key, value) {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(settingsKey(key), JSON.stringify(value), Date.now());
}

// Stripe's API takes form fields; arrays are written as name[0], name[1], ...
function formBody(params) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((item, i) => out.append(`${k}[${i}]`, String(item)));
    else out.append(k, String(v));
  }
  return out.toString();
}

async function stripeApi(key, method, pathName, params) {
  const body = formBody(params);
  const url = `${apiBase()}${pathName}${(method === 'GET' || method === 'DELETE') && body ? `?${body}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' || method === 'DELETE' ? undefined : body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || `Stripe said ${res.status}.`;
    throw Object.assign(new Error(msg), { statusCode: 502, stripeStatus: res.status });
  }
  return data;
}

async function ensurePrice(key) {
  const found = await stripeApi(key, 'GET', '/v1/prices', {
    'lookup_keys[]': PLUS_LOOKUP_KEY,
    active: 'true',
    'expand[]': 'data.product'
  });
  const existing = (found.data || [])[0];
  if (existing) {
    const product = existing.product || {};
    if (managedPayments() && product.id && product.tax_code !== PLUS_TAX_CODE && !(product.tax_code && product.tax_code.id === PLUS_TAX_CODE)) {
      await stripeApi(key, 'POST', `/v1/products/${encodeURIComponent(product.id)}`, { tax_code: PLUS_TAX_CODE });
    }
    return existing.id;
  }
  const product = await stripeApi(key, 'POST', '/v1/products', {
    name: 'VYRO+',
    description: 'Extra looks for your VYRO profile: name colours, effects, fonts, themes and borders.',
    tax_code: PLUS_TAX_CODE,
    'metadata[vyro]': 'plus'
  });
  const price = await stripeApi(key, 'POST', '/v1/prices', {
    product: product.id,
    currency: PLUS_CURRENCY,
    unit_amount: PLUS_AMOUNT,
    'recurring[interval]': 'month',
    lookup_key: PLUS_LOOKUP_KEY,
    tax_behavior: 'inclusive',
    nickname: 'VYRO+ monthly'
  });
  return price.id;
}

async function ensureWebhook(key, saved) {
  const base = publicUrl();
  if (!base) {
    throw new Error('VYRO does not know its public address. Set VYRO_PUBLIC_URL (Render sets it for you).');
  }
  const url = `${base}${WEBHOOK_PATH}`;
  if (saved.webhookId && saved.webhookSecret && saved.webhookUrl === url) {
    try {
      const hook = await stripeApi(key, 'GET', `/v1/webhook_endpoints/${encodeURIComponent(saved.webhookId)}`);
      if (hook.url === url && hook.status !== 'disabled') {
        return { webhookId: saved.webhookId, webhookSecret: saved.webhookSecret, webhookUrl: url };
      }
    } catch (err) {
      if (err.stripeStatus !== 404) throw err;
    }
  }
  // Stripe only shows a webhook's secret when it's made, so one we've lost the
  // secret for is no use: remove it and make a fresh one.
  const list = await stripeApi(key, 'GET', '/v1/webhook_endpoints', { limit: 100 });
  for (const hook of list.data || []) {
    if (hook.url === url) await stripeApi(key, 'DELETE', `/v1/webhook_endpoints/${encodeURIComponent(hook.id)}`);
  }
  const hook = await stripeApi(key, 'POST', '/v1/webhook_endpoints', {
    url,
    enabled_events: WEBHOOK_EVENTS,
    description: 'VYRO+ payments',
    'metadata[vyro]': 'plus'
  });
  return { webhookId: hook.id, webhookSecret: hook.secret, webhookUrl: url };
}

async function ensurePortal(key, saved) {
  if (saved.portalConfigId) return saved.portalConfigId;
  const config = await stripeApi(key, 'POST', '/v1/billing_portal/configurations', {
    'features[subscription_cancel][enabled]': 'true',
    'features[subscription_cancel][mode]': 'at_period_end',
    'features[payment_method_update][enabled]': 'true',
    'features[invoice_history][enabled]': 'true',
    'metadata[vyro]': 'plus'
  });
  return config.id;
}

const inFlight = new WeakMap(); // per database, in case one process runs more than one server
let lastFailure = { at: 0, key: '', message: '' };

// Makes sure everything exists in Stripe. Safe to call often: it does the work
// once per key, and waits a minute after a failure before trying again.
function ensureStripeSetup(db, { force = false } = {}) {
  const key = secretKey();
  if (!key) return Promise.resolve(null);
  if (inFlight.has(db)) return inFlight.get(db);
  const saved = loadSaved(db, key);
  const complete =
    (process.env.STRIPE_PRICE_ID || saved.priceId) &&
    (process.env.STRIPE_WEBHOOK_SECRET || (saved.webhookSecret && saved.webhookUrl === `${publicUrl()}${WEBHOOK_PATH}`)) &&
    saved.portalConfigId;
  if (complete && !force) return Promise.resolve(saved);
  if (!force && lastFailure.key === key && Date.now() - lastFailure.at < RETRY_AFTER_MS) {
    return Promise.resolve(null);
  }
  const run = (async () => {
    const next = { ...saved };
    next.priceId = process.env.STRIPE_PRICE_ID ? saved.priceId || '' : await ensurePrice(key);
    if (!process.env.STRIPE_WEBHOOK_SECRET) Object.assign(next, await ensureWebhook(key, saved));
    try {
      next.portalConfigId = await ensurePortal(key, saved);
    } catch (err) {
      // The account's own portal settings still work; only log it.
      console.warn('[VYRO+] Could not set up the Stripe customer portal:', err.message);
      next.portalConfigId = next.portalConfigId || 'default';
    }
    save(db, key, next);
    console.log(`[VYRO+] Stripe is ready (${key.includes('_test_') ? 'test mode' : 'live'}).`);
    return next;
  })()
    .catch((err) => {
      lastFailure = { at: Date.now(), key, message: err.message };
      console.error('[VYRO+] Stripe setup failed:', err.message);
      return null;
    })
    .finally(() => {
      inFlight.delete(db);
    });
  inFlight.set(db, run);
  return run;
}

// What checkout and the webhook need, if it's all there. Never calls Stripe.
function stripeConfig(db) {
  const key = secretKey();
  if (!key) return null;
  const saved = loadSaved(db, key);
  const price = process.env.STRIPE_PRICE_ID || saved.priceId;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || saved.webhookSecret;
  if (!price || !webhookSecret) return null;
  const portal = saved.portalConfigId && saved.portalConfigId !== 'default' ? saved.portalConfigId : '';
  return { key, price, webhookSecret, portal, managed: managedPayments() };
}

function lastStripeError() {
  return lastFailure.key === secretKey() ? lastFailure.message : '';
}

module.exports = {
  ensureStripeSetup,
  stripeConfig,
  stripeApi,
  lastStripeError,
  PLUS_LOOKUP_KEY,
  PLUS_TAX_CODE,
  WEBHOOK_PATH,
  WEBHOOK_EVENTS
};
