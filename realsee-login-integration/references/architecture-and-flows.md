# 架构、流程与服务端契约

## 信任边界

```text
浏览器
├── 登录页（公开）
├── 如视 SDK（手机号 / SSO）
│   └── 只产出短生命周期外部 token
├── 同源 exchange（公开但受限）
└── 业务请求（只带应用自己的 Cookie）

应用服务端
├── 出站调用如视 checkLogin
├── 成员表 / 管理员允许名单 / 环境变量保底
├── 身份解析（每次请求重算角色）
└── 签发应用会话 Cookie

业务数据
└── owner_id / owner_name / 审计日志
```

关键结论：

- 如视只负责“这个人是谁”，不负责“这个人能做什么”。
- 浏览器拿到的如视 token 只用于一次同源 exchange，不能直接访问业务 API。
- 业务 API 只认应用自己的会话或访问令牌。
- 角色判断发生在服务端，且每次请求都重新计算。

## 身份类型

| 类型 | 来源 | 标识 | 角色来源 |
| --- | --- | --- | --- |
| 如视账号 | `checkLogin` 返回的不可变用户 ID | `<EXTERNAL_USER_ID>` | 管理员允许名单；否则最低权限 |
| 成员令牌 | 管理员生成的访问令牌 | 内部 `id` | 成员表中的 `role` |
| 内置令牌 | 环境变量 | 固定内置 ID | 固定最高权限 |
| 本地应急账号 | 宿主已有账号体系 | 本地 ID | 本地角色 |

不要让这些命名空间互相碰撞。外部 ID 只用于映射，不要直接当本地用户名、Cookie 值或展示名。

## 手机号验证码流程

1. 登录页请求公开配置 `GET <CONFIG_PATH>`。
2. SDK 使用 `env / source / domain / callbackUri` 初始化。
3. 用户完成手机号 + captcha + OTP；SDK 产出如视 token。
4. 前端只把 token POST 到 `<EXCHANGE_PATH>`。
5. 服务端调用 `checkLogin`，校验状态、类型、业务码和用户 ID。
6. 服务端解析角色（管理员允许名单或最低权限）。
7. 服务端签发应用 Cookie，返回公开用户信息。
8. 前端按安全站内路径跳转。

失败语义：

- SDK 阶段失败：只展示错误码和诊断编号，不展示请求体。
- exchange 401：凭证无效或已过期，提示重新登录。
- exchange 503：上游不可用，提示稍后重试或改用访问令牌。

## SSO 流程

1. 前端生成高熵 state，写入 `sessionStorage`。
2. SDK 带 `state`、固定 `callbackUri` 和站内 `gotoUrl` 跳转登录中心。
3. 登录中心回到 callback 页面，URL 带 `token / state / gotoURL`。
4. callback 页面在最早阶段把字段暂存到内存，并 `history.replaceState` 清掉 query。
5. 前端读取预期 state 并立即删除；缺失、不匹配或已消费都拒绝。
6. 只把 token 交给同源 exchange。
7. 服务端验证并签发 Cookie。
8. 前端校验 `gotoUrl` 后跳转；非法值回退安全首页。

注意：

- 如果业务上隐藏了 SSO 入口，回调处理仍然存在，就必须保留 state 校验；否则应一并移除回调分支。
- callback exchange 必须优先于“已有旧 Cookie 就自动跳首页”的逻辑。
- 同一 state 不能复用；state 所在标签页关闭后重放必须失败。

## 访问令牌流程

1. 管理员生成随机令牌，只在生成时显示一次。
2. 服务端保存 `sha256(token)`，不保存明文。
3. 用户提交令牌；服务端做长度上限校验后计算哈希。
4. 使用 timing-safe 比较匹配成员记录。
5. 内置环境变量令牌直接映射到最高权限。
6. 签发与如视登录相同结构的会话，`kind = "token"`。
7. 更新 `last_login`，写审计日志。

访问令牌不能：

- 出现在 URL、前端持久化存储或日志；
- 用于浏览器端业务 API 的 `Authorization` header；
- 在成员被删除后继续有效。

## 会话格式

```text
value   = base64url(payloadJson) + "." + base64url(HMAC-SHA256(secret, payloadJson))
payload = { id, name, kind, iat, exp }
```

| 字段 | 说明 |
| --- | --- |
| `id` | 内部身份 ID；如视账号使用上游不可变 ID |
| `name` | 展示名，仅用于 UI，不参与授权 |
| `kind` | `sso` 或 `token`，决定解析路径 |
| `iat` | 签发时间，用于滑动续期节流 |
| `exp` | 绝对过期时间 |

Cookie 属性：

```text
<SESSION_COOKIE_NAME>=<value>; Path=/; HttpOnly; SameSite=Lax; Max-Age=<TTL>
```

- HTTPS 部署再加 `Secure`。
- 不要在 Cookie 中放如视 token、手机号、密码或权限列表。
- 密钥必须来自 secret store 或 `0600` 文件；轮换密钥等于让全部会话失效。
- 签名校验使用 timing-safe 比较；payload 解析失败、缺字段、过期或签名不符一律返回未登录。

## 身份解析

```text
resolveIdentity(session):
  if session.kind == "token":
    if session.id == BUILTIN_ADMIN_ID:
      return { id, role: "admin", kind: "token" }
    member = loadMembers().find(id == session.id)
    if not member:
      return null                       # 成员被删，旧会话立即失效
    return { id, name, role: member.role, kind: "token" }

  if session.kind == "sso":
    isAdmin = adminAllowlist.includes(session.id)
              or envAdminIds.includes(session.id)
    return { id, name, role: isAdmin ? "admin" : DEFAULT_EXTERNAL_ROLE, kind: "sso" }

  return null
```

要求：

- 解析结果不写回 Cookie；下一次请求仍然重新计算。
- 移出管理员名单立即降权，不需要用户重新登录。
- 删除成员立即失效，不依赖 sessionVersion。
- 业务接口统一通过同一个 `authed(request)` 入口获取身份，禁止各接口自己解析 Cookie。

## 服务端接口契约

| 方法 | 路径 | 认证 | 作用 |
| --- | --- | --- | --- |
| GET | `<CONFIG_PATH>` | 匿名 | 返回公开认证配置，不含 secret |
| POST | `<EXCHANGE_PATH>` | 匿名 + Origin + 限流 | 如视 token 换应用会话 |
| POST | `<TOKEN_LOGIN_PATH>` | 匿名 + Origin + 限流 | 访问令牌换应用会话 |
| GET | `<ME_PATH>` | 会话或令牌 | 返回当前身份、角色和来源 |
| POST | `<LOGOUT_PATH>` | 会话 | 过期 Cookie 清除会话 |

公开配置示例：

```json
{
  "authMode": "<dual|realsee|token|local>",
  "realsee": {
    "enabled": true,
    "env": "<REALSEE_ENV>",
    "source": "<REALSEE_LOGIN_SOURCE>",
    "domain": "<REALSEE_LOGIN_ORIGIN>",
    "callbackUri": "<SAME_ORIGIN_CALLBACK_PATH>"
  }
}
```

不得返回：管理员密码、会话密钥、SDK 私钥、token、Cookie、成员表或内部网络凭据。

## 上游 checkLogin 契约

```text
POST <REALSEE_LOGIN_ORIGIN><CHECK_LOGIN_PATH>
Authorization: <external token>
Content-Type: application/json
Accept: application/json
Body: {}

成功：HTTP 200 + JSON + 文档成功码 + data.<IMMUTABLE_USER_ID>
```

服务端必须：

- 使用绝对超时（如 5–8 秒），并支持中止连接；
- 限制响应字节数；
- 检查 `Content-Type` 为 JSON；
- 拒绝非对象、缺业务码、缺用户 ID 的响应；
- 只接受文档明确的成功业务码；
- 对昵称、头像做长度限制；
- 使用独立的 correlation ID 记录脱敏诊断信息。

状态映射：

| 上游结果 | 应用响应 |
| --- | --- |
| 成功码 + 有效用户 ID | 200 + 应用 Cookie |
| 业务码表示凭证无效 | 401 |
| 非 200 / 5xx | 503 |
| 超时 / 连接中断 | 503 |
| 非 JSON / JSON 畸形 | 503 |
| 响应超限 | 503 |
| 成功码但用户 ID 无效 | 503（上游契约异常） |

不要把 503 类错误映射成 401，否则用户会误以为令牌失效而反复重试。

## Origin、CSRF 与限流

- 对 `<EXCHANGE_PATH>` 和 `<TOKEN_LOGIN_PATH>` 校验 `Origin` 与 `<PUBLIC_ORIGIN>` 完全一致（scheme + host + port）。
- 允许无 `Origin` 的请求必须是显式策略，并只用于可信内部客户端。
- 所有有副作用的接口都要求 `Content-Type: application/json`，降低简单表单 CSRF 面。
- 失败限流至少覆盖：按 IP、按账号 / 令牌前缀、全局总量。
- 限流状态要有容量上限和过期淘汰，避免内存被刷爆。
- 错误响应不要区分“账号不存在”和“凭证错误”。

## 管理员 bootstrap 与不变量

安全的 bootstrap：

```text
if allowlist is empty
   and BOOTSTRAP_FIRST_ADMIN is explicitly enabled
   and this is the first successful sso login:
      append { id, added_by: "bootstrap" } to allowlist
      audit("auth.bootstrap_admin", id)
```

要求：

- 默认关闭；生产优先用环境变量或预置文件登记管理员。
- 一旦允许名单非空，bootstrap 永久失效。
- 删除最后一个管理员必须拒绝。
- 管理员不能删除自己（如产品需要），或至少保证删除后仍有其他管理员。
- 环境变量允许名单用于恢复，不应成为日常增删的主入口。

## 审计日志

建议记录：

- `auth.login`（来源 `sso` / `token`、是否管理员）
- `auth.logout`
- `auth.bootstrap_admin`
- 权限变更、资源归属变更、敏感操作
- 时间、内部用户 ID、操作、目标、结果

禁止记录：

- 手机号、OTP、token、Cookie、`Authorization`
- captcha ticket
- 完整 callback query
- 完整上游响应
- 密码或会话密钥

内部用户 ID 可以出现在审计日志中；它必须不是手机号，也不应与手机号组合成可还原个人身份的记录。

## 部署子路径

- 页面跳转使用相对路径（如 `login.html`），避免写死根路径。
- SDK 内写死的 `/api/auth/...` 必须替换为 `<APP_BASE_PATH>/api/auth/...`。
- 登录后 `next` 只接受站内单 `/` 开头路径。
- Cookie `Path` 使用 `/` 时，同一域名下的其他应用也能收到 Cookie；如果平台有多个互不信任的应用，改为应用子路径或独立子域。
