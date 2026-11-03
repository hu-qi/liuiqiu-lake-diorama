#!/usr/bin/env node
// devkit-mcp-client.mjs
// Minimal MCP stdio client to drive the HuaweiCloud DevKit MCP server directly,
// for use when the DevKit MCP is not loaded into the host agent session.
//
// Usage:
//   node scripts/devkit-mcp-client.mjs <tool_name> '<json_args>' [project_dir]
//   node scripts/devkit-mcp-client.mjs --list [project_dir]
//
// Example:
//   node scripts/devkit-mcp-client.mjs huaweicloud_sandbox_check_user '{}'
//   node scripts/devkit-mcp-client.mjs huaweicloud_sandbox_connect '{"source":"CLI"}'
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = '/Users/huqi/.codeartsdoer/huaweicloud-plugins/src/mcp-server.mjs';
const HCLOUD_BIN = existsSync('/Users/huqi/bin/hcloud') ? '/Users/huqi/bin/hcloud' : 'hcloud';

const here = dirname(fileURLToPath(import.meta.url));
const defaultProjectDir = resolve(here, '..');

const argv = process.argv.slice(2);
let projectDir = defaultProjectDir;
let mode = 'call';
let toolName = '';
let argsJson = '{}';

if (argv[0] === '--list') {
  mode = 'list';
  if (argv[1]) projectDir = resolve(argv[1]);
} else {
  toolName = argv[0];
  if (!toolName) {
    console.error('Usage: node scripts/devkit-mcp-client.mjs <tool_name> \'<json_args>\' [project_dir]');
    process.exit(2);
  }
  if (argv[1]) {
    try {
      JSON.parse(argv[1]);
      argsJson = argv[1];
    } catch {
      console.error('Invalid JSON for args:', argv[1]);
      process.exit(2);
    }
  }
  if (argv[2]) projectDir = resolve(argv[2]);
}

const child = spawn(process.execPath, [SERVER, '--codearts-project-dir', projectDir], {
  env: {
    ...process.env,
    HUAWEICLOUD_AGENT_TOOLKIT_MODE: 'local',
    HCLOUD_BIN,
    CODEARTS_PROJECT_DIR: projectDir,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let outBuf = '';
let stderrBuf = '';
const pending = new Map();
let finished = false;

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}

function done(code) {
  if (finished) return;
  finished = true;
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => process.exit(code), 50);
}

child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

child.stdout.on('data', (chunk) => {
  outBuf += chunk.toString();
  let lf;
  while ((lf = outBuf.indexOf('\n')) !== -1) {
    const line = outBuf.slice(0, lf).trim();
    outBuf = outBuf.slice(lf + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function rpc(method, params, id) {
  return new Promise((res) => {
    pending.set(id, res);
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function reportResult(tag, msg) {
  if (msg.error) {
    console.log(`[${tag}] ERROR code=${msg.error.code}: ${msg.error.message}`);
    return;
  }
  const content = msg.result?.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c.type === 'text') console.log(`[${tag}] ${c.text}`);
    }
  } else {
    console.log(`[${tag}] ${JSON.stringify(msg.result)}`);
  }
}

const timeout = setTimeout(() => {
  console.error('TIMEOUT after 180s. stderr tail:', stderrBuf.slice(-800));
  done(3);
}, 180000);

(async () => {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'codearts-devkit-driver', version: '1.0.0' },
    capabilities: {},
  }, 1);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  if (mode === 'list') {
    const msg = await rpc('tools/list', {}, 2);
    const tools = msg.result?.tools || [];
    console.log(tools.map((t) => t.name).join('\n'));
  } else {
    const msg = await rpc('tools/call', { name: toolName, arguments: JSON.parse(argsJson) }, 2);
    reportResult(toolName, msg);
  }
  clearTimeout(timeout);
  done(0);
})().catch((e) => {
  console.error('driver error:', e?.message || e);
  console.error('stderr tail:', stderrBuf.slice(-800));
  clearTimeout(timeout);
  done(1);
});