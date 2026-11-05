# Cloud 部署

目标是与博物服务共用第二台 ECS。此文不含真实 IP、账号或凭据。

## 独立运行

- 源码：`/opt/pa-rtos`。
- 本项目专用 Node `26.12.1`：`/opt/pa-rtos-node/bin/node`，不替换服务器全局 Node。
- 私有持久化：`/var/lib/pa-rtos`，包含模型配置、设备凭据、消息回执和 OpenClaw 工作区。
- 独立低权限账号：`pa-rtos`。
- 独立 unit：`pa-rtos.service`。
- 设备 HTTP：默认 `127.0.0.1:19870`；内部 Gateway：`127.0.0.1:19871`。

先只读检查操作系统、CPU/内存/磁盘余量、现有服务和端口，再确定端口及资源限额。无需停止、升级、迁移博物进程；不改其文件、数据、反向代理或系统级运行时。

示例 unit 在 `cloud/deploy/pa-rtos.service`，对本项目设置独立 CPU、内存限额。`ProtectSystem=strict`、`ProtectHome=true`、`PrivateTmp=true` 将正常文件写入限制在本项目私有目录和临时目录。若宿主已有同名目录或账号，先核对，不能直接复用或覆盖。

## 在 Workbench 部署，无需公网 SSH

在已经登录第二台实例的 Workbench Shell 中执行。以下均为示例地址，替换成实际服务器 IP、模型地址和模型 ID：

```sh
git clone --depth 1 https://github.com/Xiamu-ssr/PA-RTOS.git /opt/pa-rtos
bash /opt/pa-rtos/cloud/deploy/install.sh \
  203.0.113.10 https://models.example.com/v1 your-model-id openai-completions
```

脚本适用于 Linux x86_64 / systemd 主机。先检查专用路径、账号、端口及资源余量；存在冲突就停止。随后下载并校验固定版本 Node，安装依赖、运行测试、生成 IP 证书，最后创建并启动独立 PA 服务。不会安装系统软件包、替换全局 Node、修改 SSH、nginx、防火墙或 ECS 安全组。

服务器访问 GitHub 失败时，可从能联网的开发电脑打包源码，通过 Workbench 文件管理上传，不需要开放 SSH。Node 安装包也可一起上传：设置 `PA_NODE_ARCHIVE` 为 `node-v26.12.1-linux-x64.tar.xz` 的绝对路径即可复用本地包，仍会核对同一官方 SHA-256。此方式只免去源码和 Node 的在线下载；`npm ci` 仍需访问锁文件中的 npm 下载地址。

出现 `Model API key (hidden input)` 时粘贴模型 Key 并回车，终端不会回显。Key 经标准输入写入服务器私有配置，不进入命令行参数或 Git。该脚本面向全新安装；中途失败后先检查已完成步骤，不要覆盖目录强行重装。

如果源码、独立 Node、npm 依赖和私有目录已经就位，而 `systemctl show pa-rtos.service -p LoadState` 仍为 `not-found`，更新源码后可用同样的四个参数执行 `bash /opt/pa-rtos/cloud/deploy/activate.sh ...`，从注册服务前继续。此步骤验证服务账号能读取 OpenClaw，运行测试，配置模型与证书，再启动服务和验收；保留已有设备凭据及工作区。已注册服务时会停止，应检查服务状态和日志。不要重新执行初始化。

安装末尾会用真正的 OpenClaw 回合验证本机 HTTPS、设备认证和模型回复；通过后生成 `/var/lib/pa-rtos/connection.json`。通过 Workbench 文件管理下载此文件交给设备开发者；它仅包含 PA 地址、设备 token 和公钥证书，不含模型 Key 或 Gateway 管理令牌。文件包含设备凭据，应私下交付。

若设备通过公网接入，还需要单独放行 **PA 的 TCP 19870**（或实际配置端口）；公网 SSH 22 与内部 Gateway 19871 均无需放行。成功生成连接文件只代表服务器本机验收通过，公网及样机还需实际测试。

## 初始化与模型

在独立账号下安装锁定依赖，使用私有空目录执行初始化：

手动初始化应在首次安装依赖之前进行，避免 npm 缓存提前占用私有空目录。

```sh
cd /opt/pa-rtos/cloud
/opt/pa-rtos-node/bin/node src/init.mjs --root /var/lib/pa-rtos
PATH=/opt/pa-rtos-node/bin:$PATH npm ci
```

编辑 `/var/lib/pa-rtos/private.env`：

| 字段 | 含义 |
| --- | --- |
| `PA_MODEL_PROVIDER` | 自定义服务标识，例如 `custom` |
| `PA_MODEL_API` | `openai-completions`、`openai-responses`、`anthropic-messages` 或 `google-generative-ai` |
| `PA_MODEL_BASE_URL` | 实际模型服务地址，按该协议填写 |
| `PA_MODEL_ID` | 服务支持的模型 ID |
| `PA_MODEL_API_KEY` | 仅云端持有的服务密钥 |
| `PA_MODEL_CONTEXT_WINDOW` | 按所选模型实际容量设置；默认保守值 32000 |
| `PA_MODEL_MAX_TOKENS` | 首轮短回复上限；默认 2048 |

支持部署配置不表示所有模型已经实测。首轮为纯文字，无图片输入、语音或媒体模型承诺。使用 ZenMux 时也按相同接口配置；代码没有对其账号或域名的必需依赖。

启动命令：

```sh
/opt/pa-rtos-node/bin/node --env-file=/var/lib/pa-rtos/private.env /opt/pa-rtos/cloud/src/main.mjs
```

systemd 通过 `EnvironmentFile` 读取同一份配置，不需要在命令行粘贴 Key。首次生成的 OpenClaw 配置仅含密钥环境变量引用，仍保存在私有目录中。

## 网络入口

一台有公网 IP 的服务器即可。初始服务只监听本机，先验证健康接口、配置、真实模型回复、多轮和重试，再让设备连接。

不要求域名。接入服务本身支持独立 HTTPS 端口：配置 `PA_TLS_CERT`、`PA_TLS_KEY` 的绝对私有路径，并设置 `PA_HOST=0.0.0.0`。无证书时只允许监听本机。端口需在宿主防火墙和 ECS 安全组放行；不改现有博物反向代理，内部 Gateway 的 19871 端口始终不对公网开放。

样机阶段可使用带公网 IP SAN 的自签证书，给 Mac 与 RTOS 显式配置证书信任。例如在私有目录下生成证书（以下 IP 为文档保留地址，需替换）：

```sh
umask 077
PA_SERVER_IP=203.0.113.10
openssl req -x509 -newkey rsa:2048 -sha256 -days 90 -nodes \
  -subj "/CN=$PA_SERVER_IP" -addext "subjectAltName=IP:$PA_SERVER_IP" \
  -keyout /var/lib/pa-rtos/server.key -out /var/lib/pa-rtos/server.pem
```

私钥仅留服务器；公钥证书通过可信方式交给开发者。Mac 可用 `curl --cacert /private/path/server.pem https://<公网IP>:19870/health` 验证，RTOS 在 ESP HTTP Client 的 `cert_pem` 中配置证书并校验 IP。不要关闭证书验证。证书到期前需更新；有域名或受信任 IP 证书时可直接替换这两个配置文件。

RTOS 只获取自己的 device token。模型 Key 和 Gateway token 均不发送到设备。当前没有远程配对管理界面；设备新增与凭据配置由部署者在私有 `devices.json` 中维护。

## 验证与重启

`npm test` 使用合成模型响应，验证设备认证、重试去重、消息归属、重启恢复、UTF-8 边界及自定义模型配置，不消耗真实模型额度。实际 OpenClaw 启动和真实模型推理另外验收。

完整保留 `/var/lib/pa-rtos` 才能恢复回执、对话及工作区。重启只针对 `pa-rtos.service`。Cloud 处理中断会标记结果待确认，不自动重放可能带来副作用的操作。
