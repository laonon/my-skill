---
name: devbox-deploy
description: 把应用部署到开发机（guide.realsee.cn / 10.33.207.254），或查看/重启/回滚/下线该机器上的应用。当用户说「部署到开发机」「发布到 test 环境」「上线 demo」「把这个项目跑起来」「看看部署状态」「下线某个应用」时使用。首选控制台 API（dvctl，秒级、无需 SSH）；API 不通再走 SSH（dbx）。
---

# 开发机应用部署

开发机 `mmk-dev`（`10.33.207.254`）跑着统一部署平台：

- 站点入口 **https://guide.realsee.cn/**
- 控制台 **https://guide.realsee.cn/apps/console/**
- 每个应用占用 **`/apps/<name>/`**，端口 **6000-6999**
- 同机还有 vibe-release 平台（端口 4001-4099）和一批生产容器——**不要碰**

## 安装与初始化（一条命令）

解压到**你的 AI 工具的 skills 目录**，目录名保持 `devbox-deploy`：

| 工具 | 目录 |
|---|---|
| WorkBuddy | `~/.workbuddy/skills/devbox-deploy/` |
| Claude Code | `~/.claude/skills/devbox-deploy/` |
| 其他 / 临时用 | 任意目录都行，脚本不依赖位置 |

然后执行（把路径换成你的实际目录）：

```bash
bash <skill目录>/scripts/setup.sh
```

这个包不依赖任何特定 agent：主链路只要 `python3` + `bash`；SSH 兜底（`scripts/dbx`）额外需要 `expect`（macOS 自带，Debian/Ubuntu 装 `expect` 包）。文档里的路径统一写成
`$SK`（skill 目录），按你的实际位置替换即可。

这个脚本会依次做完，缺什么补什么，可以重复跑：

1. 检查 `dvctl` / `ca.crt` / `.env.example` 是否齐全（缺 `ca.crt` 会连不上）
2. 建 `.env` 并设成 `600`（已存在就保留，不覆盖你的令牌）
3. 没有令牌时引导你贴一枚，并说清楚去哪拿
4. 校验身份，打印 `你是谁 (user id) · 管理员/成员`，确认可以发布

令牌从哪来：用如视账号（手机号）登录控制台 <https://guide.realsee.cn/apps/console/>，
**首次进入会自动发放一枚个人令牌并弹窗显示一次**，复制弹窗里那行 `dvctl login --token ...`
直接执行即可；错过了在「设置 → 脚本令牌 → 重置我的令牌」重新生成。

> 令牌就是你的身份：发布、登录、查权限都用它，绑定的是账号 id，用它发布的应用自动归你名下。
> 共享管理员令牌已下线，不要找管理员要 key，也不要互相借令牌。

## Agent 行为约定（重要）

这个 skill 交付的是**可执行的发布能力**，不是一份说明书。所以：

1. **先自检，再动手**：任何发布动作之前先跑 `scripts/dvctl whoami`。
2. **没配好就先帮用户配**：`whoami` 报「未配置 / 401」时，不要直接 `deploy`，先带用户走初始化：
   - 让用户打开 <https://guide.realsee.cn/apps/console/>（如视账号登录），把弹窗里那行 `dvctl login --token ...` 复制给你；
   - 你执行它，再跑一次 `dvctl whoami` 确认身份；
   - 全程不要替用户编造令牌，也不要借用别人的令牌。
3. **连通性异常先降级排查**：`dvctl doctor` 连不上时，先怀疑网络/VPN，再试 `scripts/dbx`（SSH 兜底，需要 `.env` 里的 `DEVBOX_PASS`）。
4. **发布后必须验证**：`dvctl apps` 看状态、`curl -o /dev/null -w '%{http_code}'` 看 URL 是否 200，不要只看命令返回 0 就宣布成功。

## 0. 通道选择：先 API，后 SSH

| 通道 | 命令 | 何时用 |
|---|---|---|
| **API（首选）** | `scripts/dvctl` | 默认。查询、部署、日志、运维全部支持，秒级返回 |
| SSH（兜底） | `scripts/dbx` | API 不通；需要看宿主机文件、改 nginx、调 docker 原始命令时 |

先跑 `scripts/dvctl doctor` 探活，通了就别用 SSH。

```bash
SK=<你的 skill 目录>          # 例如 ~/.workbuddy/skills/devbox-deploy
DV=$SK/scripts/dvctl
$DV doctor
```

配置在 skill 目录 `.env`（`600` 权限）：`CONSOLE_URL` 与 `CONSOLE_TOKEN`（后者存**你自己的个人令牌**），`DEVBOX_HOST` / `DEVBOX_USER` / `DEVBOX_PASS`（仅 SSH 兜底用）。

> 沙箱注意：ssh 调用必须带 `-o PubkeyAuthentication=no -o PreferredAuthentications=password`，
> 否则会被拦。统一用 `scripts/dbx`，不要手写 ssh。

## 1. dvctl 命令

```bash
$DV apps                     # 应用列表（名称/类型/状态/端口/访问地址）
$DV overview                 # 主机 CPU/内存/磁盘/容器数
$DV ports                    # 端口分配登记
$DV vibe                     # 创意工坊（vibe-release）应用，只读
$DV open <name>              # 打印访问地址
$DV logs <name> [-n 200]     # 容器日志（静态站点返回文件清单）

$DV deploy <路径> --name <n> [--mysql] [--update]  # 上传并部署（--update 覆盖已有应用）
$DV image --name <n> --image <ref> --cport 3000 [--port 6001] [--health /health] [--mem 512m] [--mysql]
$DV limits <n> [--mem 1g] [--cpus 2]   # 调限额，容器重建 2-5 秒

$DV restart|stop|start <name>
$DV rollback <name>          # 回滚到上一版镜像
$DV remove <name> -y         # 下线（撤入口；静态站进回收站，24h 内同名重传可恢复）
```

任意命令加 `--json` 输出原始 JSON，便于程序处理。

`deploy` / `image` 加 `--mysql` 会同时建库（`app_<name>`）并注入容器，详见 3.5。

## 2. 部署：三种情况

### 2.1 上传源码/静态包（最常用）

```bash
$DV deploy ./my-project --name my-app
```

**自动识别**（服务端判断，不用手动指定）：

| 包内结构 | 判定 | 结果 |
|---|---|---|
| 有 `Dockerfile` | 容器项目 | 构建镜像 → 分配端口 → 起容器 → 健康检查 → nginx 反代 |
| 有 `index.html`（根目录或 `dist/build/out/public/www`） | 静态站点 | 直接由 nginx 托管，不占端口 |
| 都没有 | 拒绝 | 补 Dockerfile 或 index.html |

打包时自动跳过 `.git`/`node_modules`/`.venv`/`__pycache__`，但**保留 `dist`、`build`**——静态站点常用。

容器端口从 Dockerfile 的 `EXPOSE` 推断，没有则默认 3000；宿主机端口不指定就自动分配。

> 应用名规则：`^[a-z0-9][a-z0-9-]{0,31}$`。**同名应用已存在会自动按「更新」处理**（只校验归属），发新版本直接再传一次即可，不要先 `remove`。

### 2.2 用现成镜像

```bash
$DV image --name my-app --image app/my-app:20261106-1530 --cport 3000
```

`--cport` 是**容器内**监听端口，必填。

### 2.3 前端 SPA

静态部署已内置 SPA 回退（`try_files ... /index.html`），前端路由不用额外配。
但 base 必须设成 `/apps/<name>/`：

- Vite：`base: '/apps/my-app/'`
- CRA：`PUBLIC_URL=/apps/my-app/`

否则资源会 404。

## 3. 部署后必须验证

```bash
$DV apps | grep <name>                                                          # 状态应为「运行中」
curl -s -o /dev/null -w '%{http_code}\n' https://guide.realsee.cn/apps/<name>/  # 应为 200
```

容器应用再看健康：`curl -s https://guide.realsee.cn/apps/<name>/health`。

**不要只看命令返回成功就结束**——必须确认 URL 真的返回 200。

## 3.1 创意工坊应用（只读）

`/opt/vibe-release/deployments/deployments.json` 里是创意工坊平台（vibe-release）的 28 个应用，
端口 **4001-4028**，由另一个平台管理。控制台的「应用」页已把它们和自建应用合并展示（带「工坊」标签），
`dvctl vibe` 可单独列出。

```bash
$DV vibe                     # 列表：端口 / 名称 / 状态 / 访问地址
```

**不要**用 `appctl remove` 或 `docker rm` 动这些容器——会破坏创意工坊的平台状态。
要修改或下线，回创意工坊操作。

**访问地址是 `https://guide.realsee.cn/apps/vibe/<id>/`（不带端口）**，实现方式：

1. nginx 在 **4401-4428** 开 TLS 端口，各自反代到 `127.0.0.1:4001-4028`，应用以**根路径**运行
2. `/apps/vibe/<id>/` 是 iframe 包装页，内嵌 `https://guide.realsee.cn:<44xx>/`
3. `/apps/vibe/` 是前台索引页（带封面的应用列表），`/apps/console/` 是后台控制台

之所以要用 iframe 而不是直接路径反代：这批应用读 `location.pathname` 判断自己是否在根路径，
直接挂 `/vibe/<id>/` 会报「访问路径必须为 /{resourceCode}」，页面白屏。

新增/删除工坊应用后，在开发机执行同步：

```bash
sudo vibe-sync      # 重新生成 4401-4428 的 server 块与 iframe 包装页，并 reload nginx
```

## 3.1.1 /apps/ 应用总入口

`https://guide.realsee.cn/apps/` 是**所有应用的前端入口页**（无需登录）：
上半部分「自建应用」（扫 `/opt/apps/*/deploy.json`），下半部分「创意工坊」（28 个），带封面与统计。

- 生成器：`/opt/apps/_shared/bin/apps-index.py` → 输出 `/opt/apps/guide/apps/index.html`
- 自动刷新时机：控制台上传部署 / 镜像部署 / 下线成功后，以及 `vibe-sync` 执行后
- nginx：`location = /apps { 301 /apps/; }` + `location = /apps/ { root /opt/apps/guide; try_files /apps/index.html =404; }`
  （**必须用 `location =` 精确匹配**，否则会被 `location ^~ /apps/ { return 404; }` 兜底吃掉）
- 手动重生成：`sudo python3 /opt/apps/_shared/bin/apps-index.py`

## 3.1.2 工具箱（/tools/ 导览 + 审核）

首页「工具箱」→ `/tools/`，图标导览式（类似网址导航），任何人可提交，管理员审核后上线。

- 数据：`/opt/apps/deploy-console/tools.json`（`644`），字段 `id/title/desc/url/image/emoji/status/owner_*/author`
  - `status`：`pending` | `approved` | `rejected`
  - `author`：管理员改写的署名（可选）；没有时页面回落到 `owner_name`，为「系统」则不署
  - 没填配图时创建即随机分配一个 emoji（`TOOL_EMOJI` 池），存进 `emoji` 字段
  - 首次启动无文件时写入 4 个内置入口（控制台 / 端口 / 应用总览 / 证书）
- 接口（都在控制台服务里，同域调用）：
  - `GET  /api/tools` 公开，只返回 approved（页面匿名可读）
  - `POST /api/tools` 需登录，提交进 pending（校验标题、链接格式、链接去重）
  - `GET  /api/tools/mine` 我的提交
  - `GET  /api/tools/admin` 管理员，全部 + 待审数
  - `POST /api/tools/image` 登录即可，上传配图（multipart，png/jpg/webp/gif，≤5MB）
    → 存 `/opt/apps/guide/tools/uploads/`，返回 `/tools/uploads/<file>`，站点内直接可访问
  - `POST /api/tools/mine` 作者编辑自己的条目（`id/title/desc/url/image/emoji`），
    改后**状态回 `pending` 重新审核**（管理员改则直接生效）
  - `POST /api/tools/admin` 管理员，`action` 支持 `add` / `edit` / `approve` / `reject` / `remove`
    - `add`：管理员直接添加，**创建即 approved**（跳过审核），可指定 `emoji`
    - `edit`：改 `title/desc/url/image/emoji/author`，保存立即生效（`author` 传空串 = 删除，回落提交人）
- 页面：`/opt/apps/guide/tools/index.html`（静态，前端 fetch 渲染；`＋` 瓷贴在末尾）
  - 未登录点「添加」→ 跳 `/apps/console/login.html?next=/tools/`，登录后自动回来
- 审核台：控制台左侧「工具审核」（仅管理员，带待审数徽标）
  - 卡片头「+ 添加工具」：填标题/链接/描述/配图/emoji，保存即上线
  - 每行按钮：**编辑** / 通过 / 拒绝 / 下架 / 删除
  - 编辑与添加共用同一个弹窗，字段：标题（必填）、作者（可选，留空显示提交人）、链接（必填）、描述、配图、图标 emoji（留空自动分配）
  - 链接校验：`http(s)://` 或站内 `/x`；同链接不可重复（编辑时排除自己）
- 作者自助编辑：`/tools/` 页面底部「我提交的」（登录后显示），每行带状态徽章与「编辑」，
  改完回到待审核，管理员通过后才会更新到导览页
- 配图两种来源：粘贴图片地址，或点「上传」选本地图片（存 `/tools/uploads/`，5MB 上限）

## 3.2 登录与权限

两种登录方式，进入后按角色区分：

| 登录方式 | 默认角色 |
|---|---|
| **手机号 / SSO**（如视登录） | 成员；在管理员名单里才是管理员 |
| **访问令牌** | 按 `members.json` 登记的角色 |

| 角色 | 能做什么 |
|---|---|
| **管理员** | 全部应用、创意工坊、端口表、镜像部署、成员管理 |
| **成员** | 发布自己的应用；管**自己发布的**应用；被授权的应用按级别（协作管理 / 只读） |

- 归属记在 `deploy.json` 的 `owner_id` / `owner_name`，未授权的成员之间互相不可见
  （要互相可见就给协作授权，见下一节）
- 管理员的应用页会标出归属：**我的**（蓝）/ **成员名字**（灰）/ **未记录归属**（黄），
  筛选条多出「我发布的」「成员发布」；顶部计数显示「我的 N · 成员 M · 工坊 K」
- 没有 `owner_id` 的历史应用只有管理员能操作
- 身份只认**个人令牌**（每人一枚，绑账号 id）：登录控制台时自动发放，发布时带上它
- 手机号登录的管理员名单：`admins.json`（首个手机号登录的账号自动加入），可在左侧「用户」页增删

### 应用级权限（协作）

「管理员 / 成员」是全局角色，每个应用还能单独授权，粒度到「人 × 应用 × 级别」：

| 身份 | 来源 | 能做什么 |
|---|---|---|
| 管理员 | `admins.json` / `ADMIN_USER_IDS` | 全部应用的全部操作 |
| 属主 | `deploy.json` 的 `owner_id`（发布者） | 该应用全部操作 + 分配协作权限 |
| 协作管理 `manage` | 由属主或管理员授予 | 更新部署、重启、回滚、改限额、改展示信息、看日志 |
| 只读 `view` | 由属主或管理员授予 | 看卡片、详情、日志（不能更新、不能下线） |

入口：应用卡片「更多 → 协作者」。弹窗里列出属主和已授权的人，可改级别或移除；
底部从「登录过的人」里挑人添加。协作管理能看名单但不能改（避免权限层层扩散）。

- 数据：`/opt/apps/deploy-console/app-perms.json`（`600`），只存额外授权，属主与管理员不落表
  ```json
  { "apps": { "pano-video-tour": [{ "id": "8000000005166681", "role": "view",
                                    "added_at": "2026-11-13T07:10:00Z", "added_by": "36184089396510730" }] } }
  ```
- 接口：`GET /api/apps/<name>/collaborators`（有读权限就能看名单）、
  `POST /api/apps/<name>/collaborators {id, role: "manage"|"view"|"none"}`（仅属主 / 管理员）
- 被授权后对方的应用列表里会多出这条，卡片带「协作管理」或「只读」标签；只读账号只留「日志」按钮
- 部署记录跟着应用走：有协作管理权限就能看到该应用的部署记录
- 应用下线时授权自动清掉，同名重传从干净状态开始
- **更新部署不改归属**：协作管理的人更新别人的应用，`owner_id` 仍是原发布者
  （`appctl deploy` 与静态发布都会保留 `owner_id`，同时保留 `category` / `author` / `entry`）
- 判断顺序：管理员 → 属主 → `app-perms.json` 里的 `manage` / `view`；属主不可被降级

### 会话有效期（24 小时，滑动续期）

登录态的 cookie 是 `console_session`（HttpOnly + 签名），有效期 **24 小时**：

- 登录时签发 `iat` / `exp`，cookie `Max-Age=86400`
- **只要还有请求就自动顺延**：距上次签发超过 1 小时会重发一次 cookie，把 `exp` 推到 24 小时后
  （不是每个请求都写，避免无谓的 Set-Cookie）
- 控制台页面每 20 秒刷新一次、切回标签页也会立刻刷新，所以**开着页面就不会掉线**；
  连续 24 小时没有任何请求才需要重新登录
- 想调整：`SESSION_TTL_SECONDS`（systemd 环境变量），例如 `172800` = 48 小时

排查：`curl -i .../api/auth/login` 看 `Set-Cookie` 的 `Max-Age` 是否为 86400；
老 cookie 没有 `iat` 字段，首次请求会被自动续期一次，不用手动重登。
- 访问令牌成员：`members.json`（只存 sha256），「用户」页生成 / 重置 / 移除
- 命令行（`sudo`）：
  ```bash
  # 访问令牌成员
  console-admin list
  console-admin add 张三 [--admin]
  console-admin reset <u_xxx>
  console-admin remove <u_xxx>
- **`owner_id = admin` 的应用（用 `dvctl` / 控制台令牌部署的）在管理员登录时也算「我的」**，
  因为令牌没有真实用户身份，一律记成内置管理员

  # 手机号登录的管理员（提权用）
  console-admin admins
  console-admin admin-add <如视 user_id> [名字]
  console-admin admin-remove <如视 user_id>
  ```
  `admin-add` 后对方**下一次请求就生效**，不用重启服务。
- 用户管理在左侧 **「用户」** 页（仅管理员可见，带人数徽标）：
  - 「用户与权限」：所有**登录过**的人都在这里（不止名单里的人），每行显示来源
    （如视登录 / 访问令牌 / 内置）、登录次数、最近登录时间，右侧下拉框直接改角色
  - 名字旁的铅笔可以**改昵称**：写进 `users.json` 的 `alias`（登录时不会被如视昵称覆盖），
    同时把该用户名下应用 `deploy.json` 的 `owner_name` 一起改掉并重建 `/apps/`；
    留空保存＝删除 `alias`，回到登录昵称（应用里的名字也会回滚）
  - 注意应用卡片显示的是 `author`（管理员在「编辑信息」里改过的署名）优先，
    所以改昵称不会覆盖已经手工指定的作者
  - 「添加成员」：生成访问令牌、手动把某个如视账号加成管理员
  - 登录登记存在 `users.json`（`600`，只记 id/名字/首次与最近登录/次数），
    每次如视登录和令牌登录都会写一条；`members.json` / `admins.json` 仍然是权限的唯一来源
  - 名单不全的情况有两条兜底：① 从 `audit.log` 的 `auth.login` 回填历史登录；
    ② 扫 `/opt/apps/*/deploy.json` 的 `owner_id`，发过应用但没登录记录的人也会出现（来源标「发过应用」）
  - 注意如视登录只返回 `user_id_str / name / avatar`，**没有手机号**——控制台显示的是昵称，
    手机号在平台侧，别指望在这查人
  - 改角色：令牌账号改 `members.json` 的 `role`；如视账号加/删 `admins.json`
  - 保护：不能改自己的角色；内置 `admin` 和 `ADMIN_USER_IDS` 里的账号不可改，会显示原因
  - `GET /api/users` 返回合并后的列表，`POST /api/users {id, role}` 改角色（都仅管理员）
- 普通成员看不到这一页（路由会拦回概览）；他们的「设置」里只有「我的账号」和
  「当前是成员身份」的说明，提权要管理员在「用户」页加，或服务器上跑 `console-admin admin-add`
- 手机号登录不可用时，登录页会提示改用令牌；两套并存，互不影响

## 3.3 解决方案站点（realsee-dev / 内网蓝皮书）

首页「解决方案」指向 `https://guide.realsee.cn/solutions/`，内容是本地项目
`<你的 realsee-dev 仓库>`（静态站，`bin/build.mjs` 产出 `dist/`）。

**一条命令同步更新**（改完 content/ 或 config 后）：

```bash
$SK/scripts/deploy-realsee-dev
```

脚本做的事：`BLUEBOOK_BASE=/solutions/ npm run build` → 打包 → 上传 →
解压到暂存目录校验 → 原子替换 → 6 项 URL 健康检查；失败时打印回滚命令。

要点：

- **必须带 `BLUEBOOK_BASE=/solutions/`**，否则资源路径指向根目录，全站 404（脚本已内置）
- 产物落在 `/opt/apps/guide/solutions/`（走 guide 站点 root，不是 appctl 应用）
- 上一版自动备份到 `/opt/apps/_shared/backups/solutions.<时间戳>`，只留最近 1 份，站点外不可 web 访问
- 回滚：`dbx root "ls -dt /opt/apps/_shared/backups/solutions.* | head -1 | xargs -I{} mv {} /opt/apps/guide/solutions"`

## 3.4 C 端 + B 端混合部署

一个服务同时面向消费者（C）和客户/内部（B）时，用**路径分离**，不用改 DNS：

| 形态 | 路径 | 访问控制 |
|---|---|---|
| 只有 C 端 | `/apps/<name>/` | 公开 |
| C + B | `/apps/<name>/` + `/apps/<name>-admin/` | C 公开，B 要登录 |

选型理由：证书是 `*.realsee.cn` 通配符但 DNS 要过 IT；同域前缀（`/` + `/admin`）cookie 最容易混。

### 构建：两个 base 必须分开

```bash
VITE_BASE=/apps/myapp/        npm run build   # → dist-c
VITE_BASE=/apps/myapp-admin/  npm run build   # → dist-admin

dvctl deploy ./dist-c     --name myapp
dvctl deploy ./dist-admin --name myapp-admin
```

**base 不分开**，B 端的 `/assets/*.js` 会指向 C 端，直接白屏——这是最常踩的坑。

### B 端加登录校验（复用控制台会话）

```nginx
location = /_auth {
    internal;
    proxy_pass http://127.0.0.1:6000/apps/console/api/auth/me;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Cookie $http_cookie;
}

location ^~ /apps/myapp-admin/ {
    auth_request /_auth;                       # 未登录 → 401
    error_page 401 = /apps/console/login.html; # 引导去登录
    add_header Cache-Control "no-cache";
    # alias / try_files 按静态或反代写
}
```

控制台 cookie 是 `Path=/`，登录后自动带到 `/apps/*`，不用另做登录。

### 缓存策略要分开

- C 端静态资源：`expires 7d` + `immutable`
- B 端：`no-cache`，否则改完数据刷新还是旧界面

### 上传大小

| 限制 | 值 |
|---|---|
| 控制台后端 `MAX_UPLOAD` | 500 MB |
| nginx `client_max_body_size` | 512 MB（`conf.d/guide.conf`） |
| 磁盘 | 320G，剩 246G |

超限会被 **nginx 直接 413**（到不了后端），报错信息里看不到业务提示，别误判成代码问题。

**超过 500MB 不要靠压缩硬塞**，直接改用镜像部署：本机构建镜像后 `docker load`，
再用 `dvctl deploy --image <name:tag>` 起容器，不受包体积限制。含 `node_modules`、
模型权重、大型二进制依赖的项目，一开始就该走镜像，别先试上传。

### API 前缀建议

```
/api/public/*   ← C 端，无鉴权
/api/admin/*    ← B 端，校验会话
```

同一个容器监听一个端口，靠路径分流；不要靠"前端隐藏入口"做权限。

## 3.4.1 /apps/ 总入口页

`python3 /opt/apps/_shared/bin/apps-index.py` 生成 `/opt/apps/guide/apps/index.html`，结构：

```
顶部条（返回首页 / 部署控制台 / 深浅色切换）
hero 卡：INTERNAL APP PLATFORM · 内部应用发布平台 · 《发布指南》· 指标（已发布应用 / 成熟方案）
成熟方案 + 一句说明 → deploy.json 里 category 不是 creative 的自建应用（/apps/<name>/）
创意工坊     + 一句说明 → category = creative 的自建应用 + /opt/vibe-release 里的应用
```

卡片信息：封面、类型标签（静态/容器）、标题、一句话描述，底部一行作者署名。

署名取值顺序：`deploy.json` 的 `author`（管理员在控制台「编辑信息 → 作者」里改的）→
`owner_name` → `owner`（形如 `RS_xxx`、纯数字这类内部 id 会去 admins.json / members.json 查名字，
查不到就不显示，避免在页面上摆一串 id）。

展示端只有这两个分类：**成熟方案**（能直接交付/演示的）和**创意工坊**（实验性作品）。

### 分类由发布者决定（category 字段）

发布时在控制台选「发布到」，写进 `deploy.json` 的 `category`：

| 选项 | category | 展示位置 |
|---|---|---|
| 可售卖方案 | `solution`（默认，缺省也算它） | 成熟方案 |
| 创意分享 | `creative` | 创意工坊（排在工作坊应用前面） |

- 控制台「应用」页也按同样规则分成两个分区，卡片上带「可售卖 / 创意」标签
- 已发布的应用改分类：卡片「编辑信息」→ 分类，保存后自动重建 `/apps/`
- 接口层：`POST /apps/console/api/apps/<name>/meta` 带 `"category": "creative" | "solution"`
  （不带该字段时保持原值，老脚本不会把分类冲掉）
- 上传部署：`POST /api/upload?...&cat=creative`；镜像部署：body 里 `"category": "creative"`
- 下线后同名重传会从 `app-meta-archive.json` 恢复原分类

没有「开发机部署」那种推广横幅了——推广入口收敛到右上角「部署控制台」和 hero 里的《发布指南》。

**文案是内网应用发布平台的定位**（工具 / 脚本 / 原型统一入口），不要照抄创意工坊的
「新灵感，开启新创作」那套 C 端措辞。

### 深浅色

hero 的颜色全部走主题变量，**不要写死深色**：

| 变量 | 浅色 | 深色 |
|---|---|---|
| `--hero-a` / `--hero-b` | `#eef3ff` → `#f7f9ff` | `#1a2135` → `#131928` |
| `--hero-line` | `#dbe4ff` | `rgba(120,180,255,.26)` |
| `--hero-text` | `#101828` | `#eef2fb` |
| `--hero-muted` | `#5b6b86` | `#a6b3c9` |
| `--hero-metric-bg` | `rgba(255,255,255,.72)` | `rgba(255,255,255,.055)` |

新增任何彩色区块都按这个套路加一组变量，两边都定义；否则切深色时会出现
「浅色页面里一块黑板」或「深色页面里一块白板」。

改标题/描述/封面后由控制台自动重新生成，不用手工跑脚本。

## 3.5 应用需要数据库（MySQL）

本机已有 **MySQL 8.0.39**（`mysql.service`，`127.0.0.1:3306`，root 走 `auth_socket`）。
需要数据库的应用**不要各自起 MySQL 容器**，用「共享实例 + 每应用独立库和账号」。

### 最快的做法：控制台勾选

部署页（上传 / 从镜像部署）都有「**需要 MySQL 数据库**」勾选项。勾上后：

1. 部署前先调用 `mysql-provision <app>`（建库 + 建号 + 写 `.env`）
2. `appctl` 部署时把 `.env` 注入容器
3. 建库失败会中止部署，不会留下半成品

限制：

- **静态站勾选会被直接拒绝**（没有后端进程，连不了库）
- 控制台走受限入口 `mysql-provision-console`，**只能建库/查看**；重置密码与删库必须上服务器
- 重复部署会复用 `.env` 里已有的密码，不会把数据库密码刷掉

### 脚本通道（dvctl，AI 直接调用时用）

```bash
dvctl deploy ./dist --name my-app --mysql
dvctl image --name my-app --image app/my-app:20261110-1530 --cport 3000 --mysql
```

底层就是给 API 带上 `mysql=1`，与页面勾选走同一套逻辑：**先建库写 `.env`，再起容器**。
不加 `--mysql` 就只部署、不建库；静态包带 `--mysql` 会被 API 拒绝。
成功后会多打一行：`数据库: 已创建 app_my_app，连接信息见 /opt/apps/my-app/.env`。

### 手动分配（同一条命令）

```bash
sudo mysql-provision my-app            # 建库 + 账号，并写入 /opt/apps/my-app/.env
sudo mysql-provision my-app --rotate   # 只重置密码（库和数据不动）
sudo mysql-provision my-app --drop     # 删库 + 删账号（不可恢复）
sudo mysql-provision --list            # 列出已分配的库
```

规则：

- 库名 = 账号名 = `app_<应用名>`（连字符转下划线，截断到 32 字符）
- 账号 host 限定 `172.18.%`（apps-net）、`172.17.%`、`localhost`，**只能访问自己的库**
- `.env`（600）里写入 `DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD / DATABASE_URL`
- 密码只显示一次，丢了用 `--rotate`

### 容器里怎么连

`appctl` 生成的 compose 已内置环境注入与宿主机映射：

```yaml
environment:
  - TZ=Asia/Shanghai
env_file:
  - .env
extra_hosts:
  - "host.docker.internal:host-gateway"
```

应用侧连接地址用 **`host.docker.internal:3306`**，不要写 `127.0.0.1`——那指向容器自己。

```js
// Node 示例
const url = process.env.DATABASE_URL
  || `mysql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
```

### 正确顺序

1. 建库：控制台勾选 / `dvctl ... --mysql` / `sudo mysql-provision my-app`，三者等价
2. 代码读 `process.env.DATABASE_URL`，首次启动自动建表 / migrate
3. `appctl deploy ...` 或控制台部署，`.env` 自动注入
4. 改密码后需要重建容器（环境变量只在启动时读取）：`docker compose up -d --force-recreate`

### 控制台如何拿到权限

`guanfu` 只有这一条 sudo 规则（`/etc/sudoers.d/92-guanfu-mysql`）：

```
guanfu ALL=(root) NOPASSWD: /usr/local/bin/mysql-provision-console
```

`mysql-provision-console` 是个白名单包装：只放行 `<app>` 和 `--list`，`--drop` / `--rotate` 一律拒绝，
避免控制台被当成删库入口。

### 注意

- **静态站连不了数据库**，必须是 Dockerfile 项目
- 应用只连自己的库，跨库查询会被 MySQL 拒绝（这是刻意的隔离）
- 备份单个库：`mysqldump --single-transaction app_my_app | gzip > /opt/apps/_shared/backups/db-my-app-$(date +%F).sql.gz`
- 连接池建议 `connectionLimit: 10` 以内，30 个应用共享一个实例，别把 `max_connections` 吃满（默认 151）
- 3306 虽然监听所有网卡，但账号 host 受限，外部即使知道密码也连不上

## 3.6 部署失败怎么查

部署是**同步请求**：上传 + `docker build` + 起容器都在一次 HTTP 里完成，可能要几分钟。

### 日志在哪

| 位置 | 内容 |
|---|---|
| 控制台「部署记录」页 | 每次部署一条：应用、方式、用户、状态、耗时、完整日志 |
| `/opt/apps/deploy-console/logs/<jobId>.log` | 同上，纯文本，服务器上直接 `cat` |
| `/opt/apps/deploy-console/audit.log` | 谁在什么时候做了什么（含失败） |
| `/var/log/nginx/guide.ssl.access.log` 与 `guide.error.log` | 504/413 这类没到后端的错误 |

### 常见状态码

| 现象 | 含义 | 处理 |
|---|---|---|
| **504** | nginx 等后端超时（原本 300s） | 已放宽到 1800s；构建确实很久就改镜像部署 |
| **413** | 包超过 nginx 上限 | 单包 500MB，大项目走镜像 |
| **409** | 已有部署在进行 | 同一时间只允许一个构建，等它结束 |
| **502** | 后端重启中 | 稍后重试 |

### 应用「时不时消失看不到」

按出现频率排：

| 原因 | 表现 | 处理 |
|---|---|---|
| 自己点了**下线**再重传 | 卡整段消失，审计里有 `app.remove` | 用「更新」代替，不会中断 |
| 静态站大项目重传 | 页面白屏/资源 404，几十秒后恢复 | 已改原子切换，不再出现 |
| 筛选条停在「我发布的/成员发布」 | 别人的应用看不到 | 点「全部」 |
| 登录身份是成员 | 只能看自己的 | 确认右上角角色 |
| `/apps/` 索引页没重新生成 | 卡片还在，但标题/封面是旧的 | 见 3.10「保存了但页面没变」 |

查审计确认是不是自己删的：

```bash
grep '<应用名>' /opt/apps/deploy-console/audit.log | tail -5
```

`app.remove` 是界面上点「下线」产生的；`deploy.upload` 带 `update:false` 说明是新建而非覆盖更新。

### 构建卡住

`docker build` 长时间无输出，多半是 buildx builder 异常：

```bash
ps aux | grep 'docker build'            # 看有没有堆积
docker buildx ls                        # builder 状态
pkill -f 'docker buildx build'          # 清掉卡死的
```

**不要并发构建**：两个 build 同时用同一个 builder 会报
`transport: Error while dialing: only one connection allowed` 然后卡死。
控制台已加互斥（409），脚本通道 `dvctl` 也要避免并行。



- 端口段 **6001-6999**，自动分配并登记到 `/opt/apps/PORTS.md`
- 应用目录 `/opt/apps/<name>/`，元信息 `deploy.json`
- nginx 片段 `/etc/nginx/snippets/apps-locations/apps-<name>.conf`，**必须带 `^~` 前缀**
- 容器只监听 `127.0.0.1:<port>`，对外统一走 nginx 80/443
- 默认资源限制：512m 内存 / 1.0 CPU，日志 10m×3 轮转

## 3.7 应用自带 basePath（部署后 404 的常见原因）

有些应用按子路径构建（Next.js `basePath`、Vite `base`），只认 `/apps/<name>/...`。
nginx 若按默认**剥掉前缀**，应用收到 `/` 会直接返回 **404**——容器是健康的，日志也正常。

### 怎么判断

```bash
docker exec app-<name> cat /app/.base-path        # 常见做法，值如 /apps/my-app
docker exec app-<name> env | grep -E 'BASE_PATH|NEXT_PUBLIC_BASE_PATH|PUBLIC_URL'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/            # 404
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/apps/<name>  # 200
```

两条一对照就能确定。

### nginx 正确写法（proxy_pass **末尾不加斜杠**）

```nginx
location = /apps/my-app {
    proxy_pass http://127.0.0.1:6001;        # 无尾斜杠 = 原样转发完整 URI
    ...
}
location ^~ /apps/my-app/ {
    proxy_pass http://127.0.0.1:6001;
    ...
}
```

`proxy_pass http://127.0.0.1:6001/;`（带斜杠）会把 `/apps/my-app/` 换成 `/` —— 这就是 404 的根因。

### appctl 已自动处理

部署时会探测容器里的 `.base-path`（或 `BASE_PATH` / `NEXT_PUBLIC_BASE_PATH` / `PUBLIC_URL`），
命中 `/apps/<name>` 就生成保留前缀的配置，日志会打印：

```
[17:20:46] 检测到应用 basePath=/apps/pano-video-tour → 保留前缀转发
```

不需要人工改 nginx。只有应用用别的路径（如 `/static/base.txt`）声明时才需要手改。

### 顺带：健康检查

镜像里没有 `curl` / `wget` 时，旧的 healthcheck 会一直 `unhealthy`（其实服务正常）。
现在 appctl 依次尝试 **curl → wget → node**，Node 应用都能通过。

## 3.8 平滑发布（为什么不要「下线 + 重传」）

### 静态站：原子切换，零中断

```
1. 解压到临时目录并识别类型
2. 复制到 /opt/apps/<app>/.public.new
3. rename(public → .public.old)  ← 毫秒级
4. rename(.public.new → public)  ← 毫秒级，新版本上线
5. 后台 rm -rf .public.old
```

旧的 `public/` 在换名前一直对外服务，所以**不会出现「删光了还没拷完」的 404 窗口**。
415MB 的项目拷贝要十几秒，旧实现这十几秒里页面是白屏的。

实测（100MB 静态站，更新期间每 30ms 请求一次，共 92 次）：

```
200 v1  70 次
200 v2  22 次
非 200   0 次      ← 零中断
```

### 容器：有 2-5 秒空窗

单容器换版本必须停旧起新，端口独占无法并行，所以有短暂 502。要更平滑只能上多副本 + 负载均衡，
当前规模不值当。

### deploy.json 与索引页也是原子写

- `deploy.json`：写 `.tmp` 再 rename，避免列表读到半截 JSON（表现为标题/归属短暂为空）
- `/apps/` 索引页：`os.replace` 原子替换，避免刷新时拿到半截 HTML

## 3.8.1 下线即回收站（让「下线 + 重传」也能秒级恢复）

有些发布脚本习惯「先下线再上传」。以前这样必然有整包上传那么长的空窗（418MB 约 2 分钟）。

现在静态站的下线改成**改名进回收站**，同名重传时立刻恢复：

```
下线     mv /opt/apps/<app>  →  /opt/apps/.trash/<app>-<时间戳>   （毫秒级）
        + 撤掉 nginx 配置（下线后是干净的 404，不是 500）
重传开始  检测到 .trash 里有同名 → 改名回来 + 重建 nginx 配置
        → 站点在 0.5 秒内恢复，后面 418MB 慢慢传
传完     原子切换到新版本（旧版本后台删）
```

实测（40MB 包，下线 → 立即重传，每 100ms 探活）：

```
下线后          404
重传开始 0.51s  200   ← 恢复
之后            异常 0 次
```

回收站保留 24 小时，每次上线/下线都会清理过期条目（同时清掉残留的 nginx 配置）。

**没传完就失败？** 应用保持上一版继续服务，不会变成半成品。

### 同名重传不再报 409

以前 `POST /api/upload?name=x` 在 x 已存在时返回 409，提示「带 update=1」。
调用方（尤其脚本）遇到这个错误常常退化成「先下线再上传」，反而制造空窗。

现在**存在即更新**：同名上传直接按覆盖处理，只校验归属。不需要再传 `update=1`
（传了也兼容）。要强制新建（比如想清空数据）必须先显式下线。

### 静态站权限

压缩包里的文件可能是 `600`（macOS 某些打包工具），nginx（www-data）读不到会 **403**。
发布时统一 `chmod -R a+rX`：文件 644、目录 755。

## 3.9 更新已有应用（覆盖部署）

同一个应用要发新版本，不要换个名字重新发——那会多出一个应用、端口和 nginx 配置。

### 三条通道

| 场景 | 做法 |
|---|---|
| 控制台 | 应用卡片点「更新」→ 自动跳到部署页、名称锁定、上传新包 |
| 脚本 | `dvctl deploy ./dist --name my-app --update` |
| 服务器 | `appctl deploy my-app --image app/my-app:新tag --port 旧端口 ...` |

### 语义

- **平滑替换**：静态站走「复制到临时目录 → 原子 rename 切换」，旧版本在切换前一直对外服务；
  容器走 compose 重建（端口独占，有 2-5 秒空窗）
- **覆盖源码/镜像**，重新构建、替换容器
- **保留 `data/` 与 `logs/`**（应用数据不丢）
- **沿用原端口**，URL 不变
- **保留原 `owner_id` / `owner_name`**：管理员替别人更新，归属仍属原作者
- **可顺带改展示信息**：更新面板里改标题/描述/封面，部署成功一并保存
- 上传接口不带 `update=1` 时会返回 **409** 并提示「要覆盖更新请点该应用的「更新」」

### 命令行部署不会丢归属

`appctl` 写 `deploy.json` 时会先读旧文件，沿用 `owner` / `owner_id` / `owner_name`。
以前重新部署会把归属冲成执行者（甚至丢成空），导致原发布者在控制台看不到自己的应用。

如果确实要改归属，改 `deploy.json` 或走控制台。

### 脚本发布的归属

身份只认**个人令牌**：每人一枚，绑定真实账号 id（如视 `user_id`），库里只存 sha256。
首次用如视账号登录控制台会自动发放并显示一次，之后：

```bash
dvctl login --token <令牌>
dvctl whoami          # 应显示：王明 (36184089396510730) · 管理员
```

共享管理员令牌（`CONSOLE_TOKEN`）**已下线**——服务端不再把它当身份，所以不存在
「一个 key 被多人共用、谁发都算 admin」这种路径了。

- 发布请求带 `Authorization: Bearer <你的令牌>`，应用 `owner_id` 自动写成你自己
- 管理员确实要代指定归属：单次 `--owner <user id>`，或 `.env` 的 `CONSOLE_OWNER`；
  接口层是 `?owner=<id>`。成员带这个参数无效
- 归属写定后**不会**被后续发布改掉（只有完全没有归属的应用才会被首次发布认领）。
  真要转移，用控制台应用编辑弹窗里的「归属人 ID」
- CI / 机器人：在「用户 → 服务账号」里建独立令牌账号，不要复用真人的令牌

## 3.10 应用展示信息（标题 / 描述 / 封面 / 默认链接）

`/apps/` 总入口和控制台卡片，默认只显示应用名 + 首字母色块。可以补展示信息：

| 字段 | 位置 | 说明 |
|---|---|---|
| `title` | `deploy.json` | 卡片标题，留空用应用名 |
| `desc` | `deploy.json` | 一句话描述，显示在标题下面 |
| `cover` | `deploy.json` | 封面图，建议 16:9；留空用标题前两字色块 |
| `author` | `deploy.json` | 作者署名（仅管理员可改），留空回落发布者 |
| `category` | `deploy.json` | `solution` / `creative`，决定进哪个分区 |
| `entry` | `deploy.json` | **默认链接**：卡片点开去哪。留空 = `/apps/<name>/`；可填应用内路由（`/apps/x/#/dashboard`）或完整 URL |

`entry` 的规则：

- 必须以 `/` 开头（站内）或 `http(s)://` 开头，否则接口返回 400
- 只影响点击入口（控制台卡片、`/apps/` 卡片），不影响应用实际挂载路径，也不会影响健康检查
- 填外部地址时 `/apps/` 的卡片会带 `target="_blank"`
- 想改回默认：清空输入框保存，字段直接删掉

改法（三种入口，都进同一个弹窗）：

| 入口 | 位置 |
|---|---|
| **编辑信息** 按钮 | 应用卡片操作区，紧挨「更新」（常显） |
| 铅笔图标 ✎ | 卡片标题右侧（常显，浅灰） |
| **更新面板** | 卡片点「更新」→ 部署页出现「展示信息」区块，可改标题/描述/封面（默认链接走「编辑信息」弹窗），还能「只保存信息」不传包 |

### 卡片上的磁盘占用

控制台应用卡片的元信息行会显示 `占用 3.4 GB`，工具条右侧是可见应用的合计（`· 共 4.7 GB`）。

- 数据来自 `du -sb /opt/apps/<name>`，是**应用目录**的大小（不含 docker 镜像层）
- 结果缓存在内存里，**10 分钟**过期；请求只读缓存，过期后由后台慢慢补，不会拖慢列表
- 服务重启后会自动量一遍，打开页面就有数字；还没有实测值时退回 `deploy.json` 里部署时记的 `size`
- 创意工坊（vibe）的应用在 `/opt/vibe-release`，目前不显示占用

### 卡片操作区布局

卡片宽度有限（网格 `minmax(300px,1fr)`），6 个按钮一行放不下会把「下线」挤出卡片。
现在固定为 **3 个常显 + 1 个「更多」菜单**：

```
[更新]  [编辑信息]  [日志]              [更多 ▾]
                                         ├ 重启
                                         ├ 回滚
                                         └ 下线（红）
```

- 「下线」这类破坏性操作收进菜单，避免误点
- `.app-actions` 加了 `flex-wrap`，极端窄卡片也不会溢出
- 菜单向上弹出（`bottom:100%`），最后一行卡片不会被视口裁掉
- 点空白处 / Esc 关闭

```bash
POST /api/apps/<应用名>/meta   # {title, desc, cover, entry, author, category}，需作者或管理员
POST /api/apps/cover           # 上传封面 → /uploads/<file>，≤5MB，png/jpg/webp/gif
```

重新部署**不会**冲掉这三个字段：`appctl` 与静态站部署都会沿用旧值。
改完不需要重新部署，保存时控制台会自动调 `apps-index.py` 重新生成 `/apps/` 页面。

### 保存了但页面没变？先看这两处

1. **数据是否真写进去了**：`cat /opt/apps/<app>/deploy.json`，看 `cover` / `title` 有没有值
2. **索引页是否重新生成了**：`stat -c %y /opt/apps/guide/apps/index.html`，
   时间没变说明 `apps-index.py` 没跑成功

最常见的原因是**权限**：`/opt/apps/guide/apps` 或 `index.html` 被 **root 跑过一次**后变成 `root:root`，
控制台以 `guanfu` 运行就写不进去，而旧代码把异常吞了 —— 表现为「保存成功，页面没变」。

自查：

```bash
ls -ld /opt/apps/guide/apps          # 属主应为 guanfu
sudo -u guanfu python3 /opt/apps/_shared/bin/apps-index.py   # 能跑通吗
journalctl -u deploy-console -n 30 | grep apps-index
```

现在 `apps-index.py` 有三重兜底：原子写失败退回原地写、写完把属主对齐目录属主、
控制台把失败打到 journal 并回 `indexUpdated:false`，前端会直接弹红字提示。

**通用规则**：任何 root 执行的脚本只要会写站点文件，写完必须 `chown --reference=<目录>`，
否则下一次以服务身份写就会失败。

### 删了重传会怎样

「下线」会删掉整个应用目录，展示信息本来也会跟着没。现在做了归档兜底：

- 下线时把 `title` / `desc` / `cover` 存进 `/opt/apps/deploy-console/app-meta-archive.json`
- 同名重新上传（`update=false` 的新建）时自动取回
- 只补空字段，不会覆盖新设置的

所以「下线 + 重传」不再丢展示信息，但**仍然有中断**——发版本请用「更新」（见 3.9）。

### 创意工坊的访问端口

每个工坊应用有双入口，包装页按当前协议自动选：

| 协议 | 端口 | 场景 |
|---|---|---|
| HTTPS | 4401-4428 | 证书已受信任 |
| HTTP | **4501-4528** | 环境不支持 https / 证书未装 |

包装页不再写死 `https://host:4401`，而是 JS 判断 `location.protocol` 再拼端口。
改动在 `vibe-sync.py`，改完重跑：

```bash
python3 /opt/apps/_shared/bin/vibe-sync.py   # 重生成 28 个入口页 + nginx 并 reload
```

## 3.11 资源限额（内存 / CPU）与配额

每个容器应用的限额写在它自己的 `docker-compose.yml` 里：

```yaml
mem_limit: 4g     # 内存上限，超了 OOM kill；swap 上限自动是它的 2 倍
cpus: 4.0         # CPU 上限（CFS 配额，不是预留）
```

默认值 `512m` / `1.0` 核（`appctl` 的 `DEFAULT_MEM` / `DEFAULT_CPUS`）。

### 改限额（不动镜像）

| 入口 | 说明 |
|---|---|
| 控制台卡片「更多 → 资源限额」 | 弹窗填内存 / CPU，保存后容器重建（2-5 秒短断），`data/` `logs/` 保留 |
| `appctl limits <app> --mem 1g --cpus 2` | 命令行同一个动作；只写指定的项，另一项保持原值 |

`dvctl limits <app> --mem 1g --cpus 2` 与上面等价，适合 agent / 脚本调用。

改完 `deploy.json` 会同步记下 `mem` / `cpus`，控制台列表能读到。

**重新发布不会重置限额**：上传或镜像部署时没显式给 `--mem` / `--cpus`，
`appctl` 会按 `deploy.json` → `docker-compose.yml` → 默认值的顺序沿用上次的配置。
默认值（512m / 1 核）只对**新建**应用生效。所以调好之后尽管重新发布，配额不会被冲掉。

### 内存配额保护

- 判定口径：所有 `app-*` 与 `vibe_*` 容器的 `mem_limit` 之和，**不能超过整机的 85%**
  （`MEM_BUDGET_PCT` 可调）；换限额时会先减掉该应用自己的旧值
- 超了直接拒绝（接口 409），提示已分配 / 本次 / 合计 / 上限
- 确实要超：管理员在请求体里带 `"force": true` 跳过（控制台没做这个开关，避免误点）
- 概览页「内存配额」卡显示已分配 / 预算；主机信息里还有「CPU 配额」一行

**CPU 只提示不拦截**：配额是上限不是预留，28 个工坊 × 1 核在 16 核机器上是正常超配。
超过 `核数 × CPU_BUDGET_RATIO`（默认 2.5）时，部署日志/接口返回里会多一句提醒。

限制：静态站点没有容器，不适用；MySQL 是宿主机共享进程，不在这套配额里。

### 概览页的实时监控

概览最上面是「实时监控」卡：CPU / 内存两条曲线 + 当前值，下面是容器 Top 6（CPU%，内存）。

- **5 秒**一次，只在概览页可见时轮询（切走或标签页在后台自动停）
- 曲线保留最近 **90 个采样**（约 7.5 分钟），页面刷新即清空
- 数据来源**不是 `docker stats`**（31 个容器要 2s+，做不了 5 秒轮询），
  而是 `/proc/stat`、`/proc/meminfo` 和 cgroup v2 的
  `/sys/fs/cgroup/system.slice/docker-<id>.scope/{cpu.stat,memory.current}`，单次约 180ms
- 容器明细只有管理员能看到（`/api/metrics` 按角色裁剪）；成员只拿到主机指标
- 容器列表按 CPU 排，全是 0% 时自动按内存排（大多数时候都空闲，这样更有参考价值）

## 5. SSH 兜底（dbx）

```bash
DBX=$SK/scripts/dbx
$DBX run "appctl list"             # guanfu 身份
$DBX root "systemctl reload nginx" # root 身份
$DBX put ./dist /tmp/build-x       # 传文件（目录会嵌套，目标写父目录）
```

`appctl` 是底层工具（`deploy/status/logs/rollback/remove/list/ports`），控制台调的就是它。
只有需要绕过控制台时才直接用。

## 6. 排查

| 现象 | 处理 |
|---|---|
| `doctor` 报令牌无效 | 用如视账号登录控制台，令牌会自动发放并显示一次；拿到后 `dvctl login` |
| SSL 证书错误 | 删掉 skill 目录的 `ca.crt` 让它重新自动获取；或设 `CONSOLE_CA=/path/ca.crt` |
| 连接超时 | 检查本机到 `10.33.207.254` 的路由，代理软件可能劫持内网网段 |
| 部署返回 400 | 看返回的 `log` 字段，通常是 docker build 失败或没识别到项目结构 |
| 访问 404 | 确认访问 `/apps/<name>/`（带尾斜杠），以及 nginx 片段是否存在 |

## 7. 不要做的事

- ❌ 不经确认就 `remove`（连数据目录一起删）
- ❌ 使用 4001-4099 端口（vibe-release 专用）
- ❌ 动 `/opt/apps/_shared/`、`/opt/apps/guide/`、`deploy-console` 自身
- ❌ 在生产容器（`vibe-release/*`）上做 `docker restart` / `rm`
- ❌ 把令牌、密码写进代码或提交到仓库
- ❌ **发新版本先 `remove` 再上传**——空窗等于整包上传时长（418MB 约 2 分钟）。
  同名再传一次即可，存在会自动按更新处理
- ❌ **站内链接写死 `http://` 或 `https://`**——环境可能只有 http（内部 CA 没装、或只开 80），
  写死 https 的链接点开就是打不开。一律用相对路径 `/apps/<名>/`
- ❌ 后端用 `https://${PUBLIC_HOST}` 拼返回给前端的地址，同样会踩上面这个坑

## 8. 地址与协议

**站内一切链接都用相对路径，让浏览器按当前协议走。**

| 位置 | 正确写法 | 错误写法 |
|---|---|---|
| 应用卡片 | `href="/apps/foo/"` | `https://guide.realsee.cn/apps/foo/` |
| 后端返回 | `access: "/apps/foo/"` | `` `https://${host}/apps/foo/` `` |
| 图片/资源 | `/tools/uploads/x.png` | `https://…` |

补充：

- 服务器**没有** http→https 强制跳转，也**没有** HSTS，所以 http 访问是正常的
- 浏览器（Chrome 新版）可能自己把 http 升级成 https，这是客户端行为，与服务器无关
- `COOKIE_SECURE` 默认不设，http 下会话 cookie 能正常使用；只有全站 https 时才开
- `dvctl` 的 `CONSOLE_URL` 默认是 `https://`；环境只有 http 时在 `.env` 里改成 `http://`
- 业务应用自己的分享链接（如 `VIEWER_PUBLIC_URL`）要和访问协议一致，否则跳过去也会失败
