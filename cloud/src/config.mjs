import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const OPENCLAW_VERSION = '2026.10.9';
export const MAX_TEXT_BYTES = 4096;
export const MAX_REPLY_BYTES = 16384;
const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const protocols = new Set(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai']);

function integer(value, fallback, min, max, name) {
  const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}`);
  return n;
}

export function privateRoot(value) {
  if (!value || !path.isAbsolute(value)) throw new Error('PA_ROOT must be an absolute private directory outside the checkout');
  const root = path.resolve(value), relative = path.relative(checkout, root);
  if (!relative || !relative.startsWith('..' + path.sep) && relative !== '..') throw new Error('Runtime data must stay outside the checkout');
  return root;
}

export function readConfig(env = process.env) {
  const root = privateRoot(env.PA_ROOT);
  const port = integer(env.PA_PORT, 19870, 1, 65535, 'PA_PORT');
  const gatewayPort = integer(env.PA_GATEWAY_PORT, 19871, 1, 65535, 'PA_GATEWAY_PORT');
  if (port === gatewayPort) throw new Error('Device and Gateway ports must differ');
  const protocol = env.PA_MODEL_API || 'openai-completions';
  if (!protocols.has(protocol)) throw new Error('Unsupported PA_MODEL_API');
  const provider = env.PA_MODEL_PROVIDER || 'custom';
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(provider)) throw new Error('Invalid PA_MODEL_PROVIDER');
  const model = env.PA_MODEL_ID;
  if (!model || model === 'your-model-id' || /[\s\x00-\x1f]/.test(model)) throw new Error('Configure PA_MODEL_ID in the private environment file');
  const base = new URL(env.PA_MODEL_BASE_URL);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.hostname.endsWith('.example.com')) throw new Error('Configure a valid PA_MODEL_BASE_URL');
  if (!env.PA_MODEL_API_KEY) throw new Error('Configure PA_MODEL_API_KEY in the private environment file');
  if (!env.PA_GATEWAY_TOKEN || env.PA_GATEWAY_TOKEN.length < 32) throw new Error('Missing private Gateway token; run init first');
  const contextWindow = integer(env.PA_MODEL_CONTEXT_WINDOW, 32000, 4096, 2000000, 'PA_MODEL_CONTEXT_WINDOW');
  const maxTokens = integer(env.PA_MODEL_MAX_TOKENS, 2048, 128, contextWindow - 2048, 'PA_MODEL_MAX_TOKENS');
  const host = env.PA_HOST || '127.0.0.1';
  const tlsCert = env.PA_TLS_CERT || '', tlsKey = env.PA_TLS_KEY || '';
  if (!!tlsCert !== !!tlsKey) throw new Error('Configure both PA_TLS_CERT and PA_TLS_KEY');
  if (tlsCert) { privateRoot(tlsCert); privateRoot(tlsKey); }
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !tlsCert) throw new Error('Non-loopback device access requires TLS');
  return {
    root, host, tlsCert, tlsKey, port, gatewayPort, provider, model, protocol,
    baseUrl: base.href.replace(/\/+$/, ''), contextWindow, maxTokens,
    gatewayToken: env.PA_GATEWAY_TOKEN,
    timeoutMs: integer(env.PA_REQUEST_TIMEOUT_MS, 180000, 1000, 3600000, 'PA_REQUEST_TIMEOUT_MS'),
    gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
  };
}

export function openClawConfig(c) {
  return {
    gateway: {mode: 'local', bind: 'loopback', port: c.gatewayPort,
      auth: {mode: 'token', token: '${PA_GATEWAY_TOKEN}'}, controlUi: {enabled: false},
      http: {endpoints: {chatCompletions: {enabled: true}}}},
    agents: {defaults: {workspace: path.join(c.root, 'workspace'), skipBootstrap: true,
      userTimezone: 'Asia/Shanghai', model: {primary: `${c.provider}/${c.model}`},
      heartbeat: {every: '0m'}}, entries: {main: {workspace: path.join(c.root, 'workspace')}}},
    models: {mode: 'replace', providers: {[c.provider]: {
      baseUrl: c.baseUrl, apiKey: '${PA_MODEL_API_KEY}', api: c.protocol, authHeader: true,
      models: [{id: c.model, name: c.model, input: ['text'], reasoning: false,
        contextWindow: c.contextWindow, maxTokens: c.maxTokens}],
    }}},
    session: {reset: {mode: 'none'}, resetTriggers: []},
    discovery: {mdns: {mode: 'off'}}, update: {checkOnStart: false}, logging: {level: 'warn'},
  };
}
