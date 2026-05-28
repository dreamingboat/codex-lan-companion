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

页面底部有输入框，可以把文本发送到当前打开的 Codex 桌面窗口。实现方式是 macOS 剪贴板粘贴并回车，因此需要：

- Codex 桌面应用正在运行
- 当前 Codex 窗口停留在你希望继续对话的线程
- macOS 允许当前运行环境通过 System Events 控制应用

如果发送失败，通常是系统没有授予辅助功能权限，或 Codex 当前窗口没有可输入的对话框焦点。
