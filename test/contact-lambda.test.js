const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, buildMailOptions } = require('../lambda/contact');

const valid = { name: 'Grace Hopper', email: 'grace@example.com', service: 'AI', message: 'First\nSecond' };
const configured = { EMAIL_FROM: 'sender@example.com', CONTACT_EMAIL: 'team@example.com', ALLOWED_ORIGIN: 'https://site.example' };

function harness(env = configured, error) {
  const sent = [];
  const handler = createHandler({ env, logErrors: false, createTransporter: () => ({ sendMail: async mail => { sent.push(mail); if (error) throw error; } }) });
  return { handler, sent };
}
const invoke = (handler, httpMethod, body) => handler({ httpMethod, body });
const json = res => JSON.parse(res.body);

test('Lambda accepts string and object bodies and constructs equivalent mail', async () => {
  for (const body of [JSON.stringify(valid), valid]) {
    const { handler, sent } = harness();
    const res = await invoke(handler, 'POST', body);
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).success, true);
    assert.equal(res.headers['Access-Control-Allow-Origin'], configured.ALLOWED_ORIGIN);
    assert.equal(sent[0].from, configured.EMAIL_FROM);
    assert.equal(sent[0].to, configured.CONTACT_EMAIL);
    assert.equal(sent[0].replyTo, valid.email);
    assert.match(sent[0].subject, /AI/);
    assert.match(sent[0].html, /First<br>Second/);
    assert.match(sent[0].text, /First\nSecond/);
  }
});

test('Lambda optional company is omitted or included', () => {
  assert.doesNotMatch(buildMailOptions(valid, configured).html, /Company:/);
  assert.match(buildMailOptions({ ...valid, company: 'Navy' }, configured).html, /Company:<\/strong> Navy/);
});

for (const field of ['name', 'email', 'service', 'message']) {
  test(`Lambda rejects missing ${field} without transport`, async () => {
    const { handler, sent } = harness();
    const body = { ...valid }; delete body[field];
    const res = await invoke(handler, 'POST', body);
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).success, false);
    assert.equal(sent.length, 0);
    assert.equal(res.headers['Access-Control-Allow-Origin'], configured.ALLOWED_ORIGIN);
  });
}

test('Lambda rejects malformed email, whitespace, malformed JSON, null and arrays', async () => {
  const bodies = [{ ...valid, email: 'nope' }, { ...valid, name: ' ' }, { ...valid, message: '\n' }, '{bad', null, []];
  for (const body of bodies) {
    const { handler, sent } = harness();
    const res = await invoke(handler, 'POST', body);
    assert.equal(res.statusCode, 400);
    assert.equal(sent.length, 0);
    assert.equal(res.headers['Access-Control-Allow-Origin'], configured.ALLOWED_ORIGIN);
  }
});

test('Lambda transport failures are stable, CORS-enabled, and do not leak', async () => {
  const { handler } = harness(configured, new Error('AWS secret detail'));
  const res = await invoke(handler, 'POST', valid);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(json(res), { success: false, message: 'Something went wrong. Please try again later.' });
  assert.equal(res.headers['Access-Control-Allow-Origin'], configured.ALLOWED_ORIGIN);
  assert.doesNotMatch(res.body, /secret/);
});

test('Lambda preflight and unsupported methods never send and always include CORS', async () => {
  const { handler, sent } = harness();
  const options = await invoke(handler, 'OPTIONS');
  assert.equal(options.statusCode, 200);
  assert.equal(options.body, '');
  const get = await invoke(handler, 'GET');
  assert.equal(get.statusCode, 405);
  assert.equal(json(get).message, 'Method not allowed');
  for (const res of [options, get]) assert.equal(res.headers['Access-Control-Allow-Origin'], configured.ALLOWED_ORIGIN);
  assert.equal(sent.length, 0);
});

test('Lambda defaults CORS origin to wildcard', async () => {
  const { handler } = harness({ EMAIL_FROM: 'a', CONTACT_EMAIL: 'b' });
  assert.equal((await invoke(handler, 'GET')).headers['Access-Control-Allow-Origin'], '*');
});
