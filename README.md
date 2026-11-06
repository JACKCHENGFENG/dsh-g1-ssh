# dsh-g1-ssh — G1 SSH 桥接

通过 SSH 连接宇树 G1 机器人（无线或网线均可），把「在机器人上执行命令 / 读写文件」注册成 DeepSeek Harness 的 agent 工具，并提供首次启动的连接向导和常驻设置页。

## 从 GitHub 安装

```bash
git clone https://github.com/<你的用户名>/dsh-g1-ssh.git
cd dsh-g1-ssh
npm install        # 安装 @deepseek-ai/schemastery（Config 声明需要）
```

然后在 DSH 的 Plugin Manager 里选择该目录安装（或让 agent 用 `plugin_manager install_bundle` 指向这个目录）。安装后刷新页面，新建一个空白会话即可看到首次连接向导。

## 首次启动

插件第一次运行时（`setupDone` 为 false），在空白会话里会弹出一个模态对话框：

1. 选择 **无线（Wi-Fi）** 或 **有线（网线）**；
2. 填写 G1 的 **IP 地址**（无线预填 `192.168.10.183`，有线预填 `192.168.123.161`，可修改）；
3. 填写 **SSH 用户名** 与 **密码**；
4. 保存后对话框关闭，agent 立即使用新配置。

也可以点「稍后设置」跳过，下次出现空白会话时会再次提示。

## 设置页

侧边栏 **设置 → G1 机器人** 可以随时修改连接方式、IP、用户名和密码。保存后的配置写入 profile 的 `cordis.patch.yml`（覆盖 bundle 里的默认配置），重启后仍然有效。

密码在 schema 里标记为 `role('secret')`：浏览器只能写入、不能读回；配置文件里的密码仍是本机明文（profile patch 权限 600）。

## 工具

| 工具 | 作用 |
| --- | --- |
| `g1_status` | 探测 SSH 链路，返回主机名、内核、用户、运行时长、内存、磁盘等 |
| `g1_exec` | 在机器人上执行 shell 命令，返回退出码、stdout、stderr |
| `g1_read` | 带行号读取远端文本文件（可指定行范围） |
| `g1_write` | 原子写入远端文本文件（可建目录、可备份） |
| `g1_edit` | 在远端文件中精确替换文本（先读后写，比整文件重写安全） |
| `g1_configure` | 读取/修改连接配置（模式、IP、用户、密码），与设置页同一套逻辑 |

## 配置项

`Config` 中的字段（bundle patch 提供默认值）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `mode` | `wifi` | `wifi` / `wired`，设置页可改 |
| `host` | 空 | G1 地址，首次向导或设置页填写 |
| `user` | `unitree` | SSH 用户，设置页可改 |
| `password` | 空 | SSH 密码（secret），设置页可改 |
| `setupDone` | `false` | 首次向导是否已完成 |
| `port` | `22` | SSH 端口 |
| `privateKeyPath` | 空 | 设置后改用私钥登录（忽略密码） |
| `knownHostsFile` | `~/.dsh/g1-ssh/known_hosts` | 主机指纹文件 |

`mode`/`host`/`user`/`password`/`setupDone` 标记为 `volatile()`：Loader 交给插件的是实时引用，工具每次调用读取当前值，所以设置页保存后无需重启。

## 实现

- 使用系统 OpenSSH 客户端（`ssh`），密码通过一次性 `SSH_ASKPASS` 脚本传入，不依赖 `sshpass`，脚本用完即删。
- 主机指纹使用独立 `known_hosts`（`StrictHostKeyChecking=accept-new`）。
- 写入采用「临时文件 + rename」原子替换，并保留原文件权限位。
- 浏览器半放在 `client.js`：`settings.onboarding` 负责首次启动模态框，`settings.section` 提供设置页；两者共用同一表单，通过 Harness 的 `configForms`/settings 服务读写配置。
- `package.json` 把 `@deepseek-ai/schemastery` 声明为依赖；以 pnpm `link:` 方式安装时，链接目录内的 `node_modules/` 需要保留（已在 `.gitignore` 中排除，克隆后执行 `npm install` 即可）。

## 安全说明

密码以明文保存在 profile patch 中（权限 600），设置服务对浏览器请求做脱敏。若机器人重装系统或更换主机密钥，删除 `~/.dsh/g1-ssh/known_hosts` 后再连接。
