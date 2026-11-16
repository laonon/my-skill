# 配置占位符与验证矩阵

## 配置模板

以下全部是占位符，不得原样作为生产值：

```dotenv
AUTH_MODE=<local|token|dual|realsee>
PUBLIC_ORIGIN=<https://app.example.com>
APP_BASE_PATH=</apps/console>
TRUST_PROXY_HOPS=<0_TO_5>
COOKIE_SECURE=<true|false>

SESSION_TTL_SECONDS=<BOUNDED_SECONDS>
SESSION_RENEW_AFTER_SECONDS=<BOUNDED_SECONDS>

REALSEE_LOGIN_ENV=<development|testing|production>
REALSEE_LOGIN_ORIGIN=<HTTPS_LOGIN_ORIGIN>
REALSEE_LOGIN_SOURCE=<ASSIGNED_SOURCE>
REALSEE_CHECK_LOGIN_PATH=</open/v1/checkLogin>
REALSEE_CALLBACK_PATH=</same-origin-callback>
REALSEE_VERIFY_TIMEOUT_MS=<1000_TO_30000>

EXTERNAL_DEFAULT_ROLE=<LOWEST_ROLE>
ADMIN_USER_IDS=<COMMA_SEPARATED_IMMUTABLE_IDS>
BOOTSTRAP_FIRST_ADMIN=<true|false>

SESSION_COOKIE_NAME=<APP_SPECIFIC_COOKIE_NAME>
SESSION_SECRET_FILE=<PATH_TO_0600_SECRET_FILE>
MEMBERS_FILE=<PATH_TO_MEMBERS_FILE>
SSO_ADMIN_ALLOWLIST_FILE=<PATH_TO_ADMIN_ALLOWLIST_FILE>
```

要求：

- `PUBLIC_ORIGIN` 是纯 HTTP(S) origin，不含 path、query、fragment 或凭据。
- `AUTH_MODE` 决定前端公开配置和可用入口，不能写死在代码里。
- 非受控本地开发的登录 origin 必须 HTTPS。
- callback path 固定、同源，并与服务端真实路由一致。
- `REALSEE_LOGIN_SOURCE` 使用如视正式分配值，不能依赖 SDK 示例默认值。
- HTTPS 必须 `COOKIE_SECURE=true`；直连 HTTP 仅限受控测试网络。
- 代理层数必须与实际拓扑一致，不能为“让 IP 看起来正确”而盲目增大。
- `BOOTSTRAP_FIRST_ADMIN` 生产默认关闭；只在内网首次初始化且能接受抢注风险时临时开启。
- 会话密钥文件权限 `0600`，首次生成后不得打印；轮换后所有用户重新登录。
- 成员表和允许名单权限建议 `0600`，且不要进入制品或版本库。

## 如视侧登记清单

在真实 OTP/SSO 验收前确认：

- [ ] source 已正式分配并启用手机号登录
- [ ] source 已启用 SSO（如果产品保留 SSO 入口）
- [ ] 精确 Origin 已允许，包含 scheme、host 和 port
- [ ] callback 完整 URL 已登记
- [ ] captcha app/scene 与 source 匹配
- [ ] CORS 允许 POST、Content-Type、`x-requested-with`、`x-requested-id`
- [ ] 测试/生产环境没有混用
- [ ] 短信模板、签名、频控和运营商通道已启用
- [ ] 服务端可出站访问 login origin
- [ ] 有按 correlation ID 查询登录和短信网关日志的渠道

IP + HTTP 可以用于受控测试，但生产优先使用 DNS + HTTPS。是否允许 IP Origin 由如视 / Captcha 平台配置决定，不能由前端代码绕过。

## 公开配置接口

浏览器可读取的配置只包含公开值：

```json
{
  "authMode": "dual",
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

`local` / `token` 模式应返回 `realsee.enabled: false`，前端隐藏如视入口并展开访问令牌 / 本地应急登录。

## 服务端 checkLogin 验证矩阵

| 用例 | 上游行为 | 预期应用结果 |
| --- | --- | --- |
| 有效 token | HTTP 200 + JSON + 文档成功码 + 有效 user ID | 建立会话并签发 Cookie |
| 空 token | 不请求上游 | 401 |
| 超长 token | 不请求上游 | 401 |
| 无效 token | 业务失败码 | 401 |
| 上游 5xx | 非 200 | 503 |
| 超时 | 超过绝对 deadline | 503 且连接中止 |
| 非 JSON Content-Type | HTTP 200 | 503 |
| JSON 解析失败 | malformed body | 503 |
| 响应超限 | 超过最大字节数 | 503 且响应中止 |
| 缺 user ID | 成功码但身份字段无效 | 503 |
| request/response aborted | 连接中断 | 503，只 settle 一次 |

断言日志中没有 token、Authorization、body、Cookie 或手机号。

## 访问令牌验证矩阵

| 用例 | 预期 |
| --- | --- |
| 环境变量内置令牌 | 登录成功，最高权限 |
| 有效成员令牌 | 登录成功，角色按成员表 |
| 无效令牌 | 401，不泄漏是否存在 |
| 超长令牌 | 401 |
| 成员被删除后登录 | 401 |
| 成员被删除后旧会话 | 立即失效 |
| 成员角色从 admin 改为 user | 下一次请求立即降权 |
| 成员令牌真实登录 | 成功；不能只靠语法检查 |
| 令牌哈希比较 | 使用 timing-safe |
| 令牌日志扫描 | 无明文令牌 |

## 会话验证矩阵

| 用例 | 预期 |
| --- | --- |
| 正常 Cookie | `/api/auth/me` 返回 200 |
| 签名被篡改 | 401 |
| payload 非 JSON | 401 |
| 已过期 | 401 |
| 活跃请求滑动续期 | TTL 内续期，且不超过续期间隔 |
| 退出登录 | Cookie 过期，后续 401 |
| HTTPS 部署 | `Set-Cookie` 含 `Secure` |
| 跨站请求 | Origin 校验拒绝 |
| 成员被删 | 旧 Cookie 立即失效 |
| 移出管理员名单 | 旧 Cookie 立即降权 |

## 权限验证矩阵

| 用例 | 预期 |
| --- | --- |
| 新 external ID | 创建稳定映射，最低角色 |
| 同一 ID 再登录 | 复用同一身份 |
| 上游昵称变化 | 只更新展示字段 |
| 本地已提升角色 | 再登录保留角色（如果宿主有本地角色表） |
| 移出管理员名单 | 立即降权 |
| 删除最后管理员 | 拒绝 |
| 删除自己 | 按产品策略拒绝或要求先指定接任者 |
| 成员访问他人资源 | 403 |
| 成员访问无归属历史资源 | 403 |
| 管理员访问全部资源 | 允许 |
| bootstrap 开启且名单为空 | 首个登录成为管理员并写审计 |
| bootstrap 关闭 | 首个登录仍是普通成员 |

## SSO 验证矩阵

| 用例 | 预期 |
| --- | --- |
| 正确 state | 允许 exchange |
| 缺 state | 拒绝并要求重新登录 |
| 错误 state | 拒绝 |
| 同一 state 重放 | 拒绝 |
| state 所在标签已关闭 | 拒绝 |
| callback 含旧应用 Cookie | callback exchange 优先执行 |
| goto 为 `/console` | 允许站内跳转 |
| goto 为 `//evil.example` | 回退安全首页 |
| goto 为绝对外站 URL | 回退安全首页 |
| callback URL 含 token | 页面启动后地址栏立即无 token |
| 隐藏 SSO 入口后仍访问 callback | 按实现拒绝或要求保留 state 校验 |

## Cookie 检查

检查 `Set-Cookie`：

- [ ] 名称是应用自有 Cookie，不与其他应用冲突
- [ ] HttpOnly
- [ ] SameSite=Lax 或更严格
- [ ] Path=/ 或应用子路径
- [ ] 有限 Max-Age/Expires
- [ ] HTTPS 环境 Secure
- [ ] 不包含如视 token
- [ ] logout 使用过期 Cookie 清除

## 浏览器 UI 验证

视口至少覆盖：

- 桌面：约 1440×900；
- 窄屏：约 390×844；
- 小高度和软键盘场景；
- 200% 文本缩放或浏览器 zoom。

检查：

- [ ] 卡片宽高正常，不被 Provider 撑满
- [ ] document/body scrollWidth 不超过 viewport
- [ ] 手机号、访问令牌入口完整
- [ ] modal 遮罩覆盖视口且不扩大文档流
- [ ] OTP hidden input 透明、0 border、0 padding
- [ ] 六个 OTP 格都有正尺寸并可见
- [ ] 输入、退格、粘贴、自动填充和焦点可用
- [ ] 错误信息不遮挡输入
- [ ] 短信诊断只含状态、业务码、correlation ID
- [ ] 诊断语义区分“已受理”和“已送达”
- [ ] SDK 12 秒未渲染时降级入口可见
- [ ] 资源版本/hash 能拿到最新 CSS/JS

自动化时 mock captcha 和 send-OTP，禁止对真实手机号重复发送短信。

## HTTP smoke 示例

使用 `example.com` 占位：

```bash
BASE=https://app.example.com
curl -fsS "$BASE/login.html" >/dev/null
curl -fsS "$BASE/api/auth/config"
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/api/auth/me"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$BASE/"
```

预期：

- login 和公开配置为 200；
- 未登录 `auth/me` 为 401；
- 受保护页面跳转登录页；
- 跨 Origin mutation 为 403；
- 业务 API 不接受如视 token 直接访问。

## 真实上游验收

代码、mock 和边界测试通过后，才做受控人工验收：

1. 使用授权测试账号发起一次 OTP；
2. 确认 captcha、send-OTP、短信实际到达和 OTP 登录成功；
3. 记录脱敏时间窗口、环境、source 别名和 correlation ID；
4. 完成一次 SSO 并检查 state、URL 清理和最终应用 Cookie；
5. 检查新用户最低角色和管理端不可访问；
6. 把该用户加入管理员名单，确认下一次请求即提权；
7. 移出管理员名单，确认下一次请求即降权；
8. 用有效成员访问令牌登录一次；
9. 删除该成员，确认令牌和旧会话都失效。

不要在验收文档、截图或工单中记录完整手机号、OTP、token、Cookie、Authorization 或完整 callback URL。

## 回滚

发布前准备：

- 可立即切换到 `AUTH_MODE=local` 或 `token`；
- 至少一个已验证的环境变量 / 本地管理员；
- 成员表、允许名单和会话密钥的受控备份；
- 旧前端和服务端制品；
- 不依赖如视配置的启动路径。

回滚时：

1. 切换认证模式；
2. 重启服务并验证应急入口；
3. 保留 external 用户映射、owner 和审计数据，不盲目删除；
4. 使有风险的会话失效；
5. 排查上游或新版本后再恢复 `dual` / `realsee`。

## 最终验收报告模板

```text
认证模式：<MODE>
公开 Origin：<PUBLIC_ORIGIN>
Callback：<SAME_ORIGIN_CALLBACK_PATH>
SDK 固定方式：<PINNED_VERSION_OR_CHECKSUM>
会话 Cookie：HttpOnly / SameSite=<VALUE> / Secure=<VALUE> / TTL=<VALUE>
External 默认角色：<LOWEST_ROLE>
管理员来源：<ALLOWLIST / ENV / BOOTSTRAP>

已通过：
- <BUILD_AND_STATIC_CHECKS>
- <MOCK_UI_CHECKS>
- <SERVER_BOUNDARY_TESTS>
- <TOKEN_LOGIN_TESTS>
- <SESSION_AND_ROLE_TESTS>

真实上游：
- OTP：<VERIFIED_OR_PENDING>
- SSO：<VERIFIED_OR_PENDING>

待配置：
- <REALSEE_PLATFORM_ITEMS>

敏感信息：未写入仓库、日志、截图、Skill 或发布制品。
```
