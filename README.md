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

页面底部有输入框，可以把文本发送到当前选中的 Codex 对话。第三版使用 Codex app-server 的 JSON-RPC 接口提交 `turn/start`，不会激活 Codex 窗口，也不会改写剪贴板。

默认 Codex 二进制路径：

```text
/Applications/Codex.app/Contents/Resources/codex
```

可以用环境变量覆盖：

```bash
CODEX_BIN="/path/to/codex" npm start
```

发送后，网页继续通过本地 JSONL 文件轮询显示真实对话内容。
