# 如视登录安全检查清单

## 威胁模型

至少考虑：

- 攻击者伪造、重放或截获如视 token；
- callback token 经 URL、Referer、日志、分析脚本泄漏；
- SSO login CSRF、state 缺失或重放；
- 恶意 goto / next 造成开放重定向或同源逃逸；
- 客户端伪造用户 ID、昵称、角色或 SDK user object；
- 外部账号与本地管理员错误合并；
- 成员被删除或降权后，旧会话仍然有效；
- Cookie 被脚本读取、跨站提交、长期有效或无法撤销；
- 伪造 Origin、错误信任 `X-Forwarded-*`；
- 登录 / exchange / 令牌接口被暴力请求；
- 上游慢响应、超大响应、非 JSON、连接中断耗尽资源；
- 手机号、OTP、token、captcha ticket 或密码进入日志和构建产物；
- SDK/Vapor 全局样式破坏登录 UI，导致用户误操作或输入不可见；
- 首个登录自动提权被攻击者抢注；
- 上游故障时没有本地回退入口。

## 服务端 token 验证

- [ ] token 只由服务端向如视 `checkLogin` 验证
- [ ] 浏览器解析结果、SDK user object 和 token payload 不参与授权
- [ ] token 必须是非空字符串并有明确最大长度（建议 ≤ 4 KB）
- [ ] 请求使用 HTTPS（仅受控本地开发可例外）
- [ ] 连接和完整请求都有绝对超时（建议 5–8 秒）
- [ ] 响应有最大字节数，超限立即中止
- [ ] 处理 response aborted/error 和 request error
- [ ] 只接受 HTTP 200
- [ ] 严格检查 JSON `Content-Type`
- [ ] JSON 必须是非 null、非数组对象
- [ ] 只接受文档明确的成功业务码
- [ ] external user ID 非空、有长度限制且来自已验证响应
- [ ] 昵称、头像等展示字段有长度上限
- [ ] 无效凭证（401）与上游故障（503）严格区分
- [ ] 不向客户端透传上游原文

## Token 最小驻留

- [ ] 如视 token 不写用户库
- [ ] 如视 token 不写应用 Cookie
- [ ] 如视 token 不写 localStorage/sessionStorage
- [ ] 如视 token 不作为业务 API bearer token
- [ ] exchange 成功后清理 SDK 自身可清理的 session
- [ ] token 不进入 console、日志、tracing attributes、metrics labels 或 error monitoring breadcrumbs
- [ ] callback query 在页面启动最早阶段被清理
- [ ] 反向代理/access log 对 callback query 脱敏
- [ ] 登录页设置 `Referrer-Policy: no-referrer`

## SSO 与跳转

- [ ] state 使用 Web Crypto/CSPRNG，至少 128 bit 随机性
- [ ] state 与当前浏览器会话绑定
- [ ] callback 时先删除预期 state，再比较
- [ ] 缺失、错误、过期或重放 state 均失败
- [ ] callback path 固定并在如视侧精确登记
- [ ] callback 不由客户端任意传入
- [ ] goto / next 使用 URL 解析并比较 origin
- [ ] 拒绝绝对 URL、`//host`、反斜杠和异常编码
- [ ] 默认跳转到安全站内路径
- [ ] callback exchange 优先于旧 Cookie 自动跳转
- [ ] 如果隐藏了 SSO 入口，回调代码要么同步删除，要么保留完整 state 校验

## Origin、代理、CSRF 与限流

- [ ] 登录和所有有副作用 API 校验完整 Origin（scheme + host + port）
- [ ] 生产配置显式提供 `<PUBLIC_ORIGIN>`
- [ ] 只信任明确数量的代理跳数
- [ ] 不无条件信任 `X-Forwarded-*`
- [ ] 允许无 Origin 客户端是显式策略
- [ ] 有副作用接口要求 `Content-Type: application/json`
- [ ] Cookie 使用 SameSite，仍保留 Origin 校验作为纵深防御
- [ ] CORS 只允许登记的精确 Origin、method 和 headers
- [ ] exchange 按 IP + 总量限流
- [ ] 令牌登录按 IP + 账号限流
- [ ] 限流状态有容量上限和过期淘汰

## 应用 Cookie 与会话

- [ ] `HttpOnly`
- [ ] `SameSite=Lax` 或更严格
- [ ] `Path=/`（或按应用隔离的子路径）
- [ ] 有限 TTL（建议 12–24 小时）
- [ ] HTTPS 使用 `Secure`，由部署配置显式决定
- [ ] 签名密钥来自 secret store 或 `0600` 文件
- [ ] 使用 timing-safe 签名比较
- [ ] 每次鉴权重新解析身份，检查成员是否仍存在
- [ ] 移出管理员名单后立即降权
- [ ] 删除成员后旧会话立即失效
- [ ] 支持退出登录并明确清除 Cookie
- [ ] 滑动续期有最小间隔，避免每个请求写 `Set-Cookie`
- [ ] Cookie payload 不包含如视 token、密码、手机号或不必要 PII
- [ ] 密钥轮换流程明确（轮换后全员重新登录）

## 权限与资源归属

- [ ] 只按服务端验证的不可变 external ID 映射
- [ ] 外部 ID 不直接作为本地用户名、Cookie 值或展示名
- [ ] 首次 external 角色固定为最低权限
- [ ] external 响应不能授予 admin
- [ ] 展示名、头像、手机号不能作为授权依据
- [ ] 管理员由独立允许名单或环境变量决定
- [ ] 首个登录 bootstrap 默认关闭，且需要显式开关
- [ ] 允许名单非空后 bootstrap 永久失效
- [ ] 删除最后一个管理员被拒绝
- [ ] 资源归属写入业务数据（`owner_id` / `owner_name`）
- [ ] 成员只能操作自己的资源
- [ ] 无归属的历史资源仅管理员可操作

## 访问令牌

- [ ] 令牌只在生成时显示一次
- [ ] 服务端只存 `sha256`，不存明文
- [ ] 比较使用 timing-safe
- [ ] 令牌长度有上限
- [ ] 令牌登录接口有限流
- [ ] 成员删除后令牌立即失效
- [ ] 角色变更后不需要重新登录也能即时生效
- [ ] 环境变量内置令牌可轮换，且不进入日志
- [ ] 浏览器不使用令牌访问业务 API
- [ ] 成员令牌链路做过一次真实登录验收

## 密码与本地应急账号

仅在宿主已有本地账号体系时适用：

- [ ] 本地密码使用 scrypt、Argon2id 或 bcrypt 等专用 KDF
- [ ] 每个密码使用独立随机 salt
- [ ] 长度和输入上限明确
- [ ] 密码校验避免时序泄漏
- [ ] 首次内置或临时默认密码要求改密
- [ ] 初始密码不长期留在环境文件或日志
- [ ] `local` / `token` 模式不解析损坏的如视配置

## 日志和可观测性

允许记录：

- 内部 correlation ID；
- HTTP/业务状态类别；
- 耗时、超时、响应大小分类；
- 已脱敏的部署环境和 endpoint 名称；
- 成功/失败计数，不使用用户值作为 metrics label；
- 内部用户 ID 与操作目标（用于审计）。

禁止记录：

- 手机号、OTP、密码；
- 如视 token、Authorization、Cookie、会话密钥；
- captcha ticket；
- 完整 callback query、request/response body；
- 真实头像签名 URL；
- 内部用户 ID 与手机号组合成的可还原身份记录。

## 依赖和制品

- [ ] SDK 使用精确版本或 commit
- [ ] 锁文件已更新
- [ ] 静态 bundle 记录来源和校验值
- [ ] 不使用相邻本地 SDK 路径
- [ ] 不修改 `node_modules` 或上游仓库源码
- [ ] 生产 bundle 不含敏感 console/debugger
- [ ] `.env`、成员表、会话密钥、日志和截图不进入制品
- [ ] 静态资源版本/hash 能避免旧登录 CSS 缓存
- [ ] Skill、README 和示例只使用占位符或 `example.com`

## 发布前最终检查

- [ ] 生产构建与类型/语法检查通过
- [ ] 成员令牌真实登录通过
- [ ] mock OTP 不发送真实短信的 UI 流程通过
- [ ] 服务端认证边界测试通过
- [ ] SSO state/goto/callback 负面测试通过
- [ ] Cookie 属性、TTL、滑动续期和退出检查通过
- [ ] 最低权限、成员删除、管理员降权和即时撤权检查通过
- [ ] `local` / `token` 回滚模式通过
- [ ] 桌面/移动端无溢出，OTP 六格可见
- [ ] 敏感信息扫描通过
- [ ] 如视侧 Origin/source/callback/captcha 已登记
- [ ] 真实 OTP 和 SSO 各完成一次人工验收
