// VYRO+ (£1.99/month): status, customisation, and purchase verification.
//
// Nobody gets VYRO+ unless a payment provider confirms a real, paid subscription:
//   - Web / desktop: Stripe Checkout (card details never touch VYRO's server),
//     cancel any time from the Stripe customer portal.
//   - Google Play: Play Billing purchase tokens checked with the Google Play Developer API.
//   - Galaxy Store / App Store: not switched on yet, so they refuse rather than guess.
// Everything is switched off until the matching environment variables are set (see STORE-RELEASE.md).
const crypto = require('node:crypto');
const fs = require('node:fs');
const {
  readJsonBody,
  sendJson,
  publicUser,
  selfUser,
  isPlusActive,
  sanitizePlusStyle,
  parseJson,
  rateLimit,
  PLUS_NAME_COLORS,
  PLUS_NAME_EFFECTS,
  PLUS_NAME_FONTS,
  PLUS_THEMES,
  PLUS_BORDERS,
  PLUS_LABELS
} = require('../auth');
const { uid } = require('../db');

const PRICE_LABEL = '£1.99/month';
const ANDROID_PACKAGE = process.env.VYRO_ANDROID_PACKAGE || 'app.vyro.chat';
const GOOGLE_PRODUCT_ID = process.env.VYRO_GOOGLE_PLUS_PRODUCT || 'vyro_plus_monthly';
const GRACE_MS = 0;

// ---------- configuration ----------
function stripeConfig() {
  const key = process.env.STRIPE_SECRET_KEY;
  const price = process.env.STRIPE_PRICE_ID;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  return key && price && webhookSecret ? { key, price, webhookSecret } : null;
}

let cachedServiceAccount;
function googleServiceAccount() {
  if (cachedServiceAccount !== undefined) return cachedServiceAccount;
  cachedServiceAccount = null;
  try {
    let raw = process.env.VYRO_GOOGLE_SERVICE_ACCOUNT || '';
    if (!raw && process.env.VYRO_GOOGLE_SERVICE_ACCOUNT_FILE) {
      raw = fs.readFileSync(process.env.VYRO_GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8');
    }
    if (raw) {
      const sa = JSON.parse(raw);
      if (sa.client_email && sa.private_key) cachedServiceAccount = sa;
    }
  } catch (err) {
    console.error('[VYRO+] Could not read the Google service account:', err.message);
  }
  return cachedServiceAccount;
}

// The id the Android app passes to Play Billing so a purchase is tied to one VYRO account.
function accountRef(userId) {
  return crypto.createHash('sha256').update(`vyro-account:${userId}`).digest('hex');
}

function publicBaseUrl(req) {
  if (process.env.VYRO_PUBLIC_URL) return process.env.VYRO_PUBLIC_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  return `${proto}://${req.headers.host || 'localhost'}`;
}

// ---------- shared: apply a verified subscription to the account ----------
function recomputeUserPlus(db, wsHub, userId) {
  const now = Date.now();
  const subs = db
    .prepare("SELECT store, expires_at FROM subscriptions WHERE user_id = ? AND status = 'active'")
    .all(userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  let until = 0;
  let source = '';
  for (const s of subs) {
    if (Number(s.expires_at) > until) {
      until = Number(s.expires_at);
      source = s.store;
    }
  }
  // Gifts granted by an admin live directly on the user row.
  if (user.plus_source === 'gift' && Number(user.plus_until) > until) {
    until = Number(user.plus_until);
    source = 'gift';
  }
  if (until <= now) {
    until = Math.min(Number(user.plus_until || 0), now);
    source = user.plus_source || source;
  }

  const style = parseJson(user.plus_style, {});
  const styleJson = JSON.stringify(sanitizePlusStyle(style));
  db.prepare('UPDATE users SET plus_until = ?, plus_source = ?, plus_style = ? WHERE id = ?').run(
    until + GRACE_MS,
    source,
    styleJson,
    userId
  );
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (wsHub) {
    const pub = publicUser(updated);
    wsHub.broadcastAll('presence:update', { userId, presence: pub.presence, user: pub });
    wsHub.broadcastToUsers([userId], 'plus:update', { user: selfUser(updated) });
  }
  return updated;
}

function upsertSubscription(db, { userId, store, productId, token, orderId, entitled, expiresAt, autoRenewing, raw }) {
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM subscriptions WHERE purchase_token = ?').get(token);
  const status = entitled && expiresAt > now ? 'active' : 'inactive';
  if (existing) {
    db.prepare(
      'UPDATE subscriptions SET status = ?, expires_at = ?, auto_renewing = ?, order_id = ?, raw = ?, updated_at = ? WHERE id = ?'
    ).run(status, expiresAt, autoRenewing ? 1 : 0, orderId || existing.order_id, JSON.stringify(raw || {}), now, existing.id);
    return existing.user_id;
  }
  db.prepare(
    `INSERT INTO subscriptions (id, user_id, store, product_id, purchase_token, order_id, status, expires_at, auto_renewing, raw, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid('sub'), userId, store, productId, token, orderId || '', status, expiresAt, autoRenewing ? 1 : 0, JSON.stringify(raw || {}), now, now);
  return userId;
}

// ---------- Google Play ----------
let googleToken = { value: '', expiresAt: 0 };
async function googleAccessToken() {
  const sa = googleServiceAccount();
  if (!sa) throw Object.assign(new Error('Google Play billing is not set up on this server.'), { statusCode: 501 });
  if (googleToken.value && googleToken.expiresAt > Date.now() + 60000) return googleToken.value;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error('Could not sign in to Google Play.');
  googleToken = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return googleToken.value;
}

async function googleFetchSubscription(purchaseToken) {
  const access = await googleAccessToken();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
    ANDROID_PACKAGE
  )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${access}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error('Google Play did not recognise that purchase.'), { statusCode: 402 });
  }
  return data;
}

async function googleAcknowledge(productId, purchaseToken) {
  const access = await googleAccessToken();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
    ANDROID_PACKAGE
  )}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: '{}'
  }).catch(() => {});
}

const GOOGLE_ENTITLED = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED' // cancelled but paid up until the expiry time
]);

function readGoogleSubscription(info) {
  const items = Array.isArray(info.lineItems) ? info.lineItems : [];
  const ours = items.filter((li) => li.productId === GOOGLE_PRODUCT_ID);
  const expiresAt = Math.max(0, ...ours.map((li) => Date.parse(li.expiryTime) || 0));
  const autoRenewing = ours.some((li) => li.autoRenewingPlan && li.autoRenewingPlan.autoRenewEnabled);
  return {
    entitled: ours.length > 0 && GOOGLE_ENTITLED.has(info.subscriptionState),
    expiresAt,
    autoRenewing,
    orderId: info.latestOrderId || '',
    accountId: (info.externalAccountIdentifiers && info.externalAccountIdentifiers.obfuscatedExternalAccountId) || '',
    needsAck: info.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING',
    linkedToken: info.linkedPurchaseToken || ''
  };
}

// ---------- Stripe (web and desktop) ----------
async function stripeRequest(method, pathName, params) {
  const cfg = stripeConfig();
  if (!cfg) throw Object.assign(new Error('Card payments are not set up on this server yet.'), { statusCode: 501 });
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const res = await fetch(`https://api.stripe.com${pathName}${method === 'GET' && body ? `?${body}` : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: method === 'GET' ? undefined : body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || 'The payment provider refused the request.';
    throw Object.assign(new Error(msg), { statusCode: 502 });
  }
  return data;
}

function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.create(null);
  const sigs = [];
  for (const piece of String(header).split(',')) {
    const [k, v] = piece.split('=');
    if (k === 'v1') sigs.push(v);
    else parts[k] = v;
  }
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const exp = Buffer.from(expected);
  return sigs.some((s) => {
    const b = Buffer.from(String(s || ''));
    return b.length === exp.length && crypto.timingSafeEqual(b, exp);
  });
}

function readRawBody(req, maxBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const STRIPE_ENTITLED = new Set(['active', 'trialing', 'past_due']);
function applyStripeSubscription(db, wsHub, sub) {
  const userId = sub.metadata && sub.metadata.vyro_user;
  if (!userId || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) return;
  const item = sub.items && sub.items.data && sub.items.data[0];
  const periodEnd = Number(sub.current_period_end || (item && item.current_period_end) || 0) * 1000;
  upsertSubscription(db, {
    userId,
    store: 'stripe',
    productId: (item && item.price && item.price.id) || 'stripe',
    token: sub.id,
    orderId: sub.latest_invoice && typeof sub.latest_invoice === 'string' ? sub.latest_invoice : '',
    entitled: STRIPE_ENTITLED.has(sub.status),
    expiresAt: periodEnd,
    autoRenewing: !sub.cancel_at_period_end && sub.status !== 'canceled',
    raw: { customer: sub.customer, status: sub.status, cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end) }
  });
  recomputeUserPlus(db, wsHub, userId);
}

// ---------- status payload ----------
function plusStatus(db, user) {
  const latest = db
    .prepare('SELECT store, status, expires_at, auto_renewing, raw FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
    .get(user.id);
  const raw = latest ? parseJson(latest.raw, {}) : {};
  return {
    active: isPlusActive(user),
    plusUntil: Number(user.plus_until || 0),
    source: user.plus_source || '',
    renews: Boolean(latest && latest.auto_renewing && latest.status === 'active'),
    cancelAtPeriodEnd: Boolean(raw.cancelAtPeriodEnd),
    store: latest ? latest.store : '',
    priceLabel: PRICE_LABEL,
    style: sanitizePlusStyle(parseJson(user.plus_style, {})),
    accountRef: accountRef(user.id),
    googleProductId: GOOGLE_PRODUCT_ID,
    billing: {
      card: Boolean(stripeConfig()),
      cardInApk: process.env.VYRO_STRIPE_IN_APK === '1',
      google: Boolean(googleServiceAccount()),
      samsung: false,
      apple: false
    },
    manage: {
      google: `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(GOOGLE_PRODUCT_ID)}&package=${encodeURIComponent(ANDROID_PACKAGE)}`,
      card: Boolean(stripeConfig()) && Boolean(latest && latest.store === 'stripe')
    },
    options: {
      nameColors: PLUS_NAME_COLORS,
      nameEffects: PLUS_NAME_EFFECTS,
      nameFonts: PLUS_NAME_FONTS,
      themes: PLUS_THEMES,
      borders: PLUS_BORDERS,
      labels: PLUS_LABELS
    }
  };
}

async function handlePlusRoutes({ req, res, pathname, db, authUser, wsHub }) {
  if (!pathname.startsWith('/api/plus')) return false;

  // ----- webhooks (no user sign-in; verified by signature/secret instead) -----
  if (pathname === '/api/plus/stripe/webhook' && req.method === 'POST') {
    const cfg = stripeConfig();
    if (!cfg) return sendJson(res, 501, { error: 'Stripe is not set up.' });
    const raw = await readRawBody(req);
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'], cfg.webhookSecret)) {
      return sendJson(res, 400, { error: 'Bad signature.' });
    }
    const event = parseJson(raw, {});
    const obj = (event.data && event.data.object) || {};
    try {
      if (event.type === 'checkout.session.completed' && obj.subscription) {
        const sub = await stripeRequest('GET', `/v1/subscriptions/${encodeURIComponent(obj.subscription)}`);
        applyStripeSubscription(db, wsHub, sub);
      } else if (event.type && event.type.startsWith('customer.subscription.')) {
        applyStripeSubscription(db, wsHub, obj);
      }
    } catch (err) {
      console.error('[VYRO+] Stripe webhook error:', err.message);
      return sendJson(res, 500, { error: 'Try again.' });
    }
    return sendJson(res, 200, { received: true });
  }

  if (pathname === '/api/plus/google/rtdn' && req.method === 'POST') {
    const secret = process.env.VYRO_RTDN_SECRET;
    const urlObj = new URL(req.url, 'http://x');
    const given = Buffer.from(String(urlObj.searchParams.get('secret') || ''));
    const want = Buffer.from(String(secret || ''));
    if (!secret || given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      return sendJson(res, 403, { error: 'Forbidden.' });
    }
    const body = await readJsonBody(req);
    const data = parseJson(Buffer.from(String((body.message && body.message.data) || ''), 'base64').toString('utf8'), {});
    const note = data.subscriptionNotification;
    if (note && note.purchaseToken) {
      const row = db.prepare("SELECT user_id FROM subscriptions WHERE purchase_token = ? AND store = 'google'").get(note.purchaseToken);
      if (row) {
        try {
          const info = readGoogleSubscription(await googleFetchSubscription(note.purchaseToken));
          upsertSubscription(db, { userId: row.user_id, store: 'google', productId: GOOGLE_PRODUCT_ID, token: note.purchaseToken, ...info, raw: { state: data } });
          recomputeUserPlus(db, wsHub, row.user_id);
        } catch (err) {
          console.error('[VYRO+] Play notification error:', err.message);
          return sendJson(res, 500, { error: 'Try again.' });
        }
      }
    }
    return sendJson(res, 200, { ok: true });
  }

  if (!authUser) return sendJson(res, 401, { error: 'Authentication required.' });

  if (pathname === '/api/plus/status' && req.method === 'GET') {
    const fresh = recomputeUserPlus(db, null, authUser.id) || authUser;
    return sendJson(res, 200, plusStatus(db, fresh));
  }

  if (pathname === '/api/plus/style' && req.method === 'PATCH') {
    if (!isPlusActive(authUser)) return sendJson(res, 403, { error: 'VYRO+ customisation is for VYRO+ members.' });
    const body = await readJsonBody(req);
    const style = sanitizePlusStyle({ ...parseJson(authUser.plus_style, {}), ...body });
    db.prepare('UPDATE users SET plus_style = ? WHERE id = ?').run(JSON.stringify(style), authUser.id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(authUser.id);
    const pub = publicUser(updated);
    wsHub.broadcastAll('presence:update', { userId: authUser.id, presence: pub.presence, user: pub });
    return sendJson(res, 200, { user: selfUser(updated), style });
  }

  // Google Play: the app sends the purchase token it got from Play Billing.
  if (pathname === '/api/plus/verify' && req.method === 'POST') {
    const limit = rateLimit(`plus-verify:${authUser.id}`, 20, 60 * 60 * 1000);
    if (!limit.allowed) return sendJson(res, 429, { error: 'Too many attempts. Try again later.' });
    const body = await readJsonBody(req);
    const store = String(body.store || '');
    if (store === 'samsung') {
      return sendJson(res, 501, { error: 'Galaxy Store payments are not switched on yet.' });
    }
    if (store === 'apple') {
      return sendJson(res, 501, { error: 'App Store payments are not switched on yet.' });
    }
    if (store !== 'google') return sendJson(res, 400, { error: 'Unknown store.' });
    const token = String(body.purchaseToken || '').slice(0, 1024);
    if (!token) return sendJson(res, 400, { error: 'Missing purchase token.' });

    const owner = db.prepare('SELECT user_id FROM subscriptions WHERE purchase_token = ?').get(token);
    if (owner && owner.user_id !== authUser.id) {
      return sendJson(res, 409, { error: 'That purchase belongs to another VYRO account.' });
    }
    const info = readGoogleSubscription(await googleFetchSubscription(token));
    if (info.accountId && info.accountId !== accountRef(authUser.id)) {
      return sendJson(res, 409, { error: 'That purchase was made from another VYRO account.' });
    }
    if (!info.entitled) return sendJson(res, 402, { error: 'That subscription is not active.' });
    if (info.linkedToken) {
      db.prepare("UPDATE subscriptions SET status = 'replaced', updated_at = ? WHERE purchase_token = ?").run(Date.now(), info.linkedToken);
    }
    upsertSubscription(db, { userId: authUser.id, store: 'google', productId: GOOGLE_PRODUCT_ID, token, ...info, raw: { verifiedAt: Date.now() } });
    if (info.needsAck) await googleAcknowledge(GOOGLE_PRODUCT_ID, token);
    const updated = recomputeUserPlus(db, wsHub, authUser.id);
    return sendJson(res, 200, { user: selfUser(updated), status: plusStatus(db, updated) });
  }

  // Web / desktop: start a Stripe Checkout page. Stripe takes the card details, not VYRO.
  if (pathname === '/api/plus/checkout' && req.method === 'POST') {
    const cfg = stripeConfig();
    if (!cfg) return sendJson(res, 501, { error: 'Card payments are not switched on yet.' });
    if (isPlusActive(authUser) && authUser.plus_source !== 'gift') {
      return sendJson(res, 409, { error: 'You already have VYRO+.' });
    }
    const limit = rateLimit(`plus-checkout:${authUser.id}`, 10, 60 * 60 * 1000);
    if (!limit.allowed) return sendJson(res, 429, { error: 'Too many attempts. Try again later.' });
    const base = publicBaseUrl(req);
    const prior = db
      .prepare("SELECT raw FROM subscriptions WHERE user_id = ? AND store = 'stripe' ORDER BY updated_at DESC LIMIT 1")
      .get(authUser.id);
    const customer = prior ? parseJson(prior.raw, {}).customer : '';
    const params = {
      mode: 'subscription',
      'line_items[0][price]': cfg.price,
      'line_items[0][quantity]': '1',
      success_url: `${base}/#/app?plus=success`,
      cancel_url: `${base}/#/app?plus=cancelled`,
      client_reference_id: authUser.id,
      'subscription_data[metadata][vyro_user]': authUser.id,
      'metadata[vyro_user]': authUser.id,
      allow_promotion_codes: 'false'
    };
    if (customer) params.customer = customer;
    else if (authUser.email) params.customer_email = authUser.email;
    const session = await stripeRequest('POST', '/v1/checkout/sessions', params);
    return sendJson(res, 200, { url: session.url });
  }

  // Cancel any time: opens Stripe's own page to cancel, change card or see receipts.
  if (pathname === '/api/plus/portal' && req.method === 'POST') {
    const prior = db
      .prepare("SELECT raw FROM subscriptions WHERE user_id = ? AND store = 'stripe' ORDER BY updated_at DESC LIMIT 1")
      .get(authUser.id);
    const customer = prior ? parseJson(prior.raw, {}).customer : '';
    if (!customer) return sendJson(res, 404, { error: 'No card subscription found for this account.' });
    const session = await stripeRequest('POST', '/v1/billing_portal/sessions', {
      customer,
      return_url: `${publicBaseUrl(req)}/#/app`
    });
    return sendJson(res, 200, { url: session.url });
  }

  return sendJson(res, 404, { error: 'API endpoint not found.' });
}

// Admin gift (for testing or giveaways). Not reachable without an admin account.
function grantPlusGift(db, wsHub, userId, days) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const now = Date.now();
  const start = Math.max(now, Number(user.plus_until || 0));
  const until = days > 0 ? start + days * 24 * 60 * 60 * 1000 : now;
  db.prepare("UPDATE users SET plus_until = ?, plus_source = 'gift' WHERE id = ?").run(until, userId);
  return recomputeUserPlus(db, wsHub, userId);
}

module.exports = { handlePlusRoutes, grantPlusGift, verifyStripeSignature, accountRef };
