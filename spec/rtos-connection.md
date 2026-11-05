# RTOS 连接 Cloud PA · 协议 1

目标是先让希德的掌机与 OpenClaw Cloud PA 完成连续文字对话。当前按一个实验 PA、一份共享主会话设计；多个连接器共用它，不提供多用户私有会话隔离。

## 设备需要保存什么

- Cloud HTTPS 地址：域名或公网 IP＋端口，部署时配置，源码没有生产默认地址。IP 自签证书需配置对应证书信任。
- 自己的设备 token：保存在设备私有配置中，不放固件仓库。
- 尚未确认的消息 ID 与原文：断线后继续查询或重发相同内容、相同 ID。

模型服务 Key、OpenClaw 管理令牌、完整记忆及工具循环均由 Cloud 管理。

Workbench 安装并完成服务器本机验收后，会生成私有 `connection.json`：

```json
{"protocol":1,"baseUrl":"https://203.0.113.10:19870","deviceId":"xide-rtos","deviceToken":"<private-device-token>","caCertificatePem":"<PEM certificate>"}
```

部署初始化时用 32 字节随机数生成设备令牌，保存在服务器私有的 `devices.json`。联调时通过 `connection.json` 私下发给设备开发者。更换设备令牌后，重启服务以加载新凭据，再重新导出连接文件。

希德从这个文件取地址、token 和证书即可；不用安装 OpenClaw，也不需要 SSH 登录服务器。在 ESP-IDF 中用 `esp_http_client` 发 HTTPS / JSON 请求，将公钥证书配置到 `cert_pem`，每次请求加设备 token。硬件首轮先接下面的三个业务接口；录音和低功耗推送待硬件规格确认后再接。

## 当前 HTTP 接口

以下路径属于本项目 cloud 接入层。内部 OpenClaw 使用原生 `POST /v1/chat/completions` 执行完整 Agent 回合，不只是转发一次模型请求。

除 `/health` 外，请求均携带 `Authorization: Bearer <device-token>`。示例域名 `https://pa.example.com` 仅为占位。

### `GET /health`

```json
{"ok":true,"protocol":1}
```

接入服务会等 OpenClaw `/startupz` 报告 `started` 后才开始监听。健康接口不调用付费模型，不能代替真实对话验收。

### `GET /api/config`

```json
{"protocol":1,"deviceId":"xide-rtos","conversation":"shared","input":["text"],"output":["text"],"maxTextBytes":4096,"maxReplyBytes":16384}
```

只返回连接所需的公开能力和大小限制，不返回模型凭据或管理设置。

### `POST /api/messages`

`Content-Type: application/json`，只接受 `id` 和 `text`。`id` 是设备生成的 8–96 位字母、数字、连字符或下划线；建议使用 UUID。`text` 最多 4096 UTF-8 字节。

```json
{"id":"9a1082b8-1820-4d96-9c95-9e5a78a47712","text":"你好，记住本轮口令是蓝色风车。"}
```

返回 HTTP 202，表示已在云端持久保存，尚不代表模型完成：

```json
{"id":"9a1082b8-1820-4d96-9c95-9e5a78a47712","status":"queued"}
```

同设备重发相同 ID、原文，返回原记录，不重复启动 Agent。相同 ID 携带不同原文返回 HTTP 409。

### `GET /api/messages/<id>`

处理中返回 `queued` 或 `running`。完成后返回：

```json
{"id":"9a1082b8-1820-4d96-9c95-9e5a78a47712","status":"done","text":"已记住本轮口令。","truncated":false}
```

回复超过 16384 UTF-8 字节时，按完整字符截取并明确返回 `truncated:true`。设备只需在有待完成的请求时短暂查询；首轮建议间隔 1 秒。当前没有空闲后台轮询或推送订阅。

如果传输失败、执行超时或 Cloud 在处理期间重启，返回 `outcome_unknown`。它表示无法确认执行结果，底层 Agent 可能仍在执行或已经完成；同 ID 不会自动重跑。设备显示“结果待确认”，不要自动生成新 ID 重复交办。SQLite 回执与 OpenClaw 状态应一起保留。

设备 token 只访问对应设备的消息回执；实验 PA 的对话上下文本身是共享的。换设备继续对话会进入同一主会话。Cloud 固定路由，客户端不能指定 Agent、会话、工具或系统提示词。

## 请求限额

接入层按实际 TCP 来源计数，每 10 秒最多接受同一来源的 60 次请求。每台设备一分钟最多提交 12 条新消息。全局最多同时保留 8 条排队或运行中的消息。重复提交已经保存的 ID 时会返回原回执，仍计入来源请求频率。

达到限额时返回 HTTP 429，`Retry-After` 表示至少等待的秒数。掌机等待后用同一 ID 和原文重试，或继续查询该 ID 的结果。一次文字交互只需维护一个待确认的消息 ID。

## 哪些数据现在需要对接

| 数据/能力 | 第一步 |
| --- | --- |
| Cloud 地址、设备身份、协议版本 | 必需 |
| 文字输入、回复、请求状态、重试编号 | 必需 |
| 录音上传、音频编码、ASR、TTS、播放与打断 | 待确认麦克风、喇叭和编码后另接 |
| 主动通知、消息确认、离线补收、低功耗连接 | 后续阶段；尚未实现 |
| 电量、网络状态、固件信息 | 后续按实际用途增加 |
| 文件、图片、摄像头、传感器数据 | 设备具备且有场景时再接 |
| Cloud 反向调用掌机能力 | 未开放；以后明确命令和授权后再接 |
| 模型凭据、记忆存储、工具执行 | Cloud 内部，设备无需复制 |

HTTPS 是当前设备入口；OpenClaw 的原生节点控制走其 Gateway 协议，两者不能仅靠 HTTP 请求自动互换。

## 首轮验收

1. 设备持合法凭据读取配置；错误凭据被拒绝。
2. 发一条中文消息，获得对应回复；多轮能接续上一轮内容。
3. 同一请求断网重发，不重复执行；重连后可查询原结果。
4. Cloud 正常重启后，已完成回执和主会话仍在。执行中断按 `outcome_unknown` 处理。
5. 设备实际内存占用和消息大小在样机上验证；服务器/API 测试不替代这一步。

参考：[OpenClaw HTTP 接口](https://docs.openclaw.ai/gateway/openai-http-api)、[原生设备协议](https://docs.openclaw.ai/gateway/protocol)。原生 Gateway token 具有管理者能力，因此只由 Cloud 接入层持有。
