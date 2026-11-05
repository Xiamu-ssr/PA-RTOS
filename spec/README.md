# 文档入口

- [RTOS 对接约定](rtos-connection.md)：本项目当前实现的接口、状态和首轮验收。
- [部署说明](deployment.md)：与已有服务共存，独立运行本项目。
- [继承的可视化设计](index.html)：原 personal-agent / 豆豆的产品参考，可离线打开。

原有 `app-v*.md`、`spec.yaml`、`openclaw-next.md`、`connectors.md` 和提示词来自 personal-agent `5addcf4`。其中的产品功能、模型目录、版本、验收和发布说明属于原项目，不作为 PA-RTOS 的现状或交付承诺。

运行 `node spec/build.mjs` 可重建原设计参考页。构建只校验参考文档自身，不表示这里已实现参考页列出的连接器或客户端。

PA-RTOS 与 personal-agent 独立维护。OpenClaw 的版本、安全修复和已经使用的通用能力出现变化时，按实际问题评估移植并验收；原产品的界面、客户端、场景和节点实现按本项目需求选取。继承文档保持来源快照，更新参考文档不等于实现功能；当前设备接口以 `rtos-connection.md` 为准。
