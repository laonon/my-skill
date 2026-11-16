# 前端：SDK 托管、OTP、SSO 与样式隔离

## SDK 托管方式

两种方式都可行，优先选择可复现性更高的：

| 方式 | 优点 | 要求 |
| --- | --- | --- |
| 锁定 npm 依赖 | 版本可审计、构建可复现 | 精确版本 + 锁文件；不要在宿主项目改 `node_modules` |
| 静态 bundle | 无需构建器、内网部署简单 | 记录来源和校验值；升级时整体替换并回归 |

静态 bundle 常见坑：

- bundle 内写死根路径，例如 `/api/auth/config`；子路径部署必须改成 `<APP_BASE_PATH>/api/auth/config`。
- bundle 自带基础组件样式；宿主登录页必须**先引基础 CSS，再引覆盖 CSS**，否则按钮是浏览器默认样式。
- bundle 升级后 CSS Modules 前缀可能变化；用前缀属性选择器而不是完整哈希类名。
- 旧页面缓存会继续请求旧资源；保留空占位文件或重定向脚本可以救回一部分旧标签页。

## 登录页结构

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <link rel="stylesheet" href="assets/login/base.css">
  <link rel="stylesheet" href="assets/login/sdk.css">
  <style>/* 只放登录页作用域的覆盖样式 */</style>
  <script>
    /* callback 必须最早执行：先暂存，再清 URL */
    (() => {
      const params = new URLSearchParams(location.search);
      const token = params.get('token');
      if (!token) return;
      Object.defineProperty(window, '<CALLBACK_MEMORY_KEY>', {
        configurable: true,
        value: {
          token,
          state: params.get('state') || '',
          gotoUrl: params.get('gotoURL') || '/'
        }
      });
      history.replaceState({}, document.title, location.pathname);
    })();
  </script>
</head>
<body>
  <main class="login-card">
    <div id="realseeLoginRoot"><div class="meta">正在加载登录组件…</div></div>
    <div id="ssoFallback" hidden>手机号登录当前不可用，请使用访问令牌</div>

    <div class="divider" id="loginDivider">或使用访问令牌</div>
    <form id="tokenForm" autocomplete="off">
      <label for="token">访问令牌</label>
      <input id="token" type="password" autocomplete="off" spellcheck="false">
      <button type="submit">用令牌登录</button>
      <p class="err" id="err"></p>
    </form>
  </main>

  <script type="module" src="assets/login/sdk.js"></script>
  <script>
    /* 已有会话直接跳走；token form、降级提示等逻辑在这里 */
  </script>
</body>
</html>
```

要求：

- callback bootstrap 必须在任何第三方脚本之前执行。
- 已有会话检查使用同源 `fetch`，带凭证；失败静默处理。
- 页面本身设置 `Cache-Control: no-store`，或至少登录 HTML 不缓存。

## 登录后跳转

```js
function safeLocalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return './';
  }
  try {
    const parsed = new URL(value, location.origin);
    return parsed.origin === location.origin
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : './';
  } catch {
    return './';
  }
}

function gotoAfterLogin() {
  const next = new URLSearchParams(location.search).get('next') || '';
  location.replace(safeLocalPath(next));
}
```

不要：

- 直接 `location = next`；
- 只判断 `next[0] === '/'` 而不拒绝 `//host`；
- 接受反斜杠、`javascript:`、`data:` 或异常编码。

## SDK 面板与 Vapor 边界

不要把整张登录卡片放进默认全视口尺寸的 Vapor Provider。推荐结构：

```text
Login card (normal document flow)
├── Phone OTP button
├── SSO button（可选）
├── Divider
└── Access token form

Fixed modal host (only mounted while modal is open)
└── Vapor width="100%" height="100%"
    └── Realsee LoginModal
```

如果 Provider 默认读取 window 尺寸却放在普通流里，会出现卡片被撑满、按钮超出视口、移动端裁切。不要用 `height: auto` 盲目修复；若 content 绝对定位，反而会塌陷。

## 用前缀选择器覆盖 SDK 主题

SDK 使用 CSS Modules 时，类名形如 `LoginModalFormArea_x7f3a`。不要猜完整类名，也不要复制 SDK 样式；用稳定前缀：

```css
[class*="LoginModal_"] {
  background: rgba(16, 24, 40, .38) !important;
}

[class*="LoginModalFormArea_"] {
  width: 420px !important;
  max-width: calc(100vw - 32px) !important;
  height: auto !important;
  max-height: calc(100vh - 48px) !important;
  padding: 28px 26px 22px !important;
  background: #fff !important;
  border-radius: 16px !important;
  box-sizing: border-box !important;
}

[class*="LoginModalFormBg_"] {
  display: none !important;
}
```

原则：

- 所有覆盖集中在登录页 `<style>`，不要进入全局样式表。
- 一条覆盖只解决一类问题；不要用 `*` 或父级 `.card input` 大面积命中 SDK。
- 覆盖后必须在桌面和窄屏各截图一次，检查遮罩、关闭按钮、错误文案和键盘弹出。

## 隐藏 SSO 入口

如果产品只允许手机号登录：

```css
#realseeLoginRoot .realsee-login-panel > .btn-ghost {
  display: none !important;
}
```

但要同时决定：

- **保留** SSO 回调代码：必须继续校验 state，并确认回调路径仍然可达。
- **移除** SSO 回调代码：删除 callback bootstrap、state 逻辑和 SDK 的 SSO 配置，减少攻击面。

只做 CSS 隐藏、代码却完全可用，是最容易在审计时被点名的状态。

## OTP 六格被输入框遮挡

很多 OTP 组件用一个真实 input 覆盖六个显示格：

```text
OTP wrapper (position: relative)
├── input[autocomplete="one-time-code"]
│   └── absolute, full size, transparent, receives keyboard/paste/autofill
└── display container
    └── six visible boxes
```

宿主若存在 `.login-card input { padding: .75rem; background: #fff; }`，真实 input 会变成不透明整块，盖住六格。修复顺序：

1. 先把宿主规则收窄到本地表单容器。
2. 再用语义属性做兜底：

```css
#realseeLoginRoot input[autocomplete="one-time-code"] {
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: transparent;
  box-shadow: none;
  caret-color: transparent;
  -webkit-text-fill-color: transparent;
}
```

验证时读取 computed style：

- background 为 transparent；
- border width 为 0；
- padding 为 0；
- 六个显示格数量和尺寸都大于 0；
- input 仍可聚焦、输入、退格、粘贴和自动填充。

## 短信 acceptance 诊断

把三类问题分开：

1. **请求没发出 / 跨域失败**：fetch reject、OPTIONS/CORS、captcha 初始化失败。
2. **登录服务拒绝**：HTTP 或业务码失败。
3. **登录服务已受理但未送达**：业务成功，但运营商、频控或短信网关未最终投递。

诊断 UI 只展示：

- HTTP status；
- 业务 code；
- `x-requested-id` 或 SDK correlation ID；
- 准确文案“登录服务已受理”，不能写“短信已送达”。

禁止展示或保存：手机号、OTP、token、captcha ticket、Authorization、完整 request/response body。

## SDK 加载失败与降级

至少准备一条不依赖 SDK 的入口：

```js
setTimeout(() => {
  const root = document.getElementById('realseeLoginRoot');
  const fallback = document.getElementById('ssoFallback');
  const empty = root && (root.querySelector('.meta') || !root.children.length);
  if (!empty) return;
  root?.classList.add('hidden');
  fallback?.removeAttribute('hidden');
}, 12000);
```

降级后：

- 访问令牌表单必须可用；
- 如果配置了本地应急账号，一并展示；
- 不要在超时后继续轮询或重复初始化 SDK。

## 公开配置

前端只读取公开值：

```json
{
  "authMode": "<dual>",
  "realsee": {
    "enabled": true,
    "env": "<REALSEE_ENV>",
    "source": "<REALSEE_LOGIN_SOURCE>",
    "domain": "<REALSEE_LOGIN_ORIGIN>",
    "callbackUri": "<SAME_ORIGIN_CALLBACK_PATH>"
  }
}
```

- `enabled: false` 时隐藏如视入口，直接展开访问令牌 / 本地应急登录。
- `source` 不能为空；不要依赖 SDK 示例默认值。
- 前端不得从配置接口获得任何 secret。

## 静态资源缓存

登录页样式修复后仍显示旧效果时，检查：

- 登录 HTML 是否 `Cache-Control: no-store`；
- CSS/JS 是否内容 hash 文件名；
- 非 hash 文件是否带发布版本参数；
- Service Worker / CDN 是否仍缓存旧资源；
- 浏览器标签页是否从未刷新。

```html
<link rel="stylesheet" href="assets/login/sdk.css?v=<RELEASE_ID>">
<script type="module" src="assets/login/sdk.js?v=<RELEASE_ID>"></script>
```

`<RELEASE_ID>` 不是 secret，应由构建或发布流程自动生成。

## 浏览器验证矩阵

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
- [ ] 资源版本/hash 能拿到最新 CSS/JS

自动化时 mock captcha 和 send-OTP，禁止对真实手机号重复发送短信。

## 常见故障矩阵

| 症状 | 首要检查 | 常见根因 | 修复方向 |
| --- | --- | --- | --- |
| 卡片撑满视口 | Provider DOM 和 computed size | Vapor 在普通文档流 | 按钮与 fixed modal host 分离 |
| OTP 六格被整块覆盖 | one-time-code input computed style | 宿主通用 input CSS | 收窄选择器并重置透明 input |
| 显示已受理但没短信 | HTTP/业务码/request ID | 网关、频控、运营商 | 用 correlation ID 查上游投递 |
| send-OTP 没有 POST | captcha、OPTIONS、CORS | Origin/captcha 未登记 | 校验精确 Origin、headers、source |
| SSO 状态失效 | sessionStorage/state | 跨标签、重放、过期 | 重新发起并单次消费 state |
| callback 后跳错站点 | goto/next URL | 开放重定向 | 解析并比较 origin |
| exchange 503 | 服务端 checkLogin | 超时、非 JSON、上游故障 | 查脱敏 correlation ID，不放宽校验 |
| 登录后仍停在登录页 | `/api/auth/me` 与跳转逻辑 | 旧 Cookie 竞态、next 被拒 | 先探测会话，再执行 callback exchange |
| SDK 面板不出现 | bundle 路径、配置接口 | 子路径或 404 | 修正 base path 和静态资源 |
| 修复后仍是旧样式 | HTML/asset cache | 同文件名缓存 | hash/version + no-store |
