# Codex LAN Companion

[English](README.md)

Codex LAN Companion 是一个运行在本地的自托管 Web 服务，用来在同一局域网内从其他设备查看并轻量控制 Codex Desktop。它面向家庭或可信局域网使用：在运行 Codex Desktop 的 Mac 上启动服务，然后用同一网络里的任意浏览器设备访问，包括手机、平板、Windows PC、Linux 笔记本、智能屏、Kindle/电子书阅读器，或者任何有可用浏览器的设备。

这是一个非官方工具。它会读取本地 Codex Desktop 状态；默认情况下，也可以通过本地 Codex Desktop IPC 从网页端向 Codex 发送消息。如果只想查看对话，请用 `--readonly` 启动。

## 首个发布版本提示

这个仓库正在准备 Codex LAN Companion 的首个公开发布版本。

重要兼容性说明：首个版本只在作者发布时可用的最新版 Codex Desktop 上开发和验证：macOS 上的 Codex Desktop `26.527.60818`，测试日期为 2026-06-03。Codex Desktop 的本地文件和 IPC 都是私有实现细节，不是公开兼容性协议。后续 Codex Desktop 版本可能改变这些接口，并导致本工具部分或完全不可用。如果发生这种情况，请先按新版 Codex Desktop 的行为更新本项目，再依赖它使用。

## 功能

- 通过局域网浏览器 UI 查看 Codex Desktop 对话
- 支持同局域网内各种浏览器设备：macOS、Windows、Linux、手机、平板、Kindle/电子书阅读器、智能屏等
- 适配移动端的对话列表和消息视图
- 近实时同步，包括“思考中”状态提示
- 在可读取时显示账号和本地套餐用量摘要
- 输入框插件选择器，支持友好的插件标签
- 输入框技能选择器，支持 `/` 触发和友好的技能标签
- 可写模式下支持图片附件
- 在可检测时显示审批请求和重要提示
- 从网页端新建对话
- 默认启用访问码保护 API
- 浏览器内友好的访问码输入界面
- 默认可从网页端发送消息到 Codex Desktop
- 可选 `--readonly` 只读模式
- 终端二维码扫码登录，方便浏览器设备访问

## 安装

### 用户快速开始

前置条件：

1. 在 Mac 上安装 Codex Desktop 并登录。
2. 安装 Node.js 18 或更新版本。
3. 让 Mac 和准备用来访问的浏览器设备连接到同一个 Wi-Fi 网络。

不全局安装，直接运行：

```bash
npx codex-lan-companion
```

或者先全局安装，再运行：

```bash
npm install -g codex-lan-companion
codex-lan-companion
```

终端会打印本机 URL、局域网 URL、一个短数字访问码和二维码。可以用手机/平板扫码自动打开并登录局域网页面；也可以在任意浏览器设备上手动打开 LAN URL，然后输入终端里显示的访问码。

默认模式允许从网页端向 Codex Desktop 发送消息。如果只想查看对话，请这样启动：

```bash
codex-lan-companion --readonly
```

### 从源码运行

贡献者或本地开发可以 clone 仓库后运行：

```bash
npm install
npm start
```

## 使用

默认模式可写，并启用访问码保护：

```bash
codex-lan-companion
```

终端会打印类似下面的信息：

```text
Codex LAN Companion is running
Local:  http://127.0.0.1:8787/
LAN:    http://10.0.0.131:8787/
Access code: 482913
Mode:   write enabled · access-code protected
Type:   qr, no-auth, auth, or help + Enter for runtime commands

QR:     opens the LAN page and signs in automatically
```

在同一 Wi-Fi 下，用任意浏览器设备打开 LAN URL；也可以用带摄像头的设备扫描终端二维码来自动打开并登录。没有指定密码时，服务每次启动都会自动生成一个 6 位数字访问码。二维码包含当前启动周期的临时登录 URL；页面打开后，浏览器会从地址栏移除登录参数。默认情况下访问码只保存在页面内存中，因此刷新或重新打开页面会再次要求输入。登录页勾选 “Remember this device” 后，浏览器会跨重启保存访问码。

## 二维码扫码登录

Codex LAN Companion 启动时会在终端打印二维码。二维码包含局域网 URL 和当前服务启动周期的临时登录参数。

在同一 Wi-Fi 下，用手机、平板或其他带摄像头的设备扫码，就可以打开 Web UI 并自动登录。没有摄像头的设备可以手动打开 LAN URL 并输入访问码。

如果终端输出已经被滚走，可以在同一个终端输入 `qr` 并回车，重新打印登录二维码：

```text
qr
```

二维码等价于当前访问码。不要把终端截图或二维码分享给不信任的人。

## 运行时终端命令

服务在交互式终端里运行时，可以输入这些命令并回车：

```text
qr       重新打印登录二维码
url      重新打印本机和局域网 URL
code     打印当前访问码
no-auth  不重启服务，直接关闭访问码认证
auth     重新开启访问码认证，并打印当前登录二维码
help     显示可用命令
```

使用只读模式：

```bash
codex-lan-companion --readonly
```

默认情况下，Web UI 可以通过本地 Codex Desktop IPC 向 Codex Desktop 发送文本、选中的插件或技能引用，以及支持的图片附件。运行本服务的 Mac 上应保持 Codex Desktop 已打开并已登录。`--readonly` 会禁用浏览器端发送消息、中断任务和审批操作。

指定端口或固定访问码：

```bash
codex-lan-companion --port 8790 --password home-only
```

只有在你希望每次都使用同一个访问码时，才建议设置固定访问码。否则，让服务每次启动自动生成新的 6 位数字访问码即可。

只在可信本地网络中禁用认证：

```bash
codex-lan-companion --no-auth
```

## 选项

```text
--host <host>          绑定地址。默认：0.0.0.0
--port <port>          绑定端口。默认：8787
--password <password>  友好的访问码。默认：每次启动生成 6 位数字码
--token <token>        --password 的别名
--readonly             禁止向 Codex Desktop 发送消息
--no-auth              禁用访问码保护
--codex-home <path>    Codex 数据目录。默认：~/.codex
--ipc-socket <path>    Codex Desktop IPC socket 覆盖路径
-h, --help             显示帮助
```

也支持环境变量：

```bash
PORT=8790 HOST=0.0.0.0 CODEX_LAN_PASSWORD=home-only codex-lan-companion
```

## 运行要求

- macOS
- 已安装并登录 Codex Desktop
- Node.js 18+
- Mac 和浏览器设备在同一局域网
- Mac 上可用 `sqlite3`

从浏览器发送消息要求 Codex Desktop 正在运行，并且目标对话可被桌面端访问。

首个发布版本验证环境：

- macOS
- Codex Desktop `26.527.60818`
- Node.js 18+

其他环境可能也能运行，但首个发布版本尚未验证。

## 数据来源

- 对话列表：`$CODEX_HOME/state_5.sqlite`
- 对话内容：`$CODEX_HOME/sessions/**/rollout-*.jsonl`
- 可选账号显示：本地解码 `$CODEX_HOME/auth.json`，不会向浏览器返回 token
- 可选发送支持：Codex Desktop 本地 IPC socket
- 可选插件列表：当前 Codex home 暴露的本地 Codex 插件元数据

服务器不会把 Codex auth token 返回给浏览器。

## 已知限制

- 兼容性依赖 Codex Desktop 本地存储和私有 IPC 行为。未来 Codex Desktop 更新可能破坏对话同步、账号显示、审批、插件引用、发送或中断支持。
- 同步是近实时的，不是完美推送。对话数据会高频刷新，但某些只存在于 Codex Desktop UI 中的状态可能延迟出现，或者无法检测。
- 某些 Codex Desktop 提示、警告或审批状态可能无法完全从 Web UI 处理。请保留可访问 Codex Desktop 的备用方式。
- Web UI 新建的对话可能不会立刻出现在 Codex Desktop 自己的侧边栏中；Codex Desktop 似乎会按自己的节奏刷新列表。
- 本工具面向可信局域网使用，并未针对公网暴露做安全加固。

## 安全说明

这个服务会把本地 Codex 对话标题、消息、工具输出、项目路径和账号显示信息暴露给能访问 URL 并通过访问码认证的浏览器。请只在你信任的网络中使用。

建议默认做法：

- 保持访问码认证开启。
- 只需要查看对话时使用 `--readonly`。
- 不要把端口暴露到公网。
- 不要把终端截图或二维码分享给不信任的人。
- 只有在能保护好访问码时，才使用固定访问码。

## 稳定性说明

本项目依赖 Codex Desktop 本地文件和私有 IPC 行为。这些都不是公开兼容性协议，未来 Codex 版本可能发生变化。

首个发布版本只在开发和测试时可用的最新版 Codex Desktop `26.527.60818` 上验证。不保证无需修改即可兼容更新的 Codex Desktop 版本。

## 商标说明

这是一个非官方 companion 项目，与 OpenAI 无关联。项目内置 UI 标记是原创项目图形，不是 OpenAI 或 Codex 应用图标。
