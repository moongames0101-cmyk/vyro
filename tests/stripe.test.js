// VYRO+ with Stripe, against a pretend Stripe API: the server sets Stripe up from
// one secret key, sells with Managed Payments, and turns VYRO+ on from webhooks.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createVyroServer } = require('../server');
const { ensureStripeSetup } = require('../server/stripe');

const PUBLIC_URL = 'https://vyro-test.example';
const HOOK_URL = `${PUBLIC_URL}/api/plus/stripe/webhook`;

// A small stand-in for the parts of Stripe's API that VYRO uses.
function fakeStripe() {
  const state = { products: [], prices: [], hooks: [], portals: [], sessions: [], portalSessions: [], subs: {}, calls: [], refuseManaged: false };
  let n = 0;
  const id = (prefix) => `${prefix}_${++n}`;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://stripe.test');
    let body = '';
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(req.method === 'GET' || req.method === 'DELETE' ? url.search : body);
    const all = (name) => [...form.keys()].filter((k) => k.startsWith(`${name}[`)).map((k) => form.get(k));
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const p = url.pathname;
    state.calls.push(`${req.method} ${p}`);
    if (req.headers.authorization !== `Bearer ${process.env.STRIPE_SECRET_KEY}`) return send(401, { error: { message: 'Invalid API key' } });

    if (req.method === 'GET' && p === '/v1/prices') {
      const data = state.prices
        .filter((pr) => pr.active && pr.lookup_key === form.get('lookup_keys[]'))
        .map((pr) => ({ ...pr, product: state.products.find((prod) => prod.id === pr.product) }));
      return send(200, { data });
    }
    if (req.method === 'POST' && p === '/v1/products') {
      const prod = { id: id('prod'), name: form.get('name'), tax_code: form.get('tax_code') };
      state.products.push(prod);
      return send(200, prod);
    }
    if (req.method === 'POST' && p.startsWith('/v1/products/')) {
      const prod = state.products.find((x) => x.id === p.split('/').pop());
      prod.tax_code = form.get('tax_code');
      return send(200, prod);
    }
    if (req.method === 'POST' && p === '/v1/prices') {
      const price = {
        id: id('price'),
        product: form.get('product'),
        currency: form.get('currency'),
        unit_amount: Number(form.get('unit_amount')),
        recurring: { interval: form.get('recurring[interval]') },
        lookup_key: form.get('lookup_key'),
        tax_behavior: form.get('tax_behavior'),
        active: true
      };
      state.prices.push(price);
      return send(200, price);
    }
    if (req.method === 'GET' && p === '/v1/webhook_endpoints') return send(200, { data: state.hooks });
    if (p.startsWith('/v1/webhook_endpoints/')) {
      const hookId = p.split('/').pop();
      const hook = state.hooks.find((h) => h.id === hookId);
      if (!hook) return send(404, { error: { message: 'No such webhook endpoint' } });
      if (req.method === 'DELETE') {
        state.hooks = state.hooks.filter((h) => h !== hook);
        return send(200, { id: hookId, deleted: true });
      }
      const { secret, ...shown } = hook; // Stripe never shows the secret again
      return send(200, shown);
    }
    if (req.method === 'POST' && p === '/v1/webhook_endpoints') {
      const hook = { id: id('we'), url: form.get('url'), enabled_events: all('enabled_events'), status: 'enabled', secret: `whsec_${crypto.randomBytes(8).toString('hex')}` };
      state.hooks.push(hook);
      return send(200, hook);
    }
    if (req.method === 'POST' && p === '/v1/billing_portal/configurations') {
      const config = { id: id('bpc'), cancel: form.get('features[subscription_cancel][enabled]') };
      state.portals.push(config);
      return send(200, config);
    }
    if (req.method === 'POST' && p === '/v1/checkout/sessions') {
      if (state.refuseManaged && form.get('managed_payments[enabled]')) {
        return send(400, { error: { message: 'Managed Payments is not enabled on this account.' } });
      }
      state.sessions.push(Object.fromEntries(form));
      return send(200, { id: id('cs'), url: 'https://checkout.stripe.test/pay' });
    }
    if (req.method === 'GET' && p.startsWith('/v1/subscriptions/')) {
      const sub = state.subs[p.split('/').pop()];
      return sub ? send(200, sub) : send(404, { error: { message: 'No such subscription' } });
    }
    if (req.method === 'POST' && p === '/v1/billing_portal/sessions') {
      state.portalSessions.push(Object.fromEntries(form));
      return send(200, { url: 'https://billing.stripe.test/manage' });
    }
    return send(404, { error: { message: `Unknown ${req.method} ${p}` } });
  });
  return { state, server };
}

const savedEnv = {};
const ENV_KEYS = ['STRIPE_API_BASE', 'STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_MANAGED_PAYMENTS', 'VYRO_PUBLIC_URL', 'RENDER_EXTERNAL_URL'];
let stripe;
const dirs = [];
const running = new Set(); // servers still up, so a failed test can't leave the run hanging

test.before(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  stripe = fakeStripe();
  await new Promise((resolve) => stripe.server.listen(0, '127.0.0.1', resolve));
  process.env.STRIPE_API_BASE = `http://127.0.0.1:${stripe.server.address().port}`;
  process.env.STRIPE_SECRET_KEY = 'sk_test_vyro123';
  process.env.VYRO_PUBLIC_URL = PUBLIC_URL;
  for (const k of ['STRIPE_PRICE_ID', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_MANAGED_PAYMENTS', 'RENDER_EXTERNAL_URL']) delete process.env[k];
});

test.after(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  for (const app of running) await app.stop();
  stripe.server.closeAllConnections();
  await new Promise((resolve) => stripe.server.close(resolve));
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function startVyro(dataDir) {
  if (!dataDir) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyro-stripe-'));
    dirs.push(dataDir);
  }
  const app = createVyroServer({ port: 0, host: '127.0.0.1', dataDir });
  const stop = app.stop.bind(app);
  app.stop = () => {
    running.delete(app);
    return stop();
  };
  running.add(app);
  const { port } = await app.start();
  await ensureStripeSetup(app.db);
  const base = `http://127.0.0.1:${port}`;
  const call = async (pathname, { method = 'GET', token, body, headers = {} } = {}) => {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { app, dataDir, call };
}

function signed(raw, secret, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
}

let shared; // server, user and token used across the tests below, in order

test('one secret key is enough: the server makes the product, price, webhook and portal', async () => {
  shared = await startVyro();
  const { state } = stripe;
  assert.equal(state.products.length, 1);
  assert.equal(state.products[0].name, 'VYRO+');
  assert.equal(state.products[0].tax_code, 'txcd_10103000');
  assert.equal(state.prices.length, 1);
  assert.deepEqual(
    { amount: state.prices[0].unit_amount, currency: state.prices[0].currency, every: state.prices[0].recurring.interval, tax: state.prices[0].tax_behavior },
    { amount: 199, currency: 'gbp', every: 'month', tax: 'inclusive' }
  );
  assert.equal(state.hooks.length, 1);
  assert.equal(state.hooks[0].url, HOOK_URL);
  assert.deepEqual(state.hooks[0].enabled_events.sort(), [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.deleted',
    'customer.subscription.updated'
  ]);
  assert.equal(state.portals.length, 1);

  const su = await shared.call('/api/auth/signup', {
    method: 'POST',
    body: { email: 'payer@test.dev', username: 'payer', password: 'secret123', displayName: 'Payer', birthday: '2000-01-01', recoveryHint: 'test-phrase' }
  });
  assert.equal(su.status, 201);
  shared.token = su.data.token;
  shared.userId = su.data.user.id;
  const st = await shared.call('/api/plus/status', { token: shared.token });
  assert.equal(st.data.billing.card, true);
  assert.equal(st.data.billing.cardSeller, 'link');
  assert.equal(st.data.active, false);
});

test('checkout sells £1.99 a month through Managed Payments, tagged with the VYRO account', async () => {
  const res = await shared.call('/api/plus/checkout', { method: 'POST', token: shared.token });
  assert.equal(res.status, 200);
  assert.equal(res.data.url, 'https://checkout.stripe.test/pay');
  const session = stripe.state.sessions.at(-1);
  assert.equal(session.mode, 'subscription');
  assert.equal(session['managed_payments[enabled]'], 'true');
  assert.equal(session['line_items[0][price]'], stripe.state.prices[0].id);
  assert.equal(session['subscription_data[metadata][vyro_user]'], shared.userId);
  assert.equal(session.success_url, `${PUBLIC_URL}/#/app?plus=success`);
});

test('a signed webhook turns VYRO+ on; a forged one is refused', async () => {
  const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  stripe.state.subs.sub_1 = {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    metadata: { vyro_user: shared.userId },
    // Newer Stripe API versions keep the period on the item, not the subscription.
    items: { data: [{ current_period_end: periodEnd, price: { id: stripe.state.prices[0].id } }] }
  };
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { subscription: 'sub_1' } } });

  const forged = await shared.call('/api/plus/stripe/webhook', { method: 'POST', body: raw, headers: { 'Stripe-Signature': signed(raw, 'whsec_wrong') } });
  assert.equal(forged.status, 400);
  assert.equal((await shared.call('/api/plus/status', { token: shared.token })).data.active, false);

  const ok = await shared.call('/api/plus/stripe/webhook', { method: 'POST', body: raw, headers: { 'Stripe-Signature': signed(raw, stripe.state.hooks[0].secret) } });
  assert.equal(ok.status, 200);
  const st = await shared.call('/api/plus/status', { token: shared.token });
  assert.equal(st.data.active, true);
  assert.equal(st.data.renews, true);
  assert.equal(st.data.plusUntil, periodEnd * 1000);
});

test('cancelling keeps VYRO+ until the end of the month and stops renewal', async () => {
  const sub = { ...stripe.state.subs.sub_1, cancel_at: stripe.state.subs.sub_1.items.data[0].current_period_end };
  const raw = JSON.stringify({ type: 'customer.subscription.updated', data: { object: sub } });
  const res = await shared.call('/api/plus/stripe/webhook', { method: 'POST', body: raw, headers: { 'Stripe-Signature': signed(raw, stripe.state.hooks[0].secret) } });
  assert.equal(res.status, 200);
  const st = await shared.call('/api/plus/status', { token: shared.token });
  assert.equal(st.data.active, true);
  assert.equal(st.data.renews, false);
  assert.equal(st.data.cancelAtPeriodEnd, true);

  const portal = await shared.call('/api/plus/portal', { method: 'POST', token: shared.token });
  assert.equal(portal.status, 200);
  assert.equal(stripe.state.portalSessions.at(-1).customer, 'cus_1');
  assert.equal(stripe.state.portalSessions.at(-1).configuration, stripe.state.portals[0].id);
});

test('restarting the server makes nothing new in Stripe', async () => {
  await shared.app.stop();
  const callsBefore = stripe.state.calls.length;
  const again = await startVyro(shared.dataDir);
  assert.equal(stripe.state.calls.length, callsBefore);
  assert.equal((await again.call('/api/plus/status', { token: shared.token })).data.billing.card, true);
  await again.app.stop();
  assert.equal(stripe.state.products.length, 1);
  assert.equal(stripe.state.hooks.length, 1);
});

test('a server that lost its database reuses the price and replaces the webhook', async () => {
  const oldHook = stripe.state.hooks[0];
  const fresh = await startVyro();
  await fresh.app.stop();
  assert.equal(stripe.state.products.length, 1, 'no second product');
  assert.equal(stripe.state.prices.length, 1, 'no second price');
  assert.equal(stripe.state.hooks.length, 1, 'still one webhook');
  assert.notEqual(stripe.state.hooks[0].id, oldHook.id, 'the webhook whose secret was lost was replaced');
});

test('if Managed Payments is not switched on in Stripe, buyers get a plain message', async () => {
  stripe.state.refuseManaged = true;
  const vyro = await startVyro();
  const su = await vyro.call('/api/auth/signup', {
    method: 'POST',
    body: { email: 'early@test.dev', username: 'early', password: 'secret123', displayName: 'Early', birthday: '2000-01-01', recoveryHint: 'test-phrase' }
  });
  const res = await vyro.call('/api/plus/checkout', { method: 'POST', token: su.data.token });
  assert.equal(res.status, 503);
  assert.equal(res.data.error, 'Payments are not quite ready yet. Try again later.');
  stripe.state.refuseManaged = false;
  await vyro.app.stop();
});

test('without a Stripe key, VYRO+ stays "coming soon" and Stripe is never called', async () => {
  const key = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  const callsBefore = stripe.state.calls.length;
  try {
    const vyro = await startVyro();
    const su = await vyro.call('/api/auth/signup', {
      method: 'POST',
      body: { email: 'nokey@test.dev', username: 'nokey', password: 'secret123', displayName: 'NoKey', birthday: '2000-01-01', recoveryHint: 'test-phrase' }
    });
    const st = await vyro.call('/api/plus/status', { token: su.data.token });
    assert.equal(st.data.billing.card, false);
    assert.equal((await vyro.call('/api/plus/checkout', { method: 'POST', token: su.data.token })).status, 501);
    await vyro.app.stop();
  } finally {
    process.env.STRIPE_SECRET_KEY = key;
  }
  assert.equal(stripe.state.calls.length, callsBefore);
});
