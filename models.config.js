/**
 * 模型注册表 & 能力类型配置 - 单一数据源
 *
 * 新增/删除能力类型：只改 ABILITY_PREFIXES，其他脚本自动感知
 * 新增模型：
 *   - 图像/视频模型：在 MODEL_REGISTRY 加一行，同时在 Dify 工作流加 IF 分支
 *   - 文本模型（Dify）：在 DIFY_TEXT_MODELS 加一行，同时在 Dify 工作流加 IF 分支
 *
 * 依赖此文件的脚本：
 *   bot-server.js / run-media-test.js / run-model-text-test.js
 *   patch-cases.js / ai-scoring.js
 */

// ── 能力类型注册表 ─────────────────────────────────────────
//
//  prefix  : 用例编号前缀（patch-cases.js 生成编号用）
//  isText  : true = 文本类（ai-scoring.js 默认评分范围；run-model-text-test.js 筛选用例）
//
//  新增能力类型：加一行，其他脚本自动同步
//  删除能力类型：删对应行（飞书表格里同步删除选项值）
//  未登记的能力类型：patch-cases.js 会警告并跳过，不会生成错误编号
//
const ABILITY_PREFIXES = {

  // ── 图像生成 ─────────────────────────────────────────────
  '图像生成·文本':             { prefix: 'TC-IMG-TXT', isText: false },
  '图像生成·文本+图像':        { prefix: 'TC-IMG-MIX', isText: false },
  '图像生成·图生图':           { prefix: 'TC-IMG-I2I', isText: false },

  // ── 视频生成 ─────────────────────────────────────────────
  '视频生成·文本':             { prefix: 'TC-VID-TXT', isText: false },
  '视频生成·文本+图像':        { prefix: 'TC-VID-MIX', isText: false },
  '视频生成·文本(可选+图像)':  { prefix: 'TC-VID-OPT', isText: false },
  '视频生成·图像(首帧)':       { prefix: 'TC-VID-I2V', isText: false },
  '视频生成·图像':             { prefix: 'TC-VID-IMG', isText: false },
  '视频生成·首尾帧':           { prefix: 'TC-VID-STE', isText: false },
  '视频生成·指令跟随':         { prefix: 'TC-VID-CMD', isText: false },
  '视频生成·视频续写':         { prefix: 'TC-VID-CNT', isText: false },
  '视频生成·混剪':             { prefix: 'TC-VID-EDI', isText: false },
  '视频生成·运镜':             { prefix: 'TC-VID-CAM', isText: false },
  '视频生成·姿态控制':         { prefix: 'TC-VID-POS', isText: false },

  // ── 口型驱动 ─────────────────────────────────────────────
  '口型驱动·纯音频':           { prefix: 'TC-LIP-AUD', isText: false },
  '口型驱动·图像+音频':        { prefix: 'TC-LIP-MIX', isText: false },
  '口型驱动·视频+音频':        { prefix: 'TC-LIP-VID', isText: false },

  // ── 文本生成 ─────────────────────────────────────────────
  '文本生成·文案':             { prefix: 'TC-TXT-WRT', isText: true  },
  '文本生成·歌词':             { prefix: 'TC-TXT-LYR', isText: true  },
  '文本生成·音乐描述':         { prefix: 'TC-TXT-MUS', isText: true  },

  // ── 文本理解 ─────────────────────────────────────────────
  '文本理解·翻译':             { prefix: 'TC-UND-TRL', isText: true  },
  '文本理解·情感分析':         { prefix: 'TC-UND-SEN', isText: true  },

  // ── 提示词 ───────────────────────────────────────────────
  '提示词·优化':               { prefix: 'TC-PROMPT',  isText: true  },
};

// 工具函数：判断能力类型是否属于文本类（ai-scoring.js / run-model-text-test.js 用）
function isTextAbility(ability) {
  const cfg = ABILITY_PREFIXES[ability];
  if (!cfg) return false;   // 未登记的视为非文本，不纳入默认评分范围
  return cfg.isText;
}

// ── 图像 / 视频 / 口型模型注册表（统一走运营组工作流 DIFY_UNIFIED_KEY）──
//
//  type        : image / video / lip-sync（运营组工作流的 type 字段，决定 IF 大类路由）
//  difyModelId : 飞书「模型 ID」字段值（运营组工作流 IF 分支匹配值）
//  outputField : 输出图像附件 / 输出视频附件 / 输出音频附件
//  mimeType    : 上传飞书时的文件 MIME 类型
//  ext         : 文件扩展名
//  abilities   : 匹配用例库「能力类型」字段的值（必须在 ABILITY_PREFIXES 中已登记）
//  timeout     : Dify 调用超时（毫秒）
//  friendlyNames: bot 命令 --model 的别名（registry key 本身已经是主匹配键）
//
//  registry key 约定 = 飞书「pricing 关联名」（用户业务标识）；新增模型必须按此约定
//  接入新模型：在飞书填好 pricing 关联名 + 模型 ID + 接入状态，跑 register-test-model skill
//
const MODEL_REGISTRY = {

  // ── 图像 ──────────────────────────────────────────────────
  'midjourney': {
    type:        'image',
    difyModelId: 'hk-midjourney',
    outputField: '输出图像附件',
    mimeType:    'image/jpeg',
    ext:         'jpg',
    abilities:   ['图像生成·文本', '图像生成·文本+图像', '图像生成·图生图'],
    timeout:     240000,
    friendlyNames: ['Midjourney', 'MJ', 'midjourney-中转HK'],
  },
  'doubao-seedream-5.0-lite': {
    type:        'image',
    difyModelId: 'doubao-seedream-5.0-lite',
    outputField: '输出图像附件',
    mimeType:    'image/jpeg',
    ext:         'jpg',
    abilities:   ['图像生成·文本', '图像生成·文本+图像', '图像生成·图生图'],
    timeout:     240000,
    friendlyNames: ['seedream-5.0', 'seedream-5.0-lite'],
  },
  'gpt-image-2-打开科技': {
    type:        'image',
    difyModelId: 'gpt-image-2',
    outputField: '输出图像附件',
    mimeType:    'image/png',
    ext:         'png',
    abilities:   ['图像生成·文本', '图像生成·文本+图像', '图像生成·图生图'],
    timeout:     240000,
    friendlyNames: ['gpt-image-2-打开科技'],
  },
  'Wan2.7-image-pro': {
    type:        'image',
    difyModelId: 'wan2.7-image-pro',
    outputField: '输出图像附件',
    mimeType:    'image/png',
    ext:         'png',
    abilities:   ['图像生成·文本'],
    timeout:     240000,
    friendlyNames: ['Wan2.7-image-pro'],
  },

  // ── 视频 ──────────────────────────────────────────────────
  'doubao-seedance-1-0-lite-t2v-智谱': {
    type:        'video',
    difyModelId: 'doubao-seedance-lite-t2v',
    outputField: '输出视频附件',
    mimeType:    'video/mp4',
    ext:         'mp4',
    abilities:   ['视频生成·文本'],
    timeout:     180000,
    friendlyNames: ['豆包-Seedance-Lite', 'doubao-seedance-1-0-lite-t2v-智谱'],  // ability 不含「图像」时路由到此
  },
  'doubao-seedance-1-0-lite-i2v-智谱': {
    type:        'video',
    difyModelId: 'doubao-seedance-lite-i2v',
    outputField: '输出视频附件',
    mimeType:    'video/mp4',
    ext:         'mp4',
    abilities:   ['视频生成·文本+图像', '视频生成·图像(首帧)'],
    timeout:     180000,
    friendlyNames: ['doubao-seedance-1-0-lite-i2v-智谱'],  // 共享豆包-Seedance-Lite，ability 含「图像」时路由到此
  },
  'happyhorse-1.0-i2v-720p': {
    type:        'video',
    difyModelId: 'happyhorse-1.0-i2v',
    outputField: '输出视频附件',
    mimeType:    'video/mp4',
    ext:         'mp4',
    abilities:   ['视频生成·图像'],
    timeout:     600000,
    friendlyNames: ['happyhorse-1.0-i2v-720p'],
    extraInputs: { resolution: '720P', duration: 5 },  // 抄运营后台真实成功 run 的 inputs
  },
  'happyhorse-1.0-i2v-1080p': {
    type:        'video',
    difyModelId: 'happyhorse-1.0-i2v',
    outputField: '输出视频附件',
    mimeType:    'video/mp4',
    ext:         'mp4',
    abilities:   ['视频生成·图像'],
    timeout:     600000,
    friendlyNames: ['happyhorse-1.0-i2v-1080p'],
    extraInputs: { resolution: '1080P', duration: 5 },
  },
  'happyhorse-1.0-t2v-720p': {
    type:        'video',
    difyModelId: 'happyhorse-1.0-t2v',
    outputField: '输出视频附件',
    mimeType:    'video/mp4',
    ext:         'mp4',
    abilities:   ['视频生成·文本+图像', '视频生成·文本'],
    timeout:     600000,
    friendlyNames: ['happyhorse-1.0-t2v-720p'],
    extraInputs: { resolution: '720P', duration: 5, aspect_ratio: '16:9' },  // T2V 必传 ratio
  },
  'happyhorse-1.0-r2v-720p': {
    type:        'video',
    difyModelId: 'happyhorse-1.0-r2v',
    outputField: '输出视频附件',
    mimeType:    'video/mp4',
    ext:         'mp4',
    abilities:   ['视频生成·文本+图像', '视频生成·文本', '视频生成·文本(可选+图像)', '视频生成·图像'],
    timeout:     600000,
    friendlyNames: ['happyhorse-1.0-r2v-720p'],
    extraInputs: { resolution: '720P', duration: 5, aspect_ratio: '16:9' },
  },
  'happyhorse-1.0-r2v-1080p': {
    type:        'video',
    difyModelId: 'happyhorse-1.0-r2v',
    outputField: '输出视频附件',
    mimeType:    'video/mp4',
    ext:         'mp4',
    abilities:   ['视频生成·文本+图像', '视频生成·文本', '视频生成·文本(可选+图像)', '视频生成·图像'],
    timeout:     600000,
    friendlyNames: ['happyhorse-1.0-r2v-1080p'],
    extraInputs: { resolution: '1080P', duration: 5, aspect_ratio: '16:9' },
  },
  'happyhorse-1.0-video-edit-720p': {
    type:        'video',
    difyModelId: 'happyhorse-1.0-video-edit',
    outputField: '输出视频附件',
    mimeType:    'video/mp4',
    ext:         'mp4',
    abilities:   ['视频生成·运镜', '视频生成·混剪', '视频生成·视频续写', '视频生成·指令跟随', '视频生成·图像(首帧)', '视频生成·首尾帧'],
    timeout:     600000,
    friendlyNames: ['happyhorse-1.0-video-edit-720p'],
    extraInputs: { resolution: '720P' },  // EDIT 不需要 duration
  },
  'happyhorse-1.0-video-edit-1080p': {
    type:        'video',
    difyModelId: 'happyhorse-1.0-video-edit',
    outputField: '输出视频附件',
    mimeType:    'video/mp4',
    ext:         'mp4',
    abilities:   ['视频生成·运镜', '视频生成·混剪', '视频生成·视频续写', '视频生成·指令跟随', '视频生成·图像(首帧)', '视频生成·首尾帧'],
    timeout:     600000,
    friendlyNames: ['happyhorse-1.0-video-edit-1080p'],
    extraInputs: { resolution: '1080P' },
  },
};

// 从 MODEL_REGISTRY 派生，bot-server.js 用于路由判断
const MEDIA_MODELS = Object.keys(MODEL_REGISTRY);

// ── 文本模型注册表（走 Dify 文本生成工作流）──────────────
// 新增模型：加一行 + 在 Dify 工作流加 IF 分支
const DIFY_TEXT_MODELS = [
  { model: 'glm-4.5',      vendor: '智谱', note: '默认' },
  { model: 'qwen3.5-plus', vendor: '阿里' },
];

// ── 测试人（写入「模型测试记录」的「测试人」多选字段）────
const TESTER_NAME = 'ai-tester';

module.exports = {
  ABILITY_PREFIXES,
  isTextAbility,
  MODEL_REGISTRY,
  MEDIA_MODELS,
  DIFY_TEXT_MODELS,
  TESTER_NAME,
};
