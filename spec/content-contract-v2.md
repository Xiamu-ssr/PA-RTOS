# 内容合同 v2（4.4.0，产品协议 8）

运行时定义见 `cloud/src/content-contract.mjs`。发布工具、文件读取和生成到工作区的说明共用这一份定义；API 是文件的投影，不另存内容副本。产品 HTTP/WebSocket 协议为8；旧协议请求返回426、update_required和明确的当前版本升级提示，避免误读新设置或内容契约。OpenClaw原生Gateway协议仍为4。

## 交办

唯一记录为 `data/goals/<name>.md`，已归档完成项可在 `done/`。`completed` 是实际已完成内容的**字符串**，`nextStep` 是下一步或等待条件的**字符串**，都允许空串；是否结束看 `status`。`progress` 仅在有真实量化依据时写 0–100，API 未知时为 `null`。`initiator` 为 `user` 或 `self`；周期 `cadence` 与一次性 `nextWake` 二选一。背景、来源和结束条件放 Markdown 正文，已完成内容与下一步不再抄成第二份计划。

```json
{"name":"示例交办","title":"核对一份资料","status":"进行中","completed":"已核对两处来源。","nextStep":"等第三处来源更新。","progress":null,"body":"背景与依据。"}
```

`GET /api/goals` 和 `/api/goals/item?name=...` 返回同一文件的内容。列表额外提供 `completedSummary/nextStepSummary`，本地按约40个Unicode字符投影并优先保留关键数字；完整原字段与正文保持不变，不发生额外模型调用。新写的 completed/nextStep 本身应简短，完整结果、背景和依据留正文。展示标签用“刚完成”，状态仍是“已完成”。`goals.put` 保存并校验该文件；直接改文件后 `content.publish` 走相同验证。

## 动态与来源评论

唯一记录为 `data/feed/YYYY-MM-DD/HHMM-名称.md`。frontmatter 支持单行 JSON 对象、数组和带引号字符串：

- `excerpt:string`：用户主流语言的忠实原文短摘译，默认简体中文；同语言可直接短引。保留数字、限定与不确定性，未取得原文为空串，不将自己的判断冒充来源。
- `excerptOriginal?:string`：摘译对应的原语节选，原样保存；外文摘译必须同时保存，不把译文伪称原语直接引文。`excerptLanguage?:string` 记录展示语言，如 `zh-Hans`。语言规则由 `contentInstructions()` 单一约定提供，Feed prompt 引用它，不另建翻译服务或额外模型定时任务。
- `image?:string`：已保存的原文配图，相对于帖子日期目录的路径。API 投影为工作区相对路径，用现有鉴权 `/files/` 加载；缺图不制造占位图片。
- `sourceStats?:{views?,likes?,comments?,observedAt,url?}`：阅读、赞、评论数字为实际取得的非负整数，未知字段省略；`observedAt` 是采集 ISO 时间。必须至少有一个真实数值，零只表示来源确实显示为零。旧 dislikes 退出当前合同，原记录先完整备份。
- `comments:[{id,text,author?,source?,url?,published?,likes?}]`：只保存已取得的来源评论，最多 200 条；无评论为 `[]`。外部 id 缺失时读端用内容生成稳定 id。保存非空列表必须有 `commentsFetchedAt` ISO 时间。
- `body:string`：事实说明、补充依据与已明确标注的判断。

`feed.put` 将上述内容写入同一 Markdown 文件并发布。没有第二份评论数据库，也不把用户反馈混成来源热度。旧 `/api/feed/feedback` 已删除。讨论动作叫“聊一聊”，仍回到主聊天。

`GET /api/feed?limit=20&cursor=<上一页末条完整路径>` 按路径倒序返回 `{items,next,errors}`，limit 为1–60，next 为下一次cursor或null。同一天的大量内容也会分页。列表不重复传全部评论，而带 `savedCommentCount`；详情和评论仍读取同份记录。新增动态不会把已加载页的cursor向后移动。

`GET /api/feed/comments?path=<帖子路径>&offset=0&limit=20` 返回：

```json
{"items":[{"id":"example-comment","text":"合成示例评论","author":"示例作者"}],"total":1,"next":null,"fetchedAt":"2026-10-31T04:00:00Z","sourceCount":42}
```

`total` 是实际保存评论数；`sourceCount` 只有原站评论总数确实取得时才有。`next` 是下一页 offset 或 `null`；`limit` 为 1–50。接口只分页现有证据，不隐式抓网。单条详情带 `comments`，列表用 `savedCommentCount`，客户端按需请求评论。

讨论先放进主聊天草稿，发送仍用 `POST /api/send`：

```json
{"text":"我想讨论这一点","quote":{"kind":"feed","path":"data/feed/2026-10-31/1200-example.md","commentId":"example-comment"},"clientId":"example-receipt"}
```

`commentId` 可省略；指定但不存在返回 404。引用来源评论作为外部材料进入主会话，不创建旁聊。旧旁聊创建与活动续聊路由已删除；后台活动仍能读取执行历史和结果。

## 书架

默认只有虚拟日记入口，不预置二十本没有原文的书。找书在主聊天提出，按用户主要语言优先取得有真实正文的版本，优先官方免费版本、公版原著和 EPUB；不以文学空壳凑数量，也不把英文书换成中文标题冒充中文版。书目录保存 `book.json`、不可变 `source.*`、由原文提取的 `text.md`、真实 `cover.*`、`notes.md`、`shared.md`、`reading.md`。书架按实际来源的中文语言优先展示，同组按更新时间和ID稳定排序，不从标题猜语言。

- `sourceAvailable:boolean` 只反映实际存在的原文文件；`extraction=ready` 才有提取正文，PDF 使用 `native-read`，缺失为 `missing`。
- `sourcePath/coverPath` 是实际工作区文件路径或 `null`。`coverUrl` 指向鉴权的 `/api/books/:id/cover`，没有真实封面返回 404；不合成封面冒充原书。
- `sourceUrl` 是原文件下载入口 `/api/books/:id/source`，`textUrl` 是提取正文入口 `/api/books/:id/text`，只有相应内容可用时提供。正文分页响应为 `{id,text,offset,next,total,source}`，`limit` 为 1–30000，章节标题来自正文，不显示 EPUB 技术文件名。PDF 继续读取原文件。
- `notes/shared/reading` 在单书 GET 返回；`notesPath/sharedPath` 给出同份文件，列表有 `hasNotes/hasShared`，不是另一套内容。
- `origin` 保留真实来源地址、下载地址、授权性质与原文语言；`legalUrl` 是合法来源入口。英文原文不会标成中文版。

`books.sources` 搜索独立的合法来源清单，不添加书目。`books.import_free` 只获取清单中明确可获取的实际原文，校验 EPUB/PDF 后才创建书籍；明确允许再编排的开放教材可由固定完整章节清单生成附来源与许可的纯文字EPUB。任何一章缺失则整本不创建；只提供网页入口的版本不能冒充已下载。`books.import_source` 导入用户上传的文件。两者都可补到尚缺原文的已有书目，保留笔记和共同经历；已有原文不替换，避免引用错位。中文新译本作为新版本、新ID导入，旧版笔记、shared引用与各自进度保持原ID，新版从位置0开始。

已核验来源：[作者官网的《纳瓦尔宝典》英文 EPUB](https://www.navalmanack.com/)、[官方简/繁中文翻译入口](https://www.navalmanack.com/translations)、[Meditations](https://www.gutenberg.org/ebooks/2680)、[Walden](https://www.gutenberg.org/ebooks/205)、[On Liberty](https://www.gutenberg.org/ebooks/34901)。后三项是来源标示为美国公版的历史英文版本，并非现代中文译本。官网繁中PDF当前只允许在线查看，下载受限；不绕过限制、不当作已取得原文。清单状态与真实下载验收分开记录。

中文可导入来源包括[《传习录》中文原文](https://www.gutenberg.org/ebooks/25517)、[《道德经》中文原文](https://www.gutenberg.org/ebooks/7337)、[《超普通心理学》开放教材16主章](https://zh.wikibooks.org/zh-hans/超普通心理学)与[联合国《2025年年中世界经济形势与展望》27页中文报告](https://www.un.org/development/desa/dpad/wp-content/uploads/sites/45/WESP-MYU-2025_C.pdf)。前两本是古文原文，不是现代白话译注。心理学一本完整主章文字版遵循CC BY-SA 4.0，附每章原URL、原站版本号与改编说明；不收录外链子页、图片及视频，不能冒充商业教材全译本。联合国报告保留原PDF，仅供个人非商业阅读，不是公版、年度全书或最新预测；遵守[原站条款](https://www.un.org/en/about-us/terms-of-use)，不公开再分发。

### 用户阅读器

`GET /api/books/:id/reader?offset=0&limit=6000` 返回 `{id,title,author,sourceRevision,total,offset,next,text,chapters,paragraphs,readerState}`。limit为2–12000个UTF-16单元，不切开代理对；`chapters:[{id,title,offset}]` 来自实际EPUB spine的标题或Markdown标题，`paragraphs:[{id,offset,text}]` 仅含当前页。offset对齐包含该位置的完整短段落，长段落按限额切分；next为下次offset或null。EPUB解析和章节索引一次生成，原文/提取文本修订后使缓存失效；解析文本缓存有12MiB预算，不在每次翻页解析原文。客户端用纯文本渲染，不注入原始EPUB HTML。原文件响应含sandbox CSP和nosniff。

用户状态 `{revision,sourceRevision,position,fontSize,theme,updatedAt}` 独立保存到 `system/reader-state/<id>.json`，默认为0、20、paper；字号14–36，主题day/paper/night。首次GET offset=0仍返回保存位置，客户端可再请求该position。`PUT /api/books/:id/reader-state` 接收 `{revision,sourceRevision,position,fontSize?,theme?}`，并发修订或原文变化返回409。原文变化时不套用旧位置。它不会更新PA的reading.md/progress，也不触发阅读计划。PDF保留原文件阅读；reader返回409而非伪造文本或页码位置。旧手动触发PA阅读的 `/api/books/:id/read` 已移除。

单本持久化正文上限为12MiB，源文件仍限20MiB、EPUB解压合计40MiB。大书不按存储阈值拆成多个书架条目。只有单书原文使用此额度，普通工作区/记忆/笔记读取仍限4MiB。阅读器首读缓存文本与段落索引（全缓存12MiB预算），列表与书目详情不含原文，HTTP阅读器每页最多12000个UTF-16单元，PA `books.read`最多30000个；搜索仅返回命中短段，不能把整书自动塞入模型上下文。

## 资源库分页

`GET /api/library?kind=all&offset=0&limit=24&revision=<上一页索引修订>` 只返回 `{items,total,next,revision}`，不维护旧artifacts/media并列API。kind可为all/site/document/image/video/audio/file，limit为1–60；过滤后按mtime倒序、path稳定次序分页，next为offset或null。items沿用实际文件与构件字段，缩略图URL含构件资源修订号。

revision来自全库的稳定索引；后续页修订不一致返回409，客户端清空已加载页重读。每次请求校验文件树stat指纹，即使fs.watch事件滞后也不会返回旧索引。ETag同时包含kind/offset/limit与该页数据，不跨页误用304；缩略图和鉴权文件也按各自修订重新验证。客户端只为可见卡片加载缩略图，并限制图片缓存和并发。

## 记忆与人物图谱

`memory/people/<id>.md` 只存人物，必填frontmatter为id/name，固定可选字段gender、birthDate、age、occupation、relationship未知为null；gender为male/female/nonbinary/other，birthDate为有效YYYY-MM-DD，age为0–150整数。可含aliases字符串数组和relations数组`{personId,relationship}`。relationship是与用户的明确关系。正文保留事实依据与历史，绝不从姓名猜属性。

经历写`memory/experiences/<domain>.md`，豆豆判断写`memory/self/**`，概况/索引仍是根目录SOUL.md、USER.md、MEMORY.md。内置领域包括identity/life/timeline/interests和relationships/education/homes/work/intimacy/health/investing/preferences；领域可扩展，不能把混合事实硬改成一个错误标签。

`GET /api/memory` 包含groups（profile/people/experiences/self）和从同份Markdown实时派生的graph。graph为`{revision,nodes,edges}`，以固定user节点为中心；人物节点含完整schema、path、revision。只有明确relationship或relations才派生边`{id,source,target,relationship}`，未记录关系不补猜。没有第二个人物数据库。UI保存布局不保存事实副本，拖动才更新2D投影，另有可访问列表。

`GET /api/memory/people/:id` 返回`{person,body,text,path,revision}`。PATCH接收`{revision,person:<变化字段>,body?}`，PUT接收完整person/body；POST `/api/memory/people` 创建显式人物。修订冲突409；未知字段拒绝，PATCH不清空未改字段。原始`/api/memory/item`仍读写同一文件，PUT/DELETE必须在JSON body带revision，人物Markdown经过相同schema验证。经历域也可读写并进入USER派生索引。

停服后执行`node cloud/scripts/migrate-content-refinement.mjs --root <工作区> --plan <私有计划.json>`。计划为`{version:1,entries:[{from,person:{id,name,...确证字段}}|{from,domain}],archiveIndexes:[<旧索引路径>]}`。先逐字节备份到`imports/content-refinement-v1/`并校验，再移除当前dislikes/旧赞踩记录；保留讨论反馈。显式人物保留原始正文，其他属性未知null；经历整体保留章节。旧README索引归档，由USER索引替代，当前事实链接同步。未知且无映射文件保留原位并报告pending，不能静默丢失；有pending或错误不会写完成marker。迁移幂等可恢复，不维持两套事实源。

## 一次性离线整理与导入

停服后运行 `node cloud/scripts/migrate-content-records.mjs --root <工作区>`。旧交办的明确“已完成/下一步”段落提升到对应字段，其余背景保留；原文件先备份并校验。仅未使用的 `suggested-*` 空书归档，有笔记、共同经历或真实文件的书不删除。旧旁聊数据和活动索引原件归档，真正旁聊记录从当前活动索引移除，其他后台记录不改名。成功 marker 写入后幂等；中断可重试。归档在 `imports/retired-content-v4/`，不再作为 App 数据源。

显式导入：`node cloud/scripts/import-free-books.mjs --root <工作区> --source naval-en`，可重复 `--source`，或用 `--book <id>` 补入已有笔记。所有下载为公开 HTTPS GET，使用固定上游 SSRF guard；若部署环境已有 HTTP(S) 代理则保留目标 DNS 检查和 pinning，不关闭 TLS 或允许任意内网目标。

离线资产导入可加 `--assets <私有清单.json>`；格式为 `{version:1,items:[{url,file,sha256}]}`，file相对清单目录、拒绝越界与符号链接，逐个SHA-256校验后仍走相同EPUB/PDF解析。只从显式清单取固定书源URL，不联网补猜。结果分别返回实际成功、已存在和失败项，单项失败不生成空书或谎称整批成功；已有真实书籍不改动。

已审核动态摘译的一次性整理：`node cloud/scripts/migrate-feed-language.mjs --root <工作区> --plan <私有计划.json>` 默认只预览；停服后加 `--apply` 写入。计划为 `{version:1,items:[{path,revision,excerpt,excerptLanguage:"zh-Hans"}]}`。全量先校验修订和既有原语，原文件逐字节备份到 `imports/feed-language-v1/` 后再修改同一记录；旧excerpt原样存excerptOriginal，来源、统计、评论、正文保留。无原文、冲突或已有另一份原语时拒绝猜测；重复执行幂等，不产生新的翻译模型任务。
