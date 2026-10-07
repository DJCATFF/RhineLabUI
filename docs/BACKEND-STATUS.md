# APEX 后端第一阶段

更新时间：2026-10-07。开发分支：`feature/backend`，从 `develop` / 原版基线 `17a1611` 开始。此阶段不合并正式网站 main，不迁移前端目录。用户已选择同步到 DJCATFF 自己的 Fork。

Fork：https://github.com/DJCATFF/RhineLabUI 。本地 `origin` 指向该 Fork，`upstream` 保留 `LBEILC/RhineLabUI`。2026-10-07 用户补充授权后，通过 GitHub 连接器成功同步至 `feature/backend`，同步提交 `6cf95c8` 的完整文件树与本地 `7963044` 一致（46 个变更文件）。本地原始实现及验证提交 `8590019`、`8eb33d9`、`7963044` 保留于备份分支 `codex/backend-local-before-fork-sync`；连接器同步产生新的提交编号。正式 main 和上游未修改。


## 已实现

- NestJS API，仅监听 `127.0.0.1:3000`；Swagger：`/api/docs`。
- `GET /api/health`：分别探测 PostgreSQL、Redis、MinIO、Tika；依赖不可用返回 503，不再固定返回成功。
- `POST /api/documents`：multipart `file`，单文件最大 20 MiB，拒绝缺少文件、空文件及多文件/额外字段。保留中文文件名，存储键由服务端随机生成。
- MinIO 私有桶自动初始化；存入原始字节，计算 SHA-256；数据库保存原名、声明的 MIME、大小、存储键和上传状态。声明 MIME 尚不代表真实文件类型检测结果。
- PostgreSQL 初始迁移创建 `documents` 并启用 pgvector 扩展；目前没有向量数据和检索功能。
- 上传后向 BullMQ 的 `documents` 队列投递 `extract-text`，任务 ID 为文档 ID。数据库的 `queuedAt = null` 记录作为持久化待投递列表，每 5 秒重试，API 重启后继续。
- 数据库写入失败会尝试删除本次已存储的原件；清理失败记录对象键供人工处理。存储成功与数据库提交之间的进程崩溃仍可能留下孤立对象，后续需增加定期对账。
- `GET /api/documents` 返回最近 100 条真实数据库记录；尚未实现完整分页。
- Redis 启用 AOF 与 noeviction；Compose 服务端口只绑定本机。

`status: uploaded` 表示原件和元数据保存成功。`queuedAt` 非空仅代表任务入队。Worker、文本抽取、OCR、PDF 转换、鉴权和前端接入均不在本阶段完成范围内。队列任务保留以支持去重，后续 Worker 需要设计清理与数据库对账；Redis 数据卷丢失后的重建也需要单独恢复流程。

## 本地运行

```powershell
# 根目录，首次运行。已有 .env 时保留，不要覆盖。
Copy-Item .env.example .env
# 编辑 .env，将示例密码替换为本机密码，同时保持 DATABASE_URL 一致。
npm --prefix apps/api ci
docker compose up -d --wait --wait-timeout 120
npm --prefix apps/api run prisma:generate
npm --prefix apps/api run prisma:deploy
npm run dev:api
```

另一个终端运行原前端：`npm run dev`。两者目前独立。

Prisma 脚本明确加载仓库根目录 `.env`，避免在 apps/api 下执行时遗漏连接参数。后续变更 schema 使用 `npm --prefix apps/api run prisma:migrate -- --name <名称>`；已有迁移的交接环境使用 `prisma:deploy`，不会重置数据库。

接口调试文件：`requests/documents.http`。API 启动后运行：

```powershell
npm --prefix apps/api test
npm --prefix apps/api run verify
# 仅本地测试环境：会短暂停止并恢复 Redis
npm --prefix apps/api run verify:recovery
```

`verify` 创建一份专用测试文档，验证数据库、MinIO 字节和 BullMQ 任务，然后仅清理本次测试数据。需要四项真实服务与 API 均在运行；不要针对生产地址执行。

## 环境修复记录

Docker CLI/Engine 版本 29.8.0，Docker Desktop 日志报告版本 4.91.0；两者不能混为同一产品版本。Node 实测 24.19.0，npm 11.17.0。

本次 Docker 启动失败由失效 Windows Unix socket 引起。已在 Docker 停止时备份本机 `Docker/run` 和 `docker-secrets-engine` 临时目录，重新创建通信文件后引擎恢复；D 盘虚拟磁盘与已有镜像/数据未重置。备份留在原目录旁，未删除。

MinIO Docker Hub 原地址返回 denied，Compose 改为官方 Quay 固定版本 `RELEASE.2025-09-07T16-13-09Z`。直连不稳定时本机通过已有 DaoCloud 加速通道拉取同一镜像后 retag；正式配置保留上游名称。该旧版仅用于当前本地开发，生产前须重新评估上游维护、安全补丁与替代 S3 存储方案。

## 验证结果

- API 编译、ESLint、Prisma schema 校验和 9 项测试通过。测试包括真实 HTTP multipart 解析（20 MiB 限制、多文件、额外字段）以及使用替身的数据库/队列失败恢复；不能替代真实服务联调。
- 2026-09-18 下载镜像遇到 EOF / short read；2026-09-19 重试已成功，四个容器全部 healthy。PostgreSQL、Redis、Tika 固定为本次验证的镜像摘要；Tika 增加真实 `/version` 健康检查。
- `prisma:deploy` 成功应用 `20260918000100_init`；真实 PostgreSQL 已确认 vector 扩展存在。
- `verify` 完整通过：四依赖健康接口、Swagger、中文文件名与内容、MinIO 原件字节比对、数据库记录、BullMQ extract-text 任务、列表和缺少/空/超限文件拒绝。
- `verify:recovery` 完整通过：停止真实 Redis 后健康接口返回 503，上传仍返回 201 并保留未投递记录；恢复 Redis 后自动入队，健康恢复 200。测试对象、数据库记录和队列任务已清理。首次执行紧接 Tika 重建，因 Tika 尚未就绪导致最终健康断言失败；脚本已增加全依赖就绪前置检查，服务健康后复测通过。
- `npm --prefix apps/api run verify:storage` 对真实 MinIO 创建私有桶、写入中文测试内容并逐字节读回验证通过；本次测试对象已清理，开发桶保留。
- 原前端 `npm run build` 与 18 项 `check:content` 通过。未修改 `src/`；本轮没有重新进行浏览器视觉验收。构建仍有既有大包提示。
- 依赖审计发现原骨架的 Multer 上传解析漏洞，已通过 override 固定为 2.3.0。安装后仍有 7 项传递依赖审计告警（4 moderate、3 high，涉及 MinIO 与 Prisma 工具链）；未使用 force 跨主版本更新。本地 MVP 不等于生产安全验收。

## 下一阶段

实现一个 Worker 消费 `extract-text`，从 MinIO 读取文档并调用 Tika，将文本和处理状态保存至数据库。随后增加失败重试、权限与分页，再接入原三维前端。LibreOffice/OCR/向量模型需要另行确定资源与验收标准。
