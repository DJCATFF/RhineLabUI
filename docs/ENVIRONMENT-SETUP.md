可以。按照我们刚才确定的架构，如果你的目标是让 **Codex 在 VS Code 里直接把整个 APEX 文档/知识管理系统做出来**，我建议先把开发环境一次性配完整。

而且有一个原则：

> **数据库、Redis、MinIO、Tika、LibreOffice 等后端基础设施尽量全部 Docker 化。你的 Windows 主机只安装开发工具，不要把各种服务散装安装到系统里。**

这样以后换电脑、交给别人、部署服务器都会轻松很多。

当前 RhineLabUI 仓库本身使用 `TypeScript + Vite + Three.js`，当前 `package.json` 是 TypeScript 5.9、Vite 7.3、Three.js 0.183；仓库要求 Node.js ≥22.12，并推荐 Node.js 24。所以新项目继续沿这个基础最稳。

# 一、你的电脑必须安装的东西

| 软件             | 建议               | 用途                                | 必须  |
| -------------- | ---------------- | --------------------------------- | --- |
| VS Code        | 最新稳定版            | 主开发IDE                            | ✅   |
| Git            | 最新稳定版            | 版本管理                              | ✅   |
| Node.js        | **24.x**         | 前端 + NestJS 后端                    | ✅   |
| npm            | Node自带           | 项目依赖管理                            | ✅   |
| Docker Desktop | 最新稳定版            | PostgreSQL / Redis / MinIO / Tika | ✅   |
| WSL2           | Ubuntu 24.04 LTS | Windows开发环境增强                     | ⭐推荐 |
| Chrome / Edge  | 最新版              | Three.js调试                        | ✅   |
| GitHub账号       | 已有               | Codex/Git版本管理                     | ✅   |

如果是你的 Windows 电脑，我会推荐：

```text
Windows 11
   │
   ├─ VS Code
   ├─ Git
   ├─ Node.js 24
   ├─ Docker Desktop
   └─ WSL2 Ubuntu
```

不要在 Windows 里单独装：

```text
PostgreSQL
Redis
MinIO
Tika
```

全部交给 Docker。

---

# 二、Node.js

当前项目已经明确适配 Node 24，所以直接用：

```text
Node.js 24.x
```

安装后检查：

```bash
node -v
```

应该类似：

```text
v24.x.x
```

再检查：

```bash
npm -v
```

然后当前 RhineLabUI：

```bash
npm ci
npm run dev
```

应该先能正常运行。

这一点非常重要：

> **在开始改项目以前，必须确保原版 RhineLabUI 可以完整运行。**

否则后面出了问题，很难判断是环境问题还是 Codex 改坏了。

---

# 三、建议安装 Node 版本管理器

虽然不是必须，但强烈推荐。

Windows可以选：

### fnm

我比 `nvm-windows` 更推荐这个。

以后：

```bash
fnm install 24
fnm use 24
```

项目根目录可以增加：

```text
.node-version
```

内容：

```text
24
```

这样以后团队机器统一。

---

# 四、Git

安装 Git 后：

```bash
git --version
```

配置：

```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

然后建议项目一定使用：

```text
main
develop
feature/*
```

类似：

```text
main
│
└── develop
    ├── feature/backend
    ├── feature/document-upload
    ├── feature/search
    └── feature/workspace
```

Codex不要直接一直往 `main` 写。

---

# 五、Docker Desktop

这是整个系统后端环境的关键。

安装：

**Docker Desktop**

并打开：

```text
Use WSL 2 based engine
```

检查：

```bash
docker --version
```

以及：

```bash
docker compose version
```

都正常以后就够了。

后面我们的开发环境会类似：

```text
Docker
│
├─ PostgreSQL
│   └─ pgvector
│
├─ Redis
│
├─ MinIO
│
├─ Apache Tika
│
└─ Worker相关依赖
```

所以你不用单独折腾数据库。

---

# 六、WSL2

Windows下我建议安装。

管理员 PowerShell：

```powershell
wsl --install
```

推荐：

```text
Ubuntu 24.04 LTS
```

以后你实际上有两套开发方式：

```text
Windows VS Code
       │
       ▼
WSL Ubuntu
       │
       ├─ Git
       ├─ Node
       ├─ npm
       └─ Docker
```

VS Code可以直接：

```text
Open Folder in WSL
```

这种开发方式对：

* Node
* Docker
* Shell脚本
* Codex
* CI/CD

通常都比纯 Windows 环境省事。

不过第一阶段不是强制。

---

# 七、VS Code扩展清单

这一块我建议你直接全部装。

### 核心开发

```text
ESLint
Prettier - Code formatter
EditorConfig for VS Code
GitLens
```

### TypeScript / Node

VS Code自带 TypeScript 支持，不需要再装很多插件。

可以再加：

```text
npm Intellisense
Path Intellisense
```

### Docker

```text
Docker
```

或者微软现在对应的容器工具扩展。

主要方便查看：

```text
containers
images
logs
volumes
```

---

### Prisma

必须：

```text
Prisma
```

以后：

```prisma
model Document {
   ...
}
```

会有：

* 高亮
* 自动补全
* 格式化
* 错误检查

---

### PostgreSQL

推荐安装一个数据库浏览器。

例如：

```text
PostgreSQL
```

或者：

```text
SQLTools
SQLTools PostgreSQL Driver
```

这样直接在 VS Code 看数据库。

---

### REST API

建议：

```text
REST Client
```

这样项目里可以写：

```text
requests/
├─ auth.http
├─ documents.http
├─ search.http
└─ users.http
```

然后直接：

```http
GET http://localhost:3000/api/documents
```

点击执行。

非常方便。

---

# 八、我建议安装的 VS Code 扩展最终清单

你可以照这个装：

```text
1. ESLint
2. Prettier
3. EditorConfig
4. GitLens
5. Docker
6. Prisma
7. REST Client
8. Path Intellisense
9. npm Intellisense
10. SQLTools
11. SQLTools PostgreSQL Driver
12. Error Lens
13. Todo Tree
```

其中：

### Error Lens

我比较推荐。

代码错误直接显示在行尾。

Codex写代码时你很容易发现问题。

---

# 九、VS Code工作区设置

项目根目录建议创建：

```text
.vscode/
```

包含：

```text
settings.json
extensions.json
launch.json
tasks.json
```

---

## settings.json

建议类似：

```json
{
  "editor.formatOnSave": true,

  "editor.defaultFormatter": "esbenp.prettier-vscode",

  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },

  "typescript.preferences.importModuleSpecifier": "relative",

  "files.exclude": {
    "**/.git": true,
    "**/node_modules": true,
    "**/dist": true
  },

  "search.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/.cache": true
  },

  "editor.rulers": [
    100
  ]
}
```

---

# 十、项目格式规范

项目根目录建立：

```text
.editorconfig
```

例如：

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false
```

这样：

Windows / Linux / Codex

不会因为：

```text
CRLF
LF
```

天天产生无意义 diff。

---

# 十一、Prettier

当前 RhineLabUI已经有：

```text
Prettier 3.9
```

保留。

建立：

```text
.prettierrc
```

例如：

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

这里建议不要让 Codex随意重新格式化整个老项目。

否则一次 commit：

```text
300 files changed
```

但其实什么都没改。

非常烦。

---

# 十二、ESLint

新后端需要加。

未来：

```text
eslint.config.js
```

负责：

```text
TypeScript
NestJS
Node
```

但是旧 Three.js 前端先不要为了 ESLint 做大规模重构。

原则仍然是：

> 新代码遵守规范，旧代码逐步迁移。

---

# 十三、数据库

我们最终用：

```text
PostgreSQL
+
pgvector
```

但你不用安装 PostgreSQL。

Docker Compose以后启动：

```text
postgres
```

开发连接例如：

```text
localhost:5432
```

数据库：

```text
apex
```

用户：

```text
apex
```

密码由：

```text
.env
```

控制。

---

# 十四、Redis

同样不要本地装。

Docker：

```text
redis
```

主要用于：

```text
BullMQ

上传处理任务
文档转换任务
AI任务
索引任务
OCR任务
```

---

# 十五、MinIO

MinIO相当于我们自己的：

```text
S3
```

用于保存：

```text
原始PDF
DOCX
PPTX
XLSX
图片
生成的PDF
缩略图
```

而不是把文件直接塞进 PostgreSQL。

后期服务器迁移到：

```text
AWS S3
阿里OSS
腾讯COS
```

也容易。

---

# 十六、Apache Tika

负责：

> 文档文本抽取

例如：

```text
PDF
Word
PPT
Excel
TXT
```

文件上传后：

```text
文件
 ↓
Tika
 ↓
纯文本
 ↓
PostgreSQL
 ↓
全文搜索
```

仍然用 Docker。

不需要你本地安装 Java。

---

# 十七、LibreOffice

负责：

```text
DOCX → PDF
PPTX → PDF
XLSX → PDF
```

用于网页预览。

仍然放：

```text
worker Docker image
```

不要在你的 Windows 环境做依赖。

---

# 十八、推荐本地端口规划

提前统一，非常重要。

我建议：

| 服务            |   端口 |
| ------------- | ---: |
| Vite frontend | 5173 |
| NestJS API    | 3000 |
| PostgreSQL    | 5432 |
| Redis         | 6379 |
| MinIO API     | 9000 |
| MinIO Console | 9001 |
| Tika          | 9998 |

于是：

```text
http://localhost:5173
```

前端。

```text
http://localhost:3000
```

API。

```text
http://localhost:3000/api/docs
```

Swagger。

```text
http://localhost:9001
```

MinIO管理。

---

# 十九、环境变量

项目根目录以后需要：

```text
.env
```

同时必须提交：

```text
.env.example
```

但：

### `.env`

永远不能上传 GitHub。

示例：

```dotenv
NODE_ENV=development

APP_URL=http://localhost:5173
API_URL=http://localhost:3000

DATABASE_URL=postgresql://apex:password@localhost:5432/apex

REDIS_URL=redis://localhost:6379

MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=apex
MINIO_SECRET_KEY=change-me
MINIO_BUCKET=apex-documents

JWT_SECRET=change-this-secret

TIKA_URL=http://localhost:9998
```

---

# 二十、`.gitignore`

至少：

```gitignore
node_modules
dist

.env
.env.local

uploads
storage

coverage

.vscode/*.local.json

.DS_Store
Thumbs.db
```

---

# 二十一、后端CLI

这里有一个很重要的建议：

### 不要全局安装大量 npm CLI。

例如不建议：

```bash
npm install -g prisma
npm install -g nest
```

统一用：

```bash
npx prisma
```

或者：

```bash
npm run
```

这样 Codex、你的电脑和 CI 都用同一个版本。

---

# 二十二、未来项目目录

我建议 Codex最后整理成：

```text
APEX/
│
├─ apps/
│   │
│   ├─ web/
│   │   └─ 原 RhineLabUI
│   │
│   ├─ api/
│   │   └─ NestJS
│   │
│   └─ worker/
│
├─ packages/
│   │
│   ├─ shared/
│   ├─ types/
│   └─ config/
│
├─ docker/
│
├─ docs/
│   ├─ architecture/
│   ├─ api/
│   └─ decisions/
│
├─ scripts/
│
├─ docker-compose.yml
│
├─ .env.example
│
├─ package.json
│
└─ README.md
```

不过：

**不要第一天就迁这个 Monorepo。**

先让原项目跑起来。

然后再逐步迁移。

---

# 二十三、浏览器开发环境

Three.js项目一定要打开：

```text
Chrome DevTools
```

尤其：

```text
Console

Network

Performance

Memory
```

以后我们会重点检查：

```text
FPS

GPU Memory

Draw Calls

Three.js Objects

API Time
```

因为文档量大以后最怕3D页面越来越卡。

---

# 二十四、电脑配置建议

这个项目本身不需要特别夸张。

### 最低

```text
CPU：4核
RAM：16 GB
SSD：50 GB+
GPU：支持 WebGL2
```

### 推荐

```text
CPU：8核+
RAM：32 GB
SSD：1 TB
独显：有更好
```

因为同时跑：

```text
VS Code
Chrome
Node
Docker
PostgreSQL
Redis
MinIO
Tika
Worker
```

16G会开始比较紧。

我更推荐：

> **32GB 内存。**

---

# 二十五、你最终应该能够执行这些命令

环境装好以后，最少应该全部通过：

```bash
git --version
```

```bash
node -v
```

```bash
npm -v
```

```bash
docker --version
```

```bash
docker compose version
```

然后原项目：

```bash
git clone https://github.com/LBEILC/RhineLabUI.git
```

```bash
cd RhineLabUI
```

```bash
npm ci
```

```bash
npm run dev
```

浏览器打开：

```text
http://127.0.0.1:5173
```

如果原版能完整进入：

```text
开场
↓
3D档案阵列
↓
ACCESS FILE
↓
解密
↓
360° Viewer
```

那么：

### 环境阶段通过。

---

# 二十六、然后我们新增系统后，你最终应该只需要两个命令

开发：

```bash
docker compose up -d
npm run dev
```

最终理想状态：

```text
Docker启动：
Postgres
Redis
MinIO
Tika

npm启动：
Web
API
Worker
```

甚至后期可以统一成：

```bash
npm run dev:all
```

---

# 二十七、我给你的实际安装顺序

按这个顺序装，基本不会乱：

1. **VS Code**
2. **Git**
3. **Node.js 24**
4. **fnm**
5. **Docker Desktop**
6. **WSL2 + Ubuntu 24.04**
7. **VS Code扩展**
8. Clone RhineLabUI
9. `npm ci`
10. `npm run dev`
11. 确认原项目运行正常
12. 创建自己的 Git 分支 / Fork
13. 再交给 Codex开始 APEX 改造

其中 **第11步非常重要**。

在 Codex接手以前，建议你先做一个 Git tag：

```bash
git tag rhinelab-original-baseline
```

这样以后哪怕整个项目被改烂了：

```text
原版永远还在那里。
```

---

## 你这套开发环境可以简单理解成

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

把这一层搭好以后，你基本就拥有了一套很标准的**现代全栈 + AI文档系统开发环境**。

下一步最合适的不是让 Codex马上写业务，而是先让它在仓库里生成 **`docs/ARCHITECTURE.md + docker-compose.yml + .env.example + 后端骨架`**，先把整个工程骨架搭起来，再开始碰现有 Three.js 前端。
