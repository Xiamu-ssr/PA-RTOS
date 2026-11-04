import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {parseEnv} from 'node:util';
import {readConfig} from '../src/config.mjs';

process.umask(0o077);
const [root, address, baseUrl, model, api] = process.argv.slice(2);
if (!net.isIP(address)) throw new Error('Expected the server public IP');
const file = path.join(root, 'private.env');
const env = parseEnv(fs.readFileSync(file, 'utf8'));
const key = fs.readFileSync(0, 'utf8');
if (!key || /[\x00\r\n]/.test(key)) throw new Error('Expected a single-line API key on stdin');
Object.assign(env, {PA_ROOT: root, PA_HOST: net.isIP(address) === 6 ? '::' : '0.0.0.0',
  PA_TLS_CERT: path.join(root, 'server.pem'), PA_TLS_KEY: path.join(root, 'server.key'),
  PA_MODEL_BASE_URL: baseUrl, PA_MODEL_ID: model, PA_MODEL_API: api, PA_MODEL_API_KEY: key});
readConfig(env);
fs.writeFileSync(file, Object.entries(env).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n') + '\n', {mode: 0o600});
console.log('Private model and TLS configuration saved. No credentials printed.');
