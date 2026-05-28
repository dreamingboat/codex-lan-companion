# Codex LAN Viewer

本地只读 Web Service，用浏览器查看当前机器上的 Codex 对话列表和对话内容。

## 运行

```bash
npm start
```

默认监听：

```text
http://0.0.0.0:8787
```

同一局域网的设备访问：

```text
http://你的Mac局域网IP:8787
```

可以用环境变量修改：

```bash
PORT=9000 HOST=0.0.0.0 CODEX_HOME="$HOME/.codex" npm start
```

## 数据来源

- 对话列表：`$CODEX_HOME/state_5.sqlite` 的 `threads` 表
- 对话内容：`$CODEX_HOME/sessions/**/rollout-*.jsonl`

网页每 3 秒自动同步一次。第一版是只读，不会向 Codex 写入内容。

## 实验输入功能

页面底部有输入框，可以把文本发送到当前选中的 Codex 对话。当前版本接入 Codex Desktop 自己的本机 IPC socket，使用桌面端内部的 `thread-follower-start-turn` 桥接请求，由桌面窗口里的 owner 会话代发消息。

默认 IPC socket：

```text
$TMPDIR/codex-ipc/ipc-$UID.sock
```

可以用环境变量覆盖：

```bash
CODEX_IPC_SOCKET="/path/to/ipc.sock" npm start
```

这个方式不会激活 Codex 窗口，也不会改写剪贴板。发送后，Codex Desktop 主界面和网页都会通过同一个桌面会话流更新；网页仍继续通过本地 JSONL 文件轮询显示真实对话内容。
