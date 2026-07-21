const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const httpMocks = require('node-mocks-http');
const { createApp, buildMailOptions } = require('../server');

const valid = { name: 'Ada Lovelace', email: 'ada@example.com', service: 'Automation', message: 'Line one\nLine two' };
const env = { EMAIL_FROM: 'sender@example.com', CONTACT_EMAIL: 'team@example.com', ALLOWED_ORIGIN: 'https://client.example' };

function harness(overrides = {}) {
  const sent = [];
  const transporter = { sendMail: async mail => { sent.push(mail); if (overrides.error) throw overrides.error; } };
  return { app: createApp({ env, createTransporter: () => transporter, logErrors: false }), sent };
}

function request(app, method, body, headers = {}) {
  const req = httpMocks.createRequest({ method, url: '/api/contact', body, headers });
  const res = httpMocks.createResponse({ eventEmitter: EventEmitter });
  return new Promise((resolve, reject) => {
    res.on('end', () => resolve({
      status: res._getStatusCode(), body: res._isJSON() ? res._getJSONData() : res._getData(),
      headers: res._getHeaders(),
    }));
    try { app.handle(req, res); } catch (error) { reject(error); }
  });
}

test('Express sends a valid submission with configured and multiline email fields', async () => {
  const { app, sent } = harness();
  const res = await request(app, 'POST', valid, { origin: env.ALLOWED_ORIGIN });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true, message: "Thank you for your message! We'll get back to you soon." });
  assert.equal(res.headers['access-control-allow-origin'], env.ALLOWED_ORIGIN);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, env.EMAIL_FROM);
  assert.equal(sent[0].to, env.CONTACT_EMAIL);
  assert.equal(sent[0].replyTo, valid.email);
  assert.match(sent[0].subject, /Automation/);
  assert.match(sent[0].html, /Line one<br>Line two/);
  assert.match(sent[0].text, /Line one\nLine two/);
  assert.doesNotMatch(sent[0].html, /Company:/);
});

test('Express includes optional company and safely constructs HTML', () => {
  const mail = buildMailOptions({ ...valid, company: 'A & <B>' }, env);
  assert.match(mail.html, /Company:<\/strong> A &amp; &lt;B&gt;/);
  assert.match(mail.text, /Company: A & <B>/);
});

for (const field of ['name', 'email', 'service', 'message']) {
  test(`Express rejects missing ${field} without transport`, async () => {
    const { app, sent } = harness();
    const body = { ...valid }; delete body[field];
    const res = await request(app, 'POST', body);
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, 'Validation failed');
    assert.equal(sent.length, 0);
  });
}

test('Express rejects malformed email and whitespace-only values', async () => {
  for (const body of [{ ...valid, email: 'bad@' }, { ...valid, name: '  ' }, { ...valid, message: '\n ' }]) {
    const { app, sent } = harness();
    assert.equal((await request(app, 'POST', body)).status, 400);
    assert.equal(sent.length, 0);
  }
});

test('Express returns stable JSON on transport rejection', async () => {
  const { app } = harness({ error: new Error('secret SMTP detail') });
  const res = await request(app, 'POST', valid);
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { success: false, message: 'Something went wrong. Please try again later.' });
  assert.doesNotMatch(JSON.stringify(res.body), /secret/);
});

test('Express handles preflight and unsupported methods without email', async () => {
  const { app, sent } = harness();
  const preflight = await request(app, 'OPTIONS', undefined, { origin: env.ALLOWED_ORIGIN, 'access-control-request-method': 'POST' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], env.ALLOWED_ORIGIN);
  const get = await request(app, 'GET', undefined, { origin: env.ALLOWED_ORIGIN });
  assert.equal(get.status, 405);
  assert.deepEqual(get.body, { success: false, message: 'Method not allowed' });
  assert.match(get.headers.allow, /POST/);
  assert.equal(sent.length, 0);
});
