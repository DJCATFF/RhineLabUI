# APEX 后续开发交接

当前阶段、已实现接口、运行命令、验证证据与限制以 [BACKEND-STATUS.md](BACKEND-STATUS.md) 为准。

当前开发分支为 `feature/backend`，`develop` 从原版基线创建。APEX 尚未合并正式网站 `main`，不直接推送主分支。

2026-09-19 已完成四项真实服务、数据库迁移、完整上传入队和 Redis 故障恢复验证。用户选择将代码同步到 DJCATFF 的 Fork；原 LBEILC 仓库仅作为上游。当前本机 Git 登录尚未完成，不能把本地提交说成已经同步远程。

## 继续开发前

1. 阅读 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/BACKEND-STATUS.md`。
2. 保留已存在的 `.env`；只有缺失时才从 `.env.example` 创建，并替换示例密码。
3. 检查 Docker 引擎和四项服务，不能仅以 Docker CLI 版本判断环境就绪。
4. 使用 `npm --prefix apps/api run prisma:deploy` 应用已提交迁移；不要重置已有数据库。
5. 启动 API，运行 `npm --prefix apps/api run verify`；此命令只针对本机开发环境。

## 下一项业务工作

增加 Worker 消费 `extract-text`，读取 MinIO 原件、调用 Tika、保存文本及处理结果。覆盖失败重试、重复投递和进程重启。随后再设计鉴权、分页、检索与前端接入。

## 约束

- 不对现有 Three.js 前端大规模重构、格式化或迁移目录。
- 不把上传入队说成已完成文本抽取。
- 新变量同步 `.env.example`，真实 `.env` 不进入 Git。
- 40 份原档案 TXT 的换行差异不属于 APEX 功能，提交时精确选择文件。
- 发布到生产前另行完成权限、文件处理隔离、依赖审计、存储维护及部署设计。
