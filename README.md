# ttot-chat — T-to-T（聊聊）即时通讯 · DSH 插件

把 [T-to-T](https://github.com/YuHong-Cray/T-to-T)（聊聊，功能完整的 Web 即时通讯应用：
私聊 / 群聊 / 朋友圈 / 好友系统 / 管理面板 / WebRTC 通话信令）改造成 DeepSeek Harness
（DSH）插件：注册一个 `ttot` 模型工具，由 agent 直接管理聊天服务器生命周期并操作聊天
（注册、好友、私聊、WebSocket 通用收发、HTTP API 通用调用）。

**用户管理直接对接 dsh-login**：聊天用户以 dsh-login 的 MySQL 用户表（`$DSH_HOME/dsh-login.json`
中的 `db` 配置，本机为 `SMART-STP.dsh_login`）为唯一事实来源——列出 dsh 用户、创建 dsh 用户、
并把每个已批准的 dsh 用户自动镜像成同名聊天账号（dsh 管理员自动成为聊天管理员）。

## 组成

```
ttot-chat/
├── package.json        # 插件清单（dsh.bundle.patch → cordis.patch.yml，零运行时依赖声明）
├── cordis.patch.yml    # bundle 补丁：插入 ttot（模型工具）+ ttot-ui（页面入口按钮）两行
├── lib/
│   ├── index.js        # 插件入口：注册 ttot 工具（挂载守卫 + 卸载清理），并兼容旧式 role:ui 行
│   ├── ui2.js          # 页面入口半体（`ttot-ui3` 行）：经 webServer.tapIndex 注入入口脚本 ——
│   │                   #   ① 左下角悬浮「💬」键（默认停靠设置键正上方、可拖拽、不遮挡它）；
│   │                   #   ② 右侧 Sidebar「开始」页「聊天」「账户」入口，与「工作区文件」「新建终端」
│   │                   #      排成 2×2 四方块；③ 移除 dsh-login 的悬浮「账户」键
│   ├── button-client.js # ui2.js 每次 index 渲染实时读取的入口脚本（改文案/布局硬刷新即生效，免重启）
│   ├── button-script.js # 旧式 ui.js 行的注入脚本与 HTML 变换（index.js 与 ui.js 共用，避免两份副本走偏）
│   ├── dsh-users.js    # dsh-login MySQL 用户表读写（scrypt 哈希与 dsh-login 完全兼容）
│   ├── server-manager.js # 聊天服务器进程管理（detached 子进程 + pidfile + 端口探测）
│   ├── chat-api.js     # 聊天 HTTP API 客户端（Bearer token）
│   └── ws-client.js    # 零依赖 RFC6455 WebSocket 客户端（net + crypto 实现）
├── app/                # 打包的 T-to-T 应用（server.js + public/ + 证书 + 完整 node_modules）
├── node_modules/       # lib 侧依赖（mysql2/bcryptjs/uuid 复制，better-sqlite3 软链到 app）
└── e2e.mjs             # 端到端自测（15 步，会重置聊天数据，谨慎运行）
```

## ttot 工具动作

| 动作 | 说明 |
| --- | --- |
| `status` | 服务器状态、dsh-login 库健康、已存储用户、聊天用户数 |
| `start` | 启动聊天服务器（HTTP 3000 / HTTPS 3443），返回 Web UI 地址 |
| `stop` | 停止聊天服务器（进程组 SIGTERM→SIGKILL） |
| `users` | 列出全部 dsh-login 用户（状态 / dshAdmin / 聊天侧开通情况 / 聊天密码） |
| `dsh-add` | `{username, password}` 创建 dsh-login 用户（approved，与 DSH 登录同密码）并镜像到聊天 |
| `dsh-sync` | `{username?}` 把所有（或指定）已批准的 dsh 用户镜像为聊天账号；dsh 管理员 → 聊天管理员 |
| `register` | `{phone, password}` 独立手机号+短信验证码注册（开发模式验证码直接返回，供 Web UI 真人使用） |
| `login` | `{username, password}` 聊天登录（dsh 镜像用户 / 手机用户均可） |
| `add-friend` | `{targetUsername, from?}` 发起好友申请 |
| `approve-friend` | `{requesterUsername, from?}` 通过好友申请（已是好友时幂等） |
| `send-message` | `{to, text, from?}` 发送私聊消息（需互为好友；WebSocket） |
| `read-messages` | `{from?, limit?}` 读取某用户最近接收到的消息（好友请求 / 私聊等） |
| `ws-send` | `{type, payload?, from?}` 通用 WebSocket 消息（群聊、通话信令等） |
| `api` | `{method, path, body?, from?}` 通用 HTTP API 调用 |

`from` 可选，指定以哪个已存储身份操作（默认：管理员会话，否则第一个）。

典型流程：`start → dsh-sync → add-friend(wyh→tty) → approve-friend(from: tty) →
send-message(wyh→tty) → read-messages(from: tty)`。

## 与 dsh-login 的集成

- **用户事实来源**：MySQL `dsh_login` 表（列：id / username / password_hash / status /
  created_at / last_login_at）。插件用与 dsh-login 相同的连接配置（`$DSH_HOME/dsh-login.json` 的
  `db` 段；实例模式配置无 db 段时回落到 hub 的 `/root/.dsh/dsh-login.json`）。
- **密码兼容**：`dsh-add` 用 dsh-login 同款 scrypt 验证串（`scrypt$16384$8$1$salt$hash`，
  base64url）写入，因此新建的 dsh 用户**同一组用户名/密码**既能在 DSH Web 登录页登录，
  也能在聊天 Web UI 登录（聊天侧密码 = dsh 侧密码）。
- **角色映射**：`dsh-login.json` 的 `adminUsers`（本机为 `wyh`）映射为聊天管理员。
- **存量用户**（如 wyh / tty）：聊天密码为随机生成（12 位），记录在
  `app/.ttot-sessions.json` 并随 `users` 动作返回，便于告知本人。
- 聊天账号通过直接写聊天 SQLite（`app/data.db`，与服务器共享 WAL 库）开通：
  users 行（bcrypt 密码）+ tokens 行（UUID token，WS/HTTP 认证）。
- **实例自动继承**：dsh-login 的每用户实例模板（vendor `instances.js`）已扩展：新建用户
  实例时自动安装 ttot-chat（profile 依赖 + bundle + 两行挂载），保证每个用户的 DSH
  页面都带聊天入口按钮与 `ttot` 工具（以插件目录存在为条件，缺失时不影响开实例）。
  注意：运行中的 hub 进程在重启前仍用旧模板，期间新开实例需手动补装（`dsh plugin add` + 补丁行）。

## 克隆后的本地准备（被 .gitignore 排除的资源）

本仓库只跟踪源码：`node_modules`、聊天库、自签证书、会话/状态文件与日志都由本机生成。
克隆到新机器后按需重建：

```sh
cd /root/test/ttot-chat

# 1) T-to-T 应用依赖（app/node_modules，约 37 MB）
cd app && npm install && cd ..

# 2) lib 侧依赖：node_modules/ 里全是指向 app/node_modules 的软链
mkdir -p node_modules
for p in aws-ssl-profiles bcryptjs better-sqlite3 express generate-function \
         iconv-lite is-property long lru.min mysql2 named-placeholders \
         safer-buffer sql-escaper uuid ws; do
  ln -sfn "../app/node_modules/$p" "node_modules/$p"
done

# 3) 自签证书（HTTPS 3443 用）
cd app && openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout key.pem -out cert.pem -subj "/CN=localhost" && cd ..

# 4) 聊天库（app/data.db）与 app/uploads/ 由聊天服务器首次启动时自动创建
mkdir -p app/uploads
```

被忽略的路径一览：`node_modules/`、`app/{data.db,data.db-*,key.pem,cert.pem,debug.log}`、
`app/.ttot-{sessions,plugin,ui}.json`、`app/.ttot.pid`、`app/.ttot-server.log`、`app/uploads/*`。
其中 `app/.ttot-sessions.json` 含**明文会话 token 与 chatPassword**，因此绝不入库。

## 安装（本机已完成）

```sh
# 1) 安装进 web profile（pnpm 12 需要 -w：profile 目录是 workspace root）
cd /deepseek-harness && pnpm dsh plugin --profile web add -w /root/test/ttot-chat
#    → 依赖写入 profiles/web/package.json，并自动把 ttot-chat 加入 dsh.profile.bundles

# 2) 当前进程免重启生效：往 profile 的用户补丁层插入行（该文件被 HMR 监视、热重载；
#    bundle 层在启动时冻结，所以运行中的进程只能经由用户补丁层挂载）
cat >> /root/.dsh/profiles/web/cordis.patch.yml <<EOF
- insert:
    - id: ttot
      name: ttot-chat
      inject: [tools]
EOF

# 3) 验证：挂载标记（pid 即挂载该插件的 dsh 进程）
cat /root/test/ttot-chat/app/.ttot-plugin.json

# 4) 组合树检查（含 bundle 层与用户补丁层两处 ttot 行）
cd /deepseek-harness && pnpm dsh --profile web --dump-config | grep -B1 -A3 ttot
```

**双行说明**：重启后插件自带的 bundle 补丁也会插入 ttot 行，与用户补丁层形成两行；
模块内 `__ttotChatPluginMounted` 守卫 + 挂载计数使第二次 `apply()` 成为无操作，
且任一行卸载时会清理守卫与连接，允许同进程内重新挂载。

## 使用

- **Agent 内**：`ttot` 工具出现在会话工具列表中，按上面动作表调用即可。
- **Web UI**：`start` 后浏览器访问 `http://<本机IP>:3000`（HTTPS `:3443`，内置自签证书；
  语音/视频通话走 HTTPS）。**登录凭据与 dsh-login 完全一致**：聊天服务器在本地 bcrypt 校验失败时
  回落到 `dsh_login` 表做 scrypt 校验（`app/server.js` 的 dsh-login 桥），通过后自动开通/同步同名
  聊天账号并签发 token —— 直接用 **DSH 的用户名+密码**即可登录，无需另记密码（手机号+验证码
  注册仍保留给没有 DSH 账号的人）。
- **DSH 页面入口**：两个入口（`ttot-ui3` 行 → `lib/ui2.js` 经 `webServer.tapIndex` 注入，每次渲染
  实时读取 `lib/button-client.js`；改文案/布局**硬刷新**即生效，免重启）：
  ① **左下角悬浮「💬」键**——给不看右侧隐藏区的普通用户；默认自动停靠左侧栏底部「设置」键的**正上方**
  （实时跟踪设置键位置，折叠/展开侧栏都不遮挡它），仍可**拖拽**到任意位置（位置存 localStorage
  `ttot-chat-btn-pos-v2`；旧位置键被忽略，不会恢复到遮挡设置键的老位置）；
  ② **右侧 Sidebar「开始」页**（guide）上的「聊天」「账户」入口，与「工作区文件」「新建终端」排成
  **2×2 四方块**（dsh-login 原来右下角的悬浮「账户」按键由同一脚本从页面移除，入口合并到此页）。
  两个入口都在**新标签页**打开**同源路径 `/ttot/`**（不是 `:3000`），由插件注册在 DSH web 服务器上的
  反向代理转发到聊天服务，因此无论你是用 127.0.0.1、LAN IP 还是 SSH 隧道访问 GUI，链接都能打开；
  代理还会把 actor（默认 dsh 管理员，行 `config.webActor` 可指定）的聊天 token 注入聊天首页，
  点开即**自动登录**。聊天服务器未启动时两处入口都变暗（每 30 秒探测一次）。
- 服务器日志：`app/.ttot-server.log`；会话状态：`app/.ttot-sessions.json`。
- 端口可用环境变量 `TTOT_HTTP_PORT` / `TTOT_HTTPS_PORT` 覆盖（默认 3000 / 3443）。

## 多实例说明

本机的 dsh-login 是 hub 模式（3080 = hub，`/root/dsh-users/<user>` = 每用户实例）。
插件已安装到 hub 的 web profile 与 tty 实例的 profile；聊天服务器是**单实例共享**——
哪个 dsh 进程先 `start` 就由谁拉起（pidfile + 端口探测，后来的进程直接接管），
所有实例的 `ttot` 工具操作同一个聊天服务器。

## 同源聊天代理

`lib/ui2.js` 在 DSH web 服务器上注册两条路由：

| 路由 | 类型 | 作用 |
| --- | --- | --- |
| `/ttot` | HTTP 前缀 | 去掉前缀后转发到 `127.0.0.1:<TTOT_HTTP_PORT>` |
| `/ttot-ws` | WebSocket 升级 | 原始 TCP 隧道，握手改写到聊天服务的 `/` |

聊天前端用的是绝对路径（`/api/...`）且 WebSocket 连 `location.host` 根路径，所以代理会实时重写
聊天 `app.js` 的响应体：`'/api/`（含双引号/反引号变体）→ `'/ttot/api/`，WebSocket URL → `.../ttot-ws`；
相对资源（`style.css`、`app.js`）天然落在前缀下。聊天首页 HTML 会被注入一段自动登录脚本
（token 取自 `app/.ttot-sessions.json` 的 actor 会话），因此无需手输密码。

## 页面按钮排查

1. `cat app/.ttot-ui.json` —— 显示最近一次挂载 tap 的 dsh 进程 pid 与 `via`（多进程共用该文件，
   最后挂载者胜出）。要确认某个特定进程，看它在挂载后是否重写过该文件即可。
2. 抓页面 HTML 验证注入：`curl -s -b <cookie> http://127.0.0.1:<port>/ | grep -c ttot-chat-ui`
   （未登录时 dsh-login 会 302 到登录页，属正常现象）。
3. 语法自检：把注入的 `<script>` 内容交给 `new vm.Script(code)` 解析——本项目曾因注入脚本里
   一个多余分号（`.then(...)` 后跟 `.catch(...)`）导致整段脚本不执行、按钮消失，grep 标记字符串
   无法发现这类问题。
4. 浏览器侧：硬刷新；DevTools 里看 Console 报错与 `<button id="ttot-chat-btn">` 是否出现。

## 自测

```sh
# 重置聊天数据后运行（会杀掉现有聊天服务器、删除 data.db 与状态文件）：
cd /root/test/ttot-chat/app && kill $(cat .ttot.pid) && rm -f data.db* .ttot-sessions.json .ttot.pid
cd /root/test/ttot-chat && node e2e.mjs    # 15 步：启动→dsh-sync→建 dsh 用户→登录→好友→私聊→清理
```

## 已知限制

- 改动 `app/server.js`（例如 dsh-login 登录桥）后必须**重启聊天服务器**才生效：
  `ttot` 工具的 `stop` + `start`（数据与会话都在 `app/data.db`，不丢）。

- 私聊消息不落库（T-to-T 原始设计：仅 WS 投递），`read-messages` 只能看到**连接存续期间**收到的消息。
- dsh 镜像用户的聊天密码在 `users` 输出中可见（模型可见），介意的话只使用手机注册用户。
- 插件代码更新默认要重启 dsh 进程（HMR 为 config-only）。loader 的实测行为（读 `vendor/loader` 源码确认）：
  只改行的 `name` **完全不生效**；改 `config` 会重启该行但**不会**重新导入模块。要让运行中的进程
  吃到新代码，只能给它一个**新行 id**（新条目 → 全新 import）。本机用户补丁里的 `ttot-ui2` +
  `- id: ttot-ui {disabled: true}` 就是为此保留的迁移垫片，重启后依然无害。
- WebRTC 语音/视频通话的信令可经 `ws-send` 操作，但媒体流需要浏览器，agent 侧无法代劳。

## 来源

- 应用：[YuHong-Cray/T-to-T](https://github.com/YuHong-Cray/T-to-T)（聊聊 v2.0.0）
- 插件框架：DeepSeek Harness / Cordis（`dsh plugin` + `dsh.bundle` 补丁层）
- 用户体系：dsh-login（本机 web profile 的 vendor 插件，MySQL 账号表）