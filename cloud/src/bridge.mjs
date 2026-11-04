import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {MAX_TEXT_BYTES, MAX_REPLY_BYTES} from './config.mjs';

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,95}$/;
const hash = value => crypto.createHash('sha256').update(value).digest();
const output = (res, status, value) => {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  res.end(JSON.stringify(value));
};
const publicJob = row => ({id: row.id, status: row.status,
  ...(row.reply !== null && {text: row.reply, truncated: !!row.truncated}),
  ...(row.error && {error: row.error})});

export class Jobs {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS messages (
        device TEXT NOT NULL, id TEXT NOT NULL, text TEXT NOT NULL,
        status TEXT NOT NULL, reply TEXT, truncated INTEGER NOT NULL DEFAULT 0,
        error TEXT, created INTEGER NOT NULL, PRIMARY KEY(device,id)
      ) STRICT;
      UPDATE messages SET status='outcome_unknown', error='cloud_restarted_during_request' WHERE status='running';`);
  }
  get(device, id) { return this.db.prepare('SELECT * FROM messages WHERE device=? AND id=?').get(device, id); }
  add(device, id, text) {
    this.db.prepare("INSERT INTO messages(device,id,text,status,created) VALUES (?,?,?,'queued',?) ON CONFLICT(device,id) DO NOTHING").run(device, id, text, Date.now());
    return this.get(device, id);
  }
  next() { return this.db.prepare("SELECT * FROM messages WHERE status='queued' ORDER BY created,rowid LIMIT 1").get(); }
  running(row) { this.db.prepare("UPDATE messages SET status='running' WHERE device=? AND id=?").run(row.device, row.id); }
  finish(row, status, reply = null, truncated = false, error = null) {
    this.db.prepare('UPDATE messages SET status=?,reply=?,truncated=?,error=? WHERE device=? AND id=?').run(status, reply, Number(truncated), error, row.device, row.id);
  }
  close() { this.db.close(); }
}

function boundedText(text) {
  let result = '', size = 0;
  for (const c of text) {
    const bytes = Buffer.byteLength(c);
    if (size + bytes > MAX_REPLY_BYTES) return {text: result, truncated: true};
    size += bytes; result += c;
  }
  return {text: result, truncated: false};
}

export function createBridge({config, devices, jobs, request = fetch, tls}) {
  if (!Array.isArray(devices) || !devices.length || devices.some(d => !/^[a-zA-Z0-9_-]{1,64}$/.test(d.id) || typeof d.token !== 'string' || d.token.length < 32) || new Set(devices.map(d => d.id)).size !== devices.length || new Set(devices.map(d => d.token)).size !== devices.length) throw new Error('Invalid private devices.json');
  const credentials = devices.map(d => ({id: d.id, digest: hash('Bearer ' + d.token)}));
  let pumping = false, closing = false;
  const authenticate = req => {
    const incoming = hash(req.headers.authorization || '');
    return credentials.find(d => crypto.timingSafeEqual(d.digest, incoming))?.id;
  };
  const pump = async () => {
    if (pumping || closing) return;
    pumping = true;
    try {
      let row;
      while (!closing && (row = jobs.next())) {
        jobs.running(row);
        try {
          const response = await request(config.gatewayUrl + '/v1/chat/completions', {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
            headers: {'authorization': 'Bearer ' + config.gatewayToken, 'content-type': 'application/json'},
            body: JSON.stringify({model: 'openclaw:main', user: 'pa-rtos-shared', stream: false,
              max_tokens: config.maxTokens, messages: [{role: 'user', content: row.text}]}),
          });
          // An unsuccessful transport/response does not prove that no tool ran.
          if (!response.ok) throw new Error('upstream_status');
          const body = await response.json(), text = body?.choices?.[0]?.message?.content;
          if (typeof text !== 'string' || !text.trim()) throw new Error('invalid_reply');
          const answer = boundedText(text);
          jobs.finish(row, 'done', answer.text, answer.truncated);
        } catch {
          jobs.finish(row, 'outcome_unknown', null, false, 'gateway_result_unconfirmed');
        }
      }
    } finally { pumping = false; }
  };
  const wake = () => { void pump().catch(() => console.error('Device queue storage unavailable; inspect private runtime storage.')); };
  const onRequest = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') return output(res, closing ? 503 : 200, {ok: !closing, protocol: 1});
      const device = authenticate(req);
      if (!device) return output(res, 401, {error: 'unauthorized'});
      if (url.pathname === '/api/config' && req.method === 'GET') return output(res, 200, {
        protocol: 1, deviceId: device, conversation: 'shared', input: ['text'], output: ['text'],
        maxTextBytes: MAX_TEXT_BYTES, maxReplyBytes: MAX_REPLY_BYTES,
      });
      if (url.pathname === '/api/messages' && req.method === 'POST') {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32768) { output(res, 413, {error: 'request_too_large'}); return; }
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return output(res, 400, {error: 'invalid_json'}); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['id', 'text'].includes(k)) || typeof body.id !== 'string' || !idPattern.test(body.id) || typeof body.text !== 'string' || !body.text.trim() || Buffer.byteLength(body.text) > MAX_TEXT_BYTES) return output(res, 400, {error: 'invalid_message'});
        const row = jobs.add(device, body.id, body.text);
        if (row.text !== body.text) return output(res, 409, {error: 'id_reused_with_different_text'});
        output(res, 202, publicJob(row)); wake(); return;
      }
      const match = url.pathname.match(/^\/api\/messages\/([a-zA-Z0-9_-]+)$/);
      if (match && req.method === 'GET') {
        const row = jobs.get(device, match[1]);
        return row ? output(res, 200, publicJob(row)) : output(res, 404, {error: 'message_not_found'});
      }
      return output(res, 404, {error: 'not_found'});
    } catch { if (!res.headersSent) output(res, 503, {error: 'temporarily_unavailable'}); else res.destroy(); }
  };
  const server = tls ? https.createServer(tls, onRequest) : http.createServer(onRequest);
  server.requestTimeout = 10000;
  return {server, wake, async close() {
    closing = true;
    await new Promise(resolve => server.close(resolve));
    server.closeIdleConnections();
    while (pumping) await new Promise(resolve => setTimeout(resolve, 20));
  }};
}
