# APEX 架构文档

> APEX 是基于 RhineLabUI（TypeScript + Vite + Three.js）演进的文档/知识管理系统。
> 本文档是全栈架构的唯一事实来源，重大架构决策同步记录于 `docs/decisions/`。

## 一、核心原则

**所有后端基础设施全部 Docker 化。Windows 主机只安装开发工具（VS Code / Git / Node.js / Docker Desktop），不把 PostgreSQL、Redis、MinIO、Tika、LibreOffice 散装安装到系统里。**

Docker Compose 用于本地开发基础设施。首次运行还需安装 API 依赖、配置环境变量、应用数据库迁移并单独启动 API。生产部署尚未设计，不能直接沿用开发配置。

## 二、系统总览

```text
                VS CODE
                   │
           ┌───────┴────────┐
           │                │
        CODEX             GIT
           │                │
           └───────┬────────┘
                   │
               NODE 24
                   │
          ┌────────┴────────┐
          │                 │
      RhineLabUI          NestJS
      Vite/Three.js         API
          │                 │
          └────────┬────────┘
                   │
                DOCKER
                   │
      ┌────────────┼─────────────┐
      │            │             │
 PostgreSQL      Redis         MinIO
 + pgvector      Queue         Files
      │
     Tika / LibreOffice
```

## 三、组件清单

| 组件 | 技术 | 运行方式 | 职责 |
| --- | --- | --- | --- |
| Web 前端 | Vite 7 + TypeScript 5.9 + Three.js 0.183 | `npm run dev` | 3D 档案阵列 / 360° Viewer / 文档工作台 |
| API 服务 | NestJS（Node 24） | `npm run start:dev`（apps/api） | REST API / 鉴权 / 业务编排 |
| Worker | Node 24 + BullMQ；当前纯文本抽取，不含 LibreOffice | 开发：`npm --prefix apps/api run start:worker`；Docker 发行待实现 | 已实现 Tika 文本抽取；转换、OCR、索引为后续工作 |
| 数据库 | PostgreSQL 16 + pgvector | Docker | 业务数据 + 全文搜索 + 向量检索 |
| 队列 | Redis 7 | Docker | BullMQ 任务队列 |
| 对象存储 | MinIO | Docker | 原始文件 / 生成的 PDF / 缩略图 |
| 文本抽取 | Apache Tika | Docker | PDF/Word/PPT/Excel/TXT → 纯文本 |

## 四、文档处理流水线

```text
上传文件
   │
   ▼
MinIO（原始文件持久化）
   │
   ▼
BullMQ 任务（Redis）
   │
   ├─► Tika 文本抽取 ──► PostgreSQL 全文索引 / pgvector 向量索引
   │
   └─► LibreOffice 转换 ──► DOCX/PPTX/XLSX → PDF ──► MinIO（网页预览）
```

文件一律进 MinIO，**不直接塞进 PostgreSQL**。后期可平迁 AWS S3 / 阿里 OSS / 腾讯 COS。

## 五、端口规划（本地统一约定）

| 服务 | 端口 |
| --- | ---: |
| Vite frontend | 5173 |
| NestJS API | 3000 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| MinIO API | 9000 |
| MinIO Console | 9001 |
| Tika | 9998 |

常用入口：

- 前端：http://localhost:5173
- API：http://localhost:3000
- Swagger：http://localhost:3000/api/docs
- MinIO 控制台：http://localhost:9001

## 六、目标目录结构（Monorepo，逐步迁移）

```text
APEX/
├─ apps/
│   ├─ web/        # 原 RhineLabUI
│   ├─ api/        # NestJS
│   └─ worker/
├─ packages/
│   ├─ shared/
│   ├─ types/
│   └─ config/
├─ docker/
├─ docs/
│   ├─ architecture/
│   ├─ api/
│   └─ decisions/
├─ scripts/
├─ docker-compose.yml
├─ .env.example
├─ package.json
└─ README.md
```

> **不要第一天就迁 Monorepo。** 先保证原项目完整运行，后端骨架先行，再逐步迁移。

## 七、Git 分支模型

```text
main
│
└── develop
    ├── feature/backend
    ├── feature/document-upload
    ├── feature/search
    └── feature/workspace
```

Codex 不直接往 `main` 写。原版基线 tag：`rhinelab-original-baseline`。

## 八、环境变量

见 `.env.example`。规则：

- `.env` 永不提交；`.env.example` 必须随仓库更新。
- 数据库 / MinIO / JWT 密码一律由 `.env` 控制。

## 九、开发命令

```bash
# 首次
cp .env.example .env

# 启动基础设施与前端
docker compose up -d
npm run dev

# 另一个终端：API（首次先安装 apps/api 依赖并应用迁移）
npm run dev:api
```

后期统一为 `npm run dev:all`。当前详细运行步骤、真实环境阻碍与测试范围见 [后端状态](BACKEND-STATUS.md)。

## 十、工程规范

- CLI 不全局安装：统一 `npx prisma` / `npm run`，Codex、本机、CI 版本一致。
- 新代码遵守 ESLint/Prettier 规范；旧 Three.js 前端**不做大规模格式化重构**，逐步迁移。
- 行尾统一 LF（`.editorconfig`），避免 Windows/Linux/Codex 之间的无意义 diff。

## 十一、性能关注点（Three.js 侧）

文档量大以后最怕 3D 页面变卡，Chrome DevTools 重点监控：

- FPS / GPU Memory / Draw Calls / Three.js Objects / API Time

## 十二、实施阶段

1. **环境阶段**：开发工具与基线 tag 已存在；原版完整交互验收与 HTTP 200 检查应区分。
2. **骨架阶段**：已创建本架构文档、Compose、环境变量示例和 NestJS API。
3. **后端第一阶段（当前）**：数据库迁移、原文件上传、元数据与持久化待投递记录、BullMQ 入队、依赖健康检查。实际验证结果见 `docs/BACKEND-STATUS.md`。
4. **后续后端阶段**：鉴权、Worker 消费、Tika 抽取、转换、全文和向量检索；尚未实现。
5. **整合阶段**：前端接入 API，逐步迁移 Monorepo

当前 API 仅绑定本机，所有容器端口仅映射至 127.0.0.1。原网站保持独立静态应用，根目录 `npm run dev` 不隐式启动 API。Document 状态 `uploaded` 表示原文件与元数据已保存，`queuedAt` 非空表示处理任务已投递，不表示文本已经抽取。
