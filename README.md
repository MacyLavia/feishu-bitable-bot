# feishu-bitable-bot

飞书多维表格 × AI 模型能力自动化测试框架。通过飞书群机器人触发测试，结果写入多维表格，支持文本、图像、视频多类型模型，内置 AI 自动评分。

---

## 架构概览

```
飞书群机器人 (bot-server.js)
    │
    ├─ 跑测试 ──► run-model-text-test.js  文本模型 via Dify
    │            run-media-test.js        图像/视频模型 via Dify
    │
    ├─ 评分   ──► ai-scoring.js           AI 自动评分（对比参考标准）
    │
    └─ 补全用例 ► patch-cases.js          AI 补全用例库空字段

models.config.js  ← 单一数据源（模型 + 能力类型注册表）
```

测试结果写入飞书多维表格，分两张表：
- **模型测试用例库** — 维护 Prompt 和参考标准
- **模型测试记录** — 存储每次测试输出、响应时长、AI 评分

---

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Node.js 18+，零框架，全部使用内置 `https`/`http` 模块 |
| 飞书机器人 | `@larksuiteoapi/node-sdk` WebSocket 长连接 |
| AI 推理 | [Dify](https://dify.ai) 工作流（文本生成 / 图像生成 / 视频生成） |
| 备用直连 | SiliconFlow API（`--siliconflow` 参数切换） |
| 数据存储 | 飞书多维表格（Bitable）REST API |
| 媒体存储 | 飞书附件字段（file_token），不依赖外链 CDN |

---

## 文件结构

```
feishu-bitable-bot/
├── models.config.js        # ⭐ 单一数据源：模型注册表 + 能力类型注册表
├── bot-server.js           # 飞书群机器人（WebSocket 长连接）
├── run-model-text-test.js  # 文本模型测试脚本
├── run-media-test.js       # 图像/视频模型测试脚本
├── patch-cases.js          # AI 补全用例库空字段
├── ai-scoring.js           # AI 自动评分
├── notify.js               # 飞书群通知推送
├── update-usage-doc.js     # 更新飞书使用说明文档
└── delete-docs.js          # 工具：删除飞书文档/多维表格
```

---

## 快速开始

```bash
npm install
node bot-server.js
```

启动后在飞书群 `@机器人 帮助` 查看所有指令。

---

## 机器人指令

```
# 图像生成
跑测试 --model Midjourney
跑测试 --model Midjourney --ability 图像生成·文本

# 视频生成
跑测试 --model 豆包-Seedance-Lite
跑测试 --model 豆包-Seedance-Lite --ability 视频生成·文本

# 文本模型（via Dify）
跑测试 --model glm-4.5
跑测试 --ability 文本生成·文案          # --model 可省略，默认 glm-4.5
跑测试 --model qwen3.5-plus --ability 文本生成·歌词

# AI 评分（默认只评文本类）
评分
评分 --all
评分 --batch 202503-glm-4.5
评分 --batch 202503-glm-4.5 --all

# 补全用例库
补全用例
补全用例 --ability 视频生成·文本
```

---

## 直接运行脚本

```bash
# 文本模型测试
node run-model-text-test.js --model glm-4.5
node run-model-text-test.js --ability 文本生成·文案
node run-model-text-test.js --model qwen3.5-plus --ability 文本生成·歌词

# 图像/视频模型测试
node run-media-test.js --model midjourney
node run-media-test.js --model doubao-seedance-1-0-lite-t2v

# AI 自动评分
node ai-scoring.js
node ai-scoring.js --batch 202503-glm-4.5
node ai-scoring.js --include-media   # 同时评图像/视频类

# 补全用例库
node patch-cases.js                  # 预览
node patch-cases.js --apply
node patch-cases.js --apply --ability 视频生成·文本
```

---

## 新增模型

所有模型和能力类型统一在 `models.config.js` 维护，修改后其他脚本自动感知。

### 新增图像/视频模型（两步）

**Step 1** — `models.config.js` → `MODEL_REGISTRY` 加一行：

```js
'new-model': {
  difyKey:     'app-xxxxxxxxxx',
  difyInputs:  (prompt, imageUrl) => ({ prompt, model: 'new-model', i_url: imageUrl || '' }),
  outputField: '输出视频附件',   // 或「输出图像附件」
  mimeType:    'video/mp4',
  ext:         'mp4',
  abilities:   ['视频生成·文本'],
  timeout:     180000,
},
```

**Step 2** — 在 Dify 对应工作流加 IF 分支 + 独立输出节点（变量名 `result`）

### 新增文本模型（两步）

**Step 1** — `models.config.js` → `DIFY_TEXT_MODELS` 加一行：

```js
{ model: 'new-text-model', vendor: '厂商名' },
```

**Step 2** — 在 Dify 文本生成工作流加 IF 分支

### 新增能力类型（两步）

**Step 1** — `models.config.js` → `ABILITY_PREFIXES` 加一行：

```js
'新能力·子类型': { prefix: 'TC-XXX-YYY', isText: false },
```

**Step 2** — 飞书多维表格「能力类型」字段加对应选项值

---

## 设计说明

**单一数据源** — `models.config.js` 是唯一的配置入口，导出 `MODEL_REGISTRY`、`DIFY_TEXT_MODELS`、`ABILITY_PREFIXES`、`isTextAbility()` 供所有脚本 `require`，新增模型无需改多处文件。

**媒体文件存储** — Dify 返回的 URL 由脚本下载后上传至飞书附件字段（file_token），不依赖外链 CDN，避免链接过期。

**历史消息过滤** — 机器人记录启动时间戳（`BOT_START_MS`），重连后推送的旧消息（`create_time` 早于启动时刻）一律跳过，防止重复触发测试。

**AI 评分** — 默认只对文本类记录评分（通过 `isTextAbility()` 查表），图像/视频类需加 `--include-media` 显式启用。评分依据：模型输出 vs 用例库「参考标准 / 期望效果」，1–5 分，严格不轻易给满分。

---

## 使用说明文档

[AI 模型测试框架 · 使用说明](https://pcn28q31n7ee.feishu.cn/docx/BGridWskXoePymxfXHrcFCZgnuh)
