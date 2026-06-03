# Codex LAN Companion announcement

## English

I built **Codex LAN Companion**, a small local web service that lets you view and lightly control Codex Desktop from any browser device on the same LAN.

It runs on the Mac where Codex Desktop is installed, then exposes a local web UI for phones, tablets, laptops, e-readers, or any device with a browser.

I made it because I often start a Codex task on my desktop and do not want to stay in front of the Mac just to check progress or approve a permission request.

Current features:

- View Codex conversation list
- Create new conversations
- Sync conversation content in near real time
- Send prompts from the browser
- Interrupt running tasks
- Show thinking / processing state
- Display and handle approval requests
- Reference installed plugins and skills
- QR code sign-in
- Account / plan usage display when available

It is not an official Codex mobile app and does not replace Codex Desktop. It is more like a LAN remote control for desktop Codex.

GitHub:
https://github.com/dreamingboat/codex-lan-companion

Note: this depends on Codex Desktop local files and private IPC behavior, so future Codex updates may require compatibility fixes.

## 中文

我做了一个小工具：**Codex LAN Companion**。

它可以把 Mac 上的 Codex Desktop 变成一个局域网 Web 服务。同一个 Wi-Fi 下，手机、平板、Windows 电脑，甚至电子书设备，只要有浏览器，就能打开网页查看和控制 Codex 对话。

做它的原因很简单：Codex 在桌面上跑任务时，我不想一直坐在电脑前等它。有时候只是想看一眼进度、补一句 prompt、处理中途弹出的权限审批，用手机或 iPad 就够了。

目前支持：

- 查看 Codex 对话列表
- 创建新对话
- 实时同步当前对话内容
- 在网页端继续输入 prompt
- 支持中断当前任务
- 显示 Codex 是否正在思考
- 在网页端查看并处理权限审批
- 引用已安装的插件和技能
- 显示账号、套餐和用量情况
- 支持二维码扫码打开
- 运行在家庭/办公室局域网内，不需要客户端安装 app

它不是官方 Codex 移动端，也不替代 Codex Desktop，更像是给桌面版 Codex 加了一个“局域网遥控器”。

项目地址：
https://github.com/dreamingboat/codex-lan-companion

注意：它依赖 Codex Desktop 的本地文件和私有 IPC 行为，未来 Codex 更新后可能需要适配。
