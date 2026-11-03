/**
 * 用 OBS REST API（AWS4 签名）为对象设置 `Content-Disposition: inline`。
 *
 * 背景：OBS 控制台与 obsutil CLI 都不提供修改 Content-Disposition HTTP 头的能力
 * （`-meta=ContentDisposition:inline` 只写自定义元数据 `x-amz-meta-contentdisposition`，
 * 浏览器不认）。而 `public-read` ACL 会让 OBS 自动附上 `Content-Disposition: attachment`，
 * 导致浏览器把 index.html 当附件下载。唯一可行路径是直接 PUT Object 并带上
 * 标准的 `Content-Disposition` 请求头。
 *
 * 用法：
 *   node scripts/obs-set-disposition.mjs <bucket> <key> [<localFile>]
 *
 * 若省略 localFile，会先用 GET 把对象内容下载到内存再回写（避免内容丢失）。
 */
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REGION = 'cn-north-4';
const hostOf = (bucket) => `${bucket}.obs.${REGION}.myhuaweicloud.com`;
const SERVICE = 's3';

/**
 * 读取凭证。优先用华为云全局凭证库（`~/.config/huaweicloud/credentials.json`），
 * 因为 `~/.obsutilconfig` 会被外部工具反复覆写成加密/封装格式（ak 变 43 位），
 * 直接拿去做 AWS4 签名会得到 InvalidAccessKeyId。
 */
function loadCredentials() {
  const globalPath = join(homedir(), '.config', 'huaweicloud', 'credentials.json');
  try {
    const data = JSON.parse(readFileSync(globalPath, 'utf8'));
    const found = findAkSk(data);
    if (found) return found;
  } catch {
    // 回退到 obsutil 配置
  }

  const raw = readFileSync(join(homedir(), '.obsutilconfig'), 'utf8');
  const cfg = {};
  for (const line of raw.split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) cfg[match[1]] = match[2];
  }
  // 只接受标准长度的凭证（AK 20 位 / SK 40 位），否则视为被污染。
  if (cfg.ak?.length === 20 && cfg.sk?.length === 40) return { ak: cfg.ak, sk: cfg.sk };
  throw new Error('未找到可用的 AK/SK（全局凭证库与 obsutil 配置均无效）');
}

/** 在任意嵌套结构里找出成对的 ak/sk 字段。 */
function findAkSk(node) {
  if (!node || typeof node !== 'object') return null;
  const ak = node.ak ?? node.accessKeyId ?? node.accessKey;
  const sk = node.sk ?? node.secretAccessKey ?? node.secretKey;
  if (typeof ak === 'string' && typeof sk === 'string' && ak.length === 20 && sk.length === 40) {
    return { ak, sk };
  }
  for (const value of Object.values(node)) {
    const found = findAkSk(value);
    if (found) return found;
  }
  return null;
}

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** 形如 `20261102T084500Z` 的 x-amz-date。 */
function amzDateValue(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * 构造 AWS4-HMAC-SHA256 签名。
 * OBS 要求 SignedHeaders 必须包含 `host`，且 canonical headers 按名字字典序排列。
 */
function sign({ ak, sk, method, canonicalUri, headers, payloadHash }) {
  const amzDate = headers['x-amz-date'];
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${REGION}/${SERVICE}/aws4_request`;

  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${String(headers[name]).trim()}\n`)
    .join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${sk}`, day), REGION), SERVICE), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function putObject({ bucket, key, body, contentType, disposition }) {
  const { ak, sk } = loadCredentials();
  const HOST = hostOf(bucket);
  const canonicalUri = `/${key}`;
  const payloadHash = sha256Hex(body);
  const amzDate = amzDateValue();

  // 参与签名的头必须与实际发出的头完全一致（Content-Length 由 fetch 自动加，不参与签名）。
  const signed = {
    host: HOST,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    'content-type': contentType,
    'content-disposition': disposition,
    'x-amz-acl': 'public-read',
  };

  const authorization = sign({
    ak,
    sk,
    method: 'PUT',
    canonicalUri,
    headers: signed,
    payloadHash,
  });

  const response = await fetch(`https://${HOST}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      Host: HOST,
      'X-Amz-Date': amzDate,
      'X-Amz-Content-Sha256': payloadHash,
      'Content-Type': contentType,
      'Content-Disposition': disposition,
      'X-Amz-Acl': 'public-read',
      Authorization: authorization,
    },
    body,
  });

  return { status: response.status, body: await response.text() };
}

async function getObject({ bucket, key }) {
  const { ak, sk } = loadCredentials();
  const HOST = hostOf(bucket);
  const canonicalUri = `/${key}`;
  const payloadHash = sha256Hex(Buffer.alloc(0));
  const headers = {
    host: HOST,
    'x-amz-date': amzDateValue(),
    'x-amz-content-sha256': payloadHash,
  };
  const authorization = sign({
    ak, sk, method: 'GET', canonicalUri, headers, payloadHash,
  });

  const response = await fetch(`https://${HOST}${canonicalUri}`, {
    method: 'GET',
    headers: {
      Host: HOST,
      'X-Amz-Date': headers['x-amz-date'],
      'X-Amz-Content-Sha256': payloadHash,
      Authorization: authorization,
    },
  });
  if (!response.ok) throw new Error(`GET ${key} 失败：${response.status} ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

const [bucket, key, localFile, forcedType] = process.argv.slice(2);
if (!bucket || !key) {
  console.error('用法：node scripts/obs-set-disposition.mjs <bucket> <key> [<localFile>] [<contentType>]');
  process.exit(1);
}

const body = localFile ? readFileSync(localFile) : await getObject({ bucket, key });
const contentType =
  forcedType ??
  (key.endsWith('.html')
    ? 'text/html; charset=utf-8'
    : key.endsWith('.js')
      ? 'application/javascript; charset=utf-8'
      : key.endsWith('.json')
        ? 'application/json; charset=utf-8'
        : 'application/octet-stream');

const result = await putObject({
  bucket,
  key,
  body,
  contentType,
  disposition: 'inline',
});

console.log(JSON.stringify({ key, contentType, size: body.length, ...result }, null, 2));