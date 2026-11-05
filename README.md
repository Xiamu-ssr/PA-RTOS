# PA-RTOS

先让 RTOS 掌机连上一个 Cloud PA。Cloud 使用固定版本 OpenClaw，掌机作为连接器；后续产品形态待探索。

```text
RTOS 掌机 ── HTTPS / JSON ── cloud 接入服务 ── 本机 HTTP ── OpenClaw
                          设备凭据、消息回执              会话、工具、记忆
```

- `cloud/`：可运行的最小接入服务、部署配置和测试。对话模型支持部署时自定义，未绑定 ZenMux。
- `RTOS/`：仅 `.gitkeep`，留给希德开发固件。
- `spec/`：文档。先读 [RTOS 对接约定](spec/rtos-connection.md) 与 [部署说明](spec/deployment.md)。

当前版本只接文字：提交、查结果、断线重试、持续会话。尚未接音频、主动通知、文件上传或反向操作掌机。源码交付不代表已经部署，更不代表实物联调通过。

## 本机启动

Node 固定使用 `26.12.1`，OpenClaw 固定 `2026.10.9`。

```sh
cd cloud
npm ci
npm test
npm run init -- --root /absolute/path/outside-checkout/pa-rtos-private
```

修改生成的私有 `private.env`，填写模型服务地址、模型 ID、协议和 Key。设备 token 位于同一私有目录的 `devices.json`；初始化不会在终端打印密钥。然后启动：

```sh
node --env-file=/absolute/path/outside-checkout/pa-rtos-private/private.env src/main.mjs
```

默认设备接口在 `127.0.0.1:19870`，内部 OpenClaw 在 `127.0.0.1:19871`。远程设备可直接通过「公网 IP＋独立 HTTPS 端口」连接，不要求域名或改动现有 nginx。设置 `PA_TLS_CERT`、`PA_TLS_KEY` 后可将 `PA_HOST` 改为 `0.0.0.0`；设备需信任对应证书。不能直接暴露内部 Gateway。

服务器也可直接在已登录的 Workbench Shell 中运行 [安装脚本](cloud/deploy/install.sh)，无需公网 SSH。安装后自动验收并生成给设备使用的私有 `connection.json`，步骤见 [部署说明](spec/deployment.md#在-workbench-部署无需公网-ssh)。

## 验证记录

2026-11-04，在隔离的 Mac 工作区通过 8 项自动测试，并使用真实自定义模型服务完成 OpenClaw 启动、中文对话、文件工具调用、多轮接续、消息重试去重、重启后回执与会话恢复。另已验证 IP SAN 证书的 HTTPS 接入：显式信任后成功，未信任时拒绝连接。

2026-11-05，根据部署者返回的 Linux 服务器终端记录，提交 `5e633f4` 完成独立服务安装：服务账号能加载 OpenClaw，8 项测试通过，服务器本机 HTTPS、设备鉴权与真实 OpenClaw 模型回复均通过，并生成私有设备连接文件。公网接入和 RTOS 样机仍待验收。

## 来源与边界

`spec/` 的 19 个初始文件来自作者自己的 private `personal-agent`，基准提交 `5addcf4`。原有豆豆界面、阅读、媒体和连接器设计保留作参考，**不是 PA-RTOS 已实现的功能**。`spec/build.mjs` 已去除对原产品 cloud 连接器目录的依赖，其余初始文件保持复制时内容。

未复制个人运行数据、Git 历史、验收截图或安装包。原 private 仓库保持原状。

项目采用 MIT License；OpenClaw 及其他依赖保留各自许可证。
