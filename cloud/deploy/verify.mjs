import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import net from 'node:net';
import {parseEnv} from 'node:util';
import {readConfig} from '../src/config.mjs';

process.umask(0o077);
const [root, address] = process.argv.slice(2);
if (!net.isIP(address)) throw new Error('Expected the server public IP');
const config = readConfig(parseEnv(fs.readFileSync(path.join(root, 'private.env'), 'utf8')));
const cert = fs.readFileSync(config.tlsCert, 'utf8');
const device = JSON.parse(fs.readFileSync(path.join(root, 'devices.json'), 'utf8')).devices[0];
const local = `https://127.0.0.1:${config.port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function call(route, body, token = device.token) {
  return new Promise((resolve, reject) => {
    const request = https.request(local + route, {method: body ? 'POST' : 'GET', ca: cert,
      headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'}, timeout: 5000}, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 65536) response.destroy(new Error('Oversize response')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve({status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))}); } catch (e) { reject(e); }
      });
    });
    request.on('error', reject); request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.end(body ? JSON.stringify(body) : undefined);
  });
}
let ready = false;
for (let i = 0; i < 120; i++) {
  try { const r = await call('/health'); ready = r.status === 200 && r.body.ok === true; if (ready) break; } catch { /* startup pending */ }
  await delay(1000);
}
if (!ready) throw new Error('PA HTTPS startup did not become healthy; inspect pa-rtos.service');
if ((await call('/api/config', null, 'invalid-device-token')).status !== 401) throw new Error('Authentication check failed');
if ((await call('/api/config')).body.deviceId !== device.id) throw new Error('Device configuration check failed');
const id = crypto.randomUUID();
const submitted = await call('/api/messages', {id, text: '这是部署连通性验收。请只回复 PA-RTOS-READY。'});
if (submitted.status !== 202) throw new Error('Message submission failed');
let reply;
for (let i = 0; i < Math.ceil(config.timeoutMs / 1000) + 10; i++) {
  const r = await call('/api/messages/' + id);
  if (r.status !== 200) throw new Error('Message lookup failed');
  if (r.body.status === 'done') { reply = r.body.text; break; }
  if (r.body.status === 'outcome_unknown') throw new Error('Model result unconfirmed; inspect private Gateway logs, do not replay automatically');
  await delay(1000);
}
if (!reply?.includes('PA-RTOS-READY')) throw new Error('Real model verification did not produce the expected reply');
const host = net.isIP(address) === 6 ? `[${address}]` : address;
fs.writeFileSync(path.join(root, 'connection.json'), JSON.stringify({protocol: 1,
  baseUrl: `https://${host}:${config.port}`, deviceId: device.id,
  deviceToken: device.token, caCertificatePem: cert}, null, 2) + '\n', {mode: 0o600});
console.log('Local HTTPS, device authentication and a real OpenClaw model reply passed. Public network and RTOS hardware remain to be verified.');
