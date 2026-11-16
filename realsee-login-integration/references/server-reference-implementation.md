# 零依赖服务端参考实现

以下片段基于 Node 18+ 内置模块，展示 v2 的核心契约。把它当作结构参考，按宿主项目替换成员表、允许名单和错误响应。

## 配置

```js
import crypto from 'node:crypto';
import fs from 'node:fs';

const CONFIG = {
  publicOrigin: process.env.PUBLIC_ORIGIN || '',
  cookieName: process.env.SESSION_COOKIE_NAME || 'app_session',
  ttlSeconds: Number(process.env.SESSION_TTL_SECONDS || 86400),
  renewAfterSeconds: Number(process.env.SESSION_RENEW_AFTER_SECONDS || 3600),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  loginOrigin: process.env.REALSEE_LOGIN_ORIGIN || '',
  checkLoginPath: process.env.REALSEE_CHECK_LOGIN_PATH || '/open/v1/checkLogin',
  timeoutMs: Number(process.env.REALSEE_VERIFY_TIMEOUT_MS || 8000),
  maxTokenLength: 4096,
  maxUpstreamBytes: 64 * 1024,
  defaultExternalRole: process.env.EXTERNAL_DEFAULT_ROLE || 'user',
};
```

硬性要求：

- `publicOrigin` 必须配置；生产不要用请求头反推 origin。
- `cookieSecure` 由部署 scheme 决定，不能靠“有没有 host”判断。
- `timeoutMs` 必须有上限，禁止无限等待。

## 会话签名与校验

```js
let cachedSecret = null;

function sessionSecret() {
  if (cachedSecret) return cachedSecret;
  const file = process.env.SESSION_SECRET_FILE;
  if (!file) throw new Error('SESSION_SECRET_FILE 未配置');
  try {
    cachedSecret = fs.readFileSync(file, 'utf8').trim();
  } catch {
    cachedSecret = crypto.randomBytes(32).toString('base64url');
    fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
  }
  return cachedSecret;
}

function signSession(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    name: user.name || '',
    kind: user.kind || 'token',
    iat: now,
    exp: now + CONFIG.ttlSeconds,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySession(value) {
  if (!value || !value.includes('.')) return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;

  const expect = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

function sessionCookie(value, maxAge) {
  return `${CONFIG.cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
    + (CONFIG.cookieSecure ? '; Secure' : '');
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {}
    }
  }
  return out;
}
```

## 身份解析

```js
function resolveMember(member) {
  if (!member) return null;
  return {
    id: member.id,
    name: member.name || member.id,
    role: member.role === 'admin' ? 'admin' : 'user',
  };
}

function resolveIdentity(session) {
  if (!session || !session.id) return null;

  if (session.kind === 'token') {
    if (session.id === 'builtin-admin') {
      return { id: 'builtin-admin', name: '管理员', role: 'admin' };
    }
    const member = loadMembers().find((m) => m.id === session.id);
    return resolveMember(member);
  }

  if (session.kind === 'sso') {
    const isAdmin = loadAdminIds().includes(session.id);
    return {
      id: session.id,
      name: session.name || session.id,
      role: isAdmin ? 'admin' : CONFIG.defaultExternalRole,
    };
  }

  return null;
}
```

关键点：

- 角色不写进 Cookie；每次请求重新查成员表和允许名单。
- 成员被删除返回 `null`，旧会话立即失效。
- 移出管理员名单立刻降级为默认角色。
- 审计需要的内部 ID 可以保留，但不要把它与手机号组合。

## 访问令牌

```js
const BUILTIN_TOKEN = process.env.CONSOLE_TOKEN || '';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function memberByToken(token) {
  if (typeof token !== 'string' || !token || token.length > 200) return null;

  if (BUILTIN_TOKEN && safeEqualHex(sha256(token), sha256(BUILTIN_TOKEN))) {
    return { id: 'builtin-admin', name: '管理员', role: 'admin' };
  }

  const hash = sha256(token);
  for (const member of loadMembers()) {
    if (member.hash && safeEqualHex(member.hash, hash)) return resolveMember(member);
  }
  return null;
}
```

注意：

- `resolveMember` 必须存在；缺少时不要用空 `catch` 吞掉。
- 内置令牌比较也应走哈希 + timing-safe。
- 成员令牌写入会话时使用内部 ID，不使用令牌本身。

## 上游校验

```js
class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readLimited(response, maxBytes) {
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AuthError(503, '登录服务响应异常');
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function verifyExternalToken(token) {
  if (typeof token !== 'string' || !token || token.length > CONFIG.maxTokenLength) {
    throw new AuthError(401, '登录凭证无效');
  }

  let response;
  try {
    response = await fetch(CONFIG.loginOrigin + CONFIG.checkLoginPath, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: '{}',
      signal: AbortSignal.timeout(CONFIG.timeoutMs),
    });
  } catch {
    throw new AuthError(503, '登录服务暂时不可用');
  }

  if (!response.ok) throw new AuthError(503, '登录服务暂时不可用');

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new AuthError(503, '登录服务响应异常');
  }

  let body;
  try {
    body = JSON.parse(await readLimited(response, CONFIG.maxUpstreamBytes));
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(503, '登录服务响应异常');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AuthError(503, '登录服务响应异常');
  }

  if (body.code !== Number(process.env.REALSEE_SUCCESS_CODE || 100000)) {
    throw new AuthError(401, '登录凭证无效');
  }

  const data = body.data;
  const id = data && data.user_id_str;
  if (typeof id !== 'string' || !id || id.length > 200) {
    throw new AuthError(503, '登录服务响应异常');
  }

  return {
    id,
    name: typeof data.name === 'string' ? data.name.slice(0, 200) : '',
    avatar: typeof data.avatar === 'string' ? data.avatar.slice(0, 2048) : '',
  };
}
```

状态映射：

- 凭证无效 → 401；
- 上游故障、超时、非 JSON、超限、畸形 → 503；
- 成功码但用户 ID 无效 → 503。

## Origin 与限流

```js
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    if (process.env.ALLOW_NO_ORIGIN === 'true') return;
    throw new HttpError(403, '缺少来源');
  }
  if (!CONFIG.publicOrigin || origin !== CONFIG.publicOrigin) {
    throw new HttpError(403, '来源不允许');
  }
}

const buckets = new Map();

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.startedAt > windowMs) {
    buckets.set(key, { startedAt: now, count: 1 });
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) throw new HttpError(429, '请求过于频繁');

  if (buckets.size > 10000) {
    for (const [k, v] of buckets) {
      if (now - v.startedAt > windowMs) buckets.delete(k);
    }
  }
}
```

要求：

- 登录和 exchange 都要限流；键至少包含客户端 IP 和接口名。
- 只在可信代理配置后使用 `X-Forwarded-For`。
- 不要让限流 Map 无限增长。

## 辅助函数

以下函数由宿主按运行时补齐，参考实现只保留安全相关的骨架：

```js
function clientIp(request) {
  // 只有确认部署在可信代理后才使用 X-Forwarded-For
  return request.socket.remoteAddress || 'unknown';
}

async function readJsonBody(request, maxBytes) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new HttpError(413, '请求体过大');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, '请求格式错误');
  }
}

function maybeBootstrapAdmin(identity) {
  if (process.env.BOOTSTRAP_FIRST_ADMIN !== 'true') return;
  if (loadAdminIds().length > 0) return;
  appendAdminId(identity.id); // 0600 文件，原子写入
  audit({ id: identity.id, name: identity.name }, 'auth.bootstrap_admin', identity.id);
}
```

## exchange 处理骨架

```js
async function handleExchange(request, response) {
  assertSameOrigin(request);
  rateLimit(`exchange:${clientIp(request)}`, 10, 60_000);

  const body = await readJsonBody(request, 1024 * 1024);
  const identity = await verifyExternalToken(body && body.token);

  maybeBootstrapAdmin(identity);

  const role = loadAdminIds().includes(identity.id)
    ? 'admin'
    : CONFIG.defaultExternalRole;

  const session = signSession({
    id: identity.id,
    name: identity.name,
    kind: 'sso',
  });

  response.setHeader('Set-Cookie', sessionCookie(session, CONFIG.ttlSeconds));
  audit({ id: identity.id, name: identity.name }, 'auth.login', '', {
    via: 'sso',
    role,
  });

  json(response, 200, {
    user: { id: identity.id, name: identity.name, avatar: identity.avatar },
    role,
    isAdmin: role === 'admin',
  });
}
```

## 统一鉴权

```js
function authed(request, response) {
  const session = verifySession(parseCookies(request.headers.cookie)[CONFIG.cookieName]);
  if (session) {
    const identity = resolveIdentity(session);
    if (!identity) return null;

    const now = Math.floor(Date.now() / 1000);
    if (!session.iat || now - session.iat > CONFIG.renewAfterSeconds) {
      const renewed = signSession({ ...identity, kind: session.kind });
      response.setHeader('Set-Cookie', sessionCookie(renewed, CONFIG.ttlSeconds));
    }

    return { user: { id: identity.id, name: identity.name }, role: identity.role, via: session.kind };
  }

  const header = request.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token) {
    const member = memberByToken(token);
    if (member) return { user: member, role: member.role, via: 'token' };
  }

  return null;
}
```

## 审计

```js
function audit(user, action, target, extra) {
  if (!process.env.AUDIT_LOG_FILE) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    user: (user && user.id) || '-',
    name: (user && user.name) || '',
    action,
    target: target || '',
    ...(extra ? { extra } : {}),
  });
  fs.appendFileSync(process.env.AUDIT_LOG_FILE, line + '\n', { mode: 0o640 });
}
```

禁止把 token、Cookie、手机号、OTP、完整 body 或完整 callback query 传给 `audit`。

## 测试清单

- [ ] 有效 / 无效 / 超长 token
- [ ] 上游 5xx、超时、非 JSON、响应超限
- [ ] 成功码但缺用户 ID
- [ ] 成员令牌真实登录
- [ ] 成员删除后旧会话失效
- [ ] 移出管理员名单立即降权
- [ ] 滑动续期不超过间隔
- [ ] Origin 不匹配返回 403
- [ ] 限流触发 429
- [ ] 审计日志不含敏感值
