import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readConfig, openClawConfig, OPENCLAW_VERSION} from './config.mjs';
import {Jobs, createBridge} from './bridge.mjs';

process.umask(0o077);
const c = readConfig();
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = path.join(packageRoot, 'node_modules/openclaw');
if (JSON.parse(fs.readFileSync(path.join(upstream, 'package.json'), 'utf8')).version !== OPENCLAW_VERSION) throw new Error('Run npm ci to restore the pinned OpenClaw');
const configFile = path.join(c.root, 'openclaw.json');
fs.writeFileSync(configFile, JSON.stringify(openClawConfig(c), null, 2), {mode: 0o600});
const devices = JSON.parse(fs.readFileSync(path.join(c.root, 'devices.json'), 'utf8')).devices;
const jobs = new Jobs(path.join(c.root, 'messages.sqlite'));
const gateway = spawn(process.execPath, [path.join(upstream, 'openclaw.mjs'), 'gateway', 'run', '--port', String(c.gatewayPort), '--bind', 'loopback'], {
  cwd: path.join(c.root, 'workspace'), stdio: ['ignore', 'inherit', 'inherit'],
  env: {...process.env, OPENCLAW_STATE_DIR: path.join(c.root, 'openclaw'), OPENCLAW_CONFIG_PATH: configFile,
    OPENCLAW_NO_RESPAWN: '1', OPENCLAW_DISABLE_MDNS: '1'},
});
let bridge, stopping = false;
const stop = async code => {
  if (stopping) return;
  stopping = true;
  gateway.kill('SIGTERM');
  if (bridge) await bridge.close();
  jobs.close(); process.exitCode = code;
};
process.once('SIGINT', () => { void stop(0); });
process.once('SIGTERM', () => { void stop(0); });
gateway.once('error', () => { console.error('OpenClaw could not start'); void stop(1); });
gateway.once('exit', () => { if (!stopping) { console.error('OpenClaw stopped'); void stop(1); } });
try {
  const deadline = Date.now() + 120000;
  let ready = false;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(c.gatewayUrl + '/startupz', {signal: AbortSignal.timeout(2000)});
      const body = await response.json();
      ready = response.ok && body.ok === true && body.status === 'started';
      if (ready) break;
    } catch { /* The Gateway has not bound its listener yet. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!stopping) {
    if (!ready) throw new Error('Gateway startup timed out');
    const tls = c.tlsCert ? {cert: fs.readFileSync(c.tlsCert), key: fs.readFileSync(c.tlsKey), minVersion: 'TLSv1.2'} : undefined;
    bridge = createBridge({config: c, devices, jobs, tls});
    await new Promise((resolve, reject) => { bridge.server.once('error', reject); bridge.server.listen(c.port, c.host, resolve); });
    bridge.wake();
    console.log(`PA-RTOS ready on ${tls ? 'https' : 'http'}://${c.host}:${c.port}; OpenClaw ${OPENCLAW_VERSION} stays on loopback.`);
  }
} catch { console.error('PA-RTOS startup failed; inspect private configuration and Gateway logs.'); await stop(1); }
