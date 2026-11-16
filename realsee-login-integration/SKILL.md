---
name: realsee-login-integration
description: 在 Web 应用中接入如视登录（手机号验证码 / SSO），并建立应用自己的会话与权限模型。覆盖固定版本 SDK 的静态托管、同源 exchange、签名 HttpOnly Cookie、滑动续期、每次请求实时重算角色、访问令牌双轨、管理员名单与首个登录 bootstrap、SDK/Vapor 样式隔离、OTP 排障和可回滚认证模式。用户提到如视登录、realsee-login-sdk、手机验证码、SSO 回调、checkLogin、访问令牌、双轨认证、成员权限或如视账号自动开户时使用。
license: MIT
compatibility: 浏览器需支持 Fetch、URL 和 Web Crypto（SSO state）；服务端需能出站 HTTPS 调用如视登录；SDK 必须固定版本并以静态文件或锁定依赖方式托管。
metadata:
  author: Vibe Release
  version: "2.0.0"
  updated: "2026-11-13"
---

# 如视登录安全集成 v2

把如视手机号验证码 / SSO 当作**认证来源**，把角色、归属和会话**留在应用自己手里**。v2 的重点不是“把 SDK 嵌进去”，而是让登录在真实内网平台里可运维：能双轨回退、能即时撤权、能定位短信问题、升级 SDK 时不改业务代码。

> v1 假设“本地密码 + 如视登录”双轨。实战中更常见、更省维护的是**如视登录 + 访问令牌**双轨：令牌给脚本和应急，如视账号给人。两种都要支持，但不要把没必要的本地密码体系硬塞进宿主项目。

## 先判断要做哪一种认证形态

| 形态 | 适用场景 | 组成 | 失败时 |
| --- | --- | --- | --- |
| `token` | 纯内部工具、脚本调用、无如视账号 | 成员访问令牌 + 环境变量内置管理员 | 令牌轮换即可恢复 |
| `dual`（默认推荐） | 内网平台，人用如视登录，脚本用令牌 | 如视 exchange + 成员令牌 + 管理员名单 | 关闭如视入口，令牌仍可用 |
| `realsee` | 强制统一身份，不允许成员令牌 | 如视 exchange + 管理员允许名单 | 允许名单或环境变量保底 |
| `local` | 紧急回滚、如视配置损坏 | 本地应急账号或纯令牌 | 不依赖如视配置即可启动 |

要求：

- `AUTH_MODE` 必须是**配置驱动**，不能写死在代码里；公开配置接口如实返回当前模式。
- 任何模式下都要有一条**不依赖如视上游**的运维入口（环境变量令牌或本地应急账号）。
- 模式切换只改配置和重启，不要求改数据库结构。

## 交付目标

每次执行都应产出：

1. 固定版本、可校验的登录 SDK 托管方式；
2. 手机号验证码与 SSO 入口（可只保留其中一个，但回调代码要匹配）；
3. 服务端 token exchange 与上游 `checkLogin` 校验；
4. 应用自有的 HttpOnly 会话 Cookie，不把如视 token 当业务凭证；
5. 每次请求实时解析的成员 / 管理员身份，撤权立即生效；
6. 签名会话、有限 TTL、滑动续期和服务端可撤销；
7. 访问令牌双轨与至少一个 break-glass 运维入口；
8. SDK/Vapor 样式隔离、OTP 排障和可回滚模式；
9. 覆盖前端、接口、权限和真实上游的验收记录。

不要自动修改上游 SDK 仓库。不要自动部署，除非用户明确要求并提供目标环境。

## 前置输入

开始改代码前确认：

- 宿主项目的前端框架、服务端运行时、现有会话方式和部署子路径；
- `<PINNED_SDK_VERSION_OR_COMMIT>` 或固定静态包的校验值，禁止浮动分支和相邻本地目录；
- `<REALSEE_ENV>`、`<REALSEE_LOGIN_ORIGIN>`、`<REALSEE_LOGIN_SOURCE>`；
- `<PUBLIC_ORIGIN>`、部署子路径和如视侧精确登记的 `<SAME_ORIGIN_CALLBACK_PATH>`；
- 角色模型：谁是管理员、谁只能看自己的资源、外部账号默认角色；
- 会话撤销方式：成员被删、移出管理员名单、禁用账号后旧会话如何处理；
- 是否保留访问令牌 / 本地应急账号，以及它的保管和轮换方式；
- 反向代理层数、HTTPS 终止位置、Cookie `Secure` 策略；
- 如视侧是否已开通 OTP、SSO、Origin、callback 和 captcha 配置。

缺少 source、Origin 或 callback 登记信息时，可以完成代码和 mock 验证，但不得声称真实 OTP/SSO 已验收。

## 不可妥协的安全约束

- 浏览器只把如视 token 短暂交给**同源** exchange；权限必须由服务端重新验证后建立。
- 服务端调用 `checkLogin` 必须设置 token 长度、绝对超时、响应大小、HTTP 状态、`Content-Type`、JSON 形状、业务码和不可变用户 ID 校验。
- 如视 token 不写用户库、应用 Cookie、日志、URL、业务 API header 或持久化前端存储。
- 应用独立签发 `HttpOnly; SameSite=Lax; Path=/` 且 TTL 有限的 Cookie；HTTPS 必须加 `Secure`，不得用“有没有配 host”来决定。
- 会话里只放内部身份和展示字段；角色**不写死**在会话里，每次请求按当前成员表 / 管理员名单重算。
- 登录和 exchange 必须校验完整 Origin（scheme + host + port），并按 IP / 账号 / 总量限流；`SameSite` 只是纵深防御。
- SSO state 使用 CSPRNG，绑定当前浏览器会话并单次消费；callback 和登录后跳转只能同源。
- callback 页面先捕获必要字段并立即清理 URL，再加载其他资源；同时设置 `Referrer-Policy: no-referrer`。
- 外部账号只按服务端验证的不可变 ID 映射；昵称、头像、手机号均不能授予权限。
- 首个如视账号自动成为管理员的 bootstrap 只能在**空名单且显式开启**时使用；生产优先环境变量允许名单。
- 不记录手机号、OTP、token、Cookie、`Authorization`、captcha ticket、密码或完整 callback query。
- 始终保留至少一个启用的管理员入口；删除最后一个管理员必须被拒绝。

完整清单见 `references/security-checklist.md`。

## 工作流

### 1. 调查宿主项目

- 阅读登录页、路由、API 鉴权、用户 / 成员存储、角色判断、反向代理和部署子路径。
- 搜索现有 Cookie、localStorage token、callback 参数处理、跨源请求和旧的令牌闸门。
- 检查全局 CSS 是否使用裸 `input`、`.card input` 等会污染 SDK modal 的选择器。
- 检查静态资源缓存策略、生产 bundle 里的调试输出、callback query 是否会进入代理或 access log。
- 记录当前可回滚入口和数据迁移边界。

### 2. 固定并托管 SDK

- 优先使用精确版本依赖 + 锁文件；没有可靠包管理时，把**已构建的静态 bundle**纳入版本库并记录校验值。
- 静态托管必须确认 SDK 内的接口路径：很多 bundle 写死 `/api/auth/...` 绝对路径，子路径部署时要改成 `<APP_BASE_PATH>/api/auth/...`。
- 保持 SDK CSS 和基础组件 CSS 的加载顺序；基础样式在前，宿主覆盖在后。
- 旧版本的占位文件（空 `login.css`、重定向脚本）可以保留，但只在确认能救回旧缓存页时使用。
- 生产构建后扫描 bundle，确认没有私钥、token、手机号、内部密码或调试请求体。

### 3. 实现前端登录页

- 从服务端公开配置接口读取 env、source、登录 origin 和固定 callback path；这些是公开配置，不含 secret。
- 手机号登录由 SDK modal 完成；成功后只调用同源 exchange，不直接信任 SDK user object 或 localStorage session。
- SSO 发起前生成高熵 state 并写入 `sessionStorage`；callback 时先删除预期 state，再做完全匹配。
- callback 的 URL token 必须在 `<head>` 最早执行的 bootstrap 中暂存，并立即用 `history.replaceState` 清除。
- 登录后跳转只接受以单个 `/` 开头的站内路径，拒绝 `//host`、绝对 URL 和异常编码。
- 页面加载时先请求 `/api/auth/me`，已有会话直接跳走；旧 Cookie 的自动跳转必须让位于 callback exchange。
- SDK 12 秒内没有渲染出可交互面板时，显示降级提示并保留令牌登录或本地应急入口。
- 若业务决定隐藏 SSO 按钮，要么同时移除 SSO 回调处理，要么保留 state 校验；不要只做视觉隐藏。

前端模式和 UI 排障见 `references/frontend-otp-sso.md`。

### 4. 实现服务端 exchange

提供公开但受约束的 `POST <EXCHANGE_PATH>`：

- 对浏览器请求执行完整 Origin 比较；只在明确策略下允许无 Origin 的内部客户端。
- 校验 body 大小、token 类型、非空和最大长度；添加按 IP / 账号 / 总量的失败限流。
- 服务端通过 `Authorization` 调用 `<CHECK_LOGIN_PATH>`，使用独立 correlation ID。
- 只接受文档明确的 HTTP 状态、`Content-Type: application/json`、成功业务码和有效不可变用户 ID。
- 凭证无效映射 401；网络、超时、非 JSON、响应超限、畸形响应和上游故障映射通用 503，不向客户端透传上游原文。
- 验证成功后才建立身份并签发应用 Cookie。

接口和信任边界见 `references/architecture-and-flows.md`，可直接复用的零依赖片段见 `references/server-reference-implementation.md`。

### 5. 建立应用会话

推荐无状态签名会话：

```text
cookie = base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, payload))

payload = {
  id,        // 内部身份 ID，不是手机号
  name,      // 展示名，可空
  kind,      // "sso" | "token"
  iat, exp   // 签发与绝对过期时间
}
```

要求：

- 密钥来自 secret store 或 `0600` 权限文件；首次自动生成后不得打印到日志。
- 使用 timing-safe 比较；payload 解析失败、签名不符或过期一律拒绝。
- TTL 有限（内部平台常用 12–24 小时）；活跃请求可滑动续期，但设置最小续期间隔，避免每个请求都写 `Set-Cookie`。
- 会话里不放如视 token、手机号、密码或不必要的 PII。
- 退出登录用过期 Cookie 清除，并在审计日志里记录一次 `auth.logout`。

### 6. 建立权限模型

- 外部账号只按服务端验证的不可变 ID 映射；首次默认最低权限。
- 管理员由**独立允许名单**决定（文件或环境变量），不要因为“第一个登录”就永久提权。
- 如果实现 bootstrap，条件必须是：允许名单为空 + 显式开启 + 只执行一次，并在审计日志中标记来源。
- 每次请求都重新解析身份：成员被删、移出管理员名单、账号被禁用后，旧会话立即失效或降权。
- 资源归属写进业务数据（如 `owner_id` / `owner_name`）；管理员可操作全部，成员只能操作自己的资源。
- 无归属的历史资源默认仅管理员可操作，不做“猜归属”。
- 角色或允许名单变化后，不要求用户重新登录；实时解析比 sessionVersion 更适合小型内网平台。

### 7. 访问令牌双轨

- 令牌只在生成时显示一次，服务端只存 `sha256`；比较使用 timing-safe。
- 成员记录包含 `id / name / role / hash / created_by / last_login`，不要存明文令牌。
- 环境变量内置令牌（如 `CONSOLE_TOKEN`）等同最高权限，只用于脚本和运维，必须可轮换。
- 令牌登录与如视登录签发同一种会话，通过 `kind` 区分来源。
- 令牌输入长度设上限，登录接口必须限流；不要回显“令牌存在但角色不对”这类可枚举信息。
- 成员令牌链路至少做一次**真实登录**验收：静态语法检查发现不了未定义函数，空 `catch` 还会把它伪装成“令牌无效”。

### 8. 处理 UI、短信与缓存

- 登录按钮保持在普通卡片流中；Vapor/Modal Provider 放到独立 fixed 全视口宿主，避免 Provider 默认尺寸撑大卡片。
- 本地表单样式限定在本地表单容器；不要让通用 `input` 规则覆盖 SDK。
- SDK 使用 CSS Modules 哈希类名时，用稳定的前缀属性选择器做主题覆盖，例如 `[class*="LoginModalFormArea_"]`，并集中在登录页，不污染全局。
- 对 `autocomplete="one-time-code"` 的真实输入保留透明、0 border、0 padding，让下层六格显示 UI 可见。
- “登录服务已受理短信请求”不等于“运营商已送达”。只展示 HTTP 状态、业务码和 correlation ID，不展示请求体。
- 只有无法获得 SDK hook 时才短生命周期包装 `fetch`；必须精确限定 login origin + send-OTP path，并在 modal 关闭时恢复。
- 静态资源文件名不带 hash 时增加发布版本参数或正确 `Cache-Control`，避免旧 CSS 继续遮挡 OTP。

### 9. 验证

至少验证：

- 生产构建、语法或类型检查；
- 桌面和移动视口无横向溢出；
- OTP 六格真实可见，隐藏输入透明且仍可聚焦、粘贴和自动填充；
- mock captcha + mock send-OTP 不发送真实短信的前端全流程；
- 服务端 token：有效、无效、超长、超时、非 JSON、超限响应和上游 5xx；
- 访问令牌：有效、无效、超长、被删除、被降权、真实登录一次；
- 会话：签名篡改、过期、滑动续期、退出、成员删除后立即失效；
- 权限：外部新用户最低角色、重复登录稳定映射、移出管理员名单立即降权、成员只能操作自己的资源；
- `local` / `token` 回滚模式在如视配置损坏时仍能启动；
- 真实 OTP 和 SSO 仅在如视侧配置完成后各手工验证一次。

完整矩阵和配置模板见 `references/configuration-and-validation.md`。

### 10. 最终报告

简洁报告：

- 修改文件和认证模式；
- SDK 固定方式，但不要输出私有凭据；
- callback、Origin、Cookie 和会话 TTL 策略；
- 已执行的 mock、边界和真实上游验证；
- 未验证或待如视侧配置的项目；
- 回滚到 `local` / `token` 模式的方法；
- 明确说明日志和制品中未包含手机号、OTP、token、密码或 session secret。

## 实战踩坑清单

| 症状 | 根因 | 修复 |
| --- | --- | --- |
| SDK 面板渲染了但接口 404 | bundle 写死根路径 `/api/auth/...` | 改成部署子路径，或反向代理补齐 |
| 按钮是浏览器默认样式 | 只引了自定义 CSS，没引基础组件 CSS | 基础 CSS 在前，覆盖 CSS 在后 |
| 验证码六格看不见 | 宿主通用 `input` 样式覆盖了隐藏输入 | 收窄选择器，重置透明输入 |
| 弹窗仍是深色 | SDK CSS Modules 哈希类名 | 用 `[class*="Prefix_"]` 主题覆盖 |
| 登录后跳外站 | 直接使用 `next` / `gotoURL` | 只允许单 `/` 开头并做 URL 解析 |
| 已登录又看到登录页 | 页面加载前没查 `/api/auth/me` | 先探测会话，再渲染登录入口 |
| 成员令牌全部“无效” | 未定义的解析函数被空 `catch` 吞掉 | 补函数并做真实令牌登录验收 |
| 删除成员后仍能操作 | 角色/成员信息写死在会话里 | 每次请求重算身份 |
| 上游返回畸形 JSON 却提示令牌无效 | 把 503 类错误映射成 401 | 只有业务码明确无效才是 401 |
| HTTPS 下 Cookie 没 `Secure` | 用 host 或环境变量隐式判断 | 按部署 scheme 显式配置并校验 |
| 修复后仍是旧样式 | 同文件名缓存 | hash / 发布版本参数 / `no-store` |

## 默认参数建议

| 参数 | 建议值 | 说明 |
| --- | --- | --- |
| `SESSION_TTL` | 12–24 小时 | 内部平台够用，不宜更长 |
| 续期间隔 | 1 小时 | 避免每个请求写 Cookie |
| exchange body | ≤ 1 MB | 只接收 `{ token }` |
| 如视 token 长度 | ≤ 4 KB | 超长直接拒绝 |
| `checkLogin` 超时 | 5–8 秒 | 必须用绝对 deadline |
| 上游响应 | 有最大字节数 | 超限立即中止 |
| 失败限流 | 按 IP + 账号 | 登录和 exchange 都要有 |

## 参考资料

- `references/architecture-and-flows.md`：信任边界、OTP/SSO/令牌流程、会话格式和服务端契约。
- `references/server-reference-implementation.md`：零依赖 Node 参考实现（会话、exchange、限流、Origin 校验）。
- `references/security-checklist.md`：安全不变量、威胁模型和发布检查表。
- `references/frontend-otp-sso.md`：SDK 静态托管、CSS Modules 覆盖、OTP、降级和排障。
- `references/configuration-and-validation.md`：环境变量模板、平台登记项和验证矩阵。
