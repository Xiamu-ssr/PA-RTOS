import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {Jobs, createBridge} from '../src/bridge.mjs';
import {readConfig, openClawConfig, MAX_REPLY_BYTES} from '../src/config.mjs';

const token = 'synthetic-device-token-'.repeat(3);
const gatewayToken = 'synthetic-gateway-token-'.repeat(3);
const devices = [{id: 'handheld', token}, {id: 'other', token: 'synthetic-other-token-'.repeat(3)}];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t, request) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-rtos-test-'));
  const jobs = new Jobs(path.join(root, 'messages.sqlite'));
  const app = createBridge({config: {gatewayUrl: 'http://127.0.0.1:9', gatewayToken, timeoutMs: 1000, maxTokens: 2048}, devices, jobs, request});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const call = (p, body, secret = token) => fetch(url + p, {method: body ? 'POST' : 'GET',
    headers: {authorization: 'Bearer ' + secret, 'content-type': 'application/json'}, ...(body && {body: JSON.stringify(body)})});
  t.after(async () => { await app.close(); jobs.close(); fs.rmSync(root, {recursive: true, force: true}); });
  return {url, call, jobs};
}

async function settled(call, id) {
  for (let i = 0; i < 200; i++) {
    const row = await (await call('/api/messages/' + id)).json();
    if (!['queued', 'running'].includes(row.status)) return row;
    await sleep(5);
  }
  throw new Error('Test request did not settle');
}

test('device HTTP authenticates independently and the model receives only server-owned routing and the user text', async t => {
  const seen = [];
  const f = await fixture(t, async (url, options) => { seen.push({url, options}); return Response.json({choices: [{message: {content: '你好，已收到。'}}]}); });
  assert.equal((await f.call('/api/config', null, 'wrong')).status, 401);
  const config = await (await f.call('/api/config')).json();
  assert.equal(config.deviceId, 'handheld'); assert.deepEqual(config.input, ['text']);
  assert(!JSON.stringify(config).includes(gatewayToken));
  assert.equal((await f.call('/api/messages', {id: 'first-0001', text: '你好'})).status, 202);
  assert.equal((await settled(f.call, 'first-0001')).text, '你好，已收到。');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].options.headers.authorization, 'Bearer ' + gatewayToken);
  const body = JSON.parse(seen[0].options.body);
  assert.equal(body.model, 'openclaw:main'); assert.equal(body.user, 'pa-rtos-shared');
  assert.deepEqual(body.messages, [{role: 'user', content: '你好'}]);
  assert.equal((await f.call('/api/messages/first-0001', null, devices[1].token)).status, 404);
  assert.equal((await f.call('/api/messages', {id: 'extra-0001', text: 'hello', tools: []})).status, 400);
  assert.equal((await f.call('/api/messages', {id: 12345678, text: 'hello'})).status, 400);
});

test('retries of the same request do not rerun tools and an ID cannot acquire different input', async t => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async () => { calls++; await gate; return Response.json({choices: [{message: {content: 'done'}}]}); });
  const body = {id: 'repeat-0001', text: 'do this once'};
  assert.equal((await f.call('/api/messages', body)).status, 202);
  assert.equal((await f.call('/api/messages', body)).status, 202);
  assert.equal((await f.call('/api/messages', {...body, text: 'different'})).status, 409);
  release();
  assert.equal((await settled(f.call, body.id)).status, 'done');
  assert.equal((await f.call('/api/messages', body)).status, 202);
  assert.equal(calls, 1);
});

test('uncertain Gateway outcomes stay uncertain across retries and do not leak upstream errors or credentials', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; throw new Error('private transport detail ' + gatewayToken); });
  const body = {id: 'unknown-01', text: 'test'};
  await f.call('/api/messages', body);
  const row = await settled(f.call, body.id);
  assert.equal(row.status, 'outcome_unknown'); assert.equal(row.error, 'gateway_result_unconfirmed');
  assert(!JSON.stringify(row).includes(gatewayToken));
  await f.call('/api/messages', body); assert.equal(calls, 1);
});

test('restart preserves completed output and marks interrupted requests uncertain without replay', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-rtos-restart-')), file = path.join(root, 'messages.sqlite');
  let jobs = new Jobs(file);
  const complete = jobs.add('handheld', 'finished-01', 'one'); jobs.finish(complete, 'done', 'saved');
  const interrupted = jobs.add('handheld', 'running-01', 'two'); jobs.running(interrupted);
  jobs.add('handheld', 'queued-001', 'three'); jobs.close(); jobs = new Jobs(file);
  assert.equal(jobs.get('handheld', 'finished-01').reply, 'saved');
  assert.equal(jobs.get('handheld', 'running-01').status, 'outcome_unknown');
  assert.equal(jobs.next().id, 'queued-001'); jobs.close(); fs.rmSync(root, {recursive: true, force: true});
});

test('reply limits preserve UTF-8 and explicitly report truncation', async t => {
  const f = await fixture(t, async () => Response.json({choices: [{message: {content: '猫🐈'.repeat(5000)}}]}));
  await f.call('/api/messages', {id: 'large-0001', text: 'test'});
  const row = await settled(f.call, 'large-0001');
  assert.equal(row.truncated, true); assert(Buffer.byteLength(row.text) <= MAX_REPLY_BYTES);
  assert(!row.text.includes('\ufffd'));
});

test('a Chinese character split between HTTP chunks remains intact', async t => {
  let observed;
  const f = await fixture(t, async (_url, options) => { observed = JSON.parse(options.body).messages[0].content; return Response.json({choices: [{message: {content: 'received'}}]}); });
  const bytes = Buffer.from(JSON.stringify({id: 'chunks-001', text: '你好，掌机'}));
  const split = bytes.indexOf(Buffer.from('你')) + 1;
  await new Promise((resolve, reject) => {
    const req = http.request(f.url + '/api/messages', {method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'}}, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject); req.write(bytes.subarray(0, split)); setImmediate(() => req.end(bytes.subarray(split)));
  });
  assert.equal((await settled(f.call, 'chunks-001')).status, 'done'); assert.equal(observed, '你好，掌机');
});

test('deployment accepts custom model protocols without a ZenMux dependency and keeps keys out of generated config', () => {
  for (const protocol of ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai']) {
    const c = readConfig({PA_ROOT: path.join(os.tmpdir(), 'pa-rtos-config-test'), PA_MODEL_PROVIDER: 'custom',
      PA_MODEL_API: protocol, PA_MODEL_BASE_URL: 'https://models.example.test/v1', PA_MODEL_ID: 'custom-chat',
      PA_MODEL_API_KEY: 'synthetic-private-model-key', PA_GATEWAY_TOKEN: gatewayToken});
    const config = openClawConfig(c);
    assert.equal(config.models.providers.custom.api, protocol);
    assert.equal(config.agents.defaults.model.primary, 'custom/custom-chat');
    assert.equal(config.gateway.bind, 'loopback');
    assert(!JSON.stringify(config).includes('synthetic-private-model-key'));
    assert(!JSON.stringify(config).includes(gatewayToken));
    assert(!JSON.stringify(config).toLowerCase().includes('zenmux'));
  }
});

test('public listeners require TLS and incomplete certificate configuration is rejected', () => {
  const env = {PA_ROOT: path.join(os.tmpdir(), 'pa-rtos-config-test'),
    PA_MODEL_BASE_URL: 'https://models.example.test/v1', PA_MODEL_ID: 'custom-chat',
    PA_MODEL_API_KEY: 'synthetic-private-model-key', PA_GATEWAY_TOKEN: gatewayToken};
  assert.throws(() => readConfig({...env, PA_HOST: '0.0.0.0'}), /requires TLS/);
  assert.throws(() => readConfig({...env, PA_TLS_CERT: path.join(env.PA_ROOT, 'server.pem')}), /both/);
  const c = readConfig({...env, PA_HOST: '0.0.0.0',
    PA_TLS_CERT: path.join(env.PA_ROOT, 'server.pem'), PA_TLS_KEY: path.join(env.PA_ROOT, 'server.key')});
  assert.equal(c.host, '0.0.0.0');
  assert.equal(new URL(c.gatewayUrl).hostname, '127.0.0.1');
});
