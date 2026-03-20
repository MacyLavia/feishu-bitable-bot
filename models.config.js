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

// ── 图像 / 视频模型注册表（走 Dify 工作流）────────────────
//
//  outputField 可选值：输出图像附件 / 输出视频附件 / 输出音频附件
//  mimeType   : 上传飞书时的文件 MIME 类型
//  ext        : 文件扩展名
//  abilities  : 匹配用例库「能力类型」字段的值（必须在 ABILITY_PREFIXES 中已登记）
//  timeout    : Dify 调用超时（毫秒）
//
const MODEL_REGISTRY = {

  // ── 图像生成（dev_huang_图像生成 工作流）─────────────────
  'midjourney': {
    difyKey:      'app-t6QHK94kBcV2bXsvCny2t6wJ',
    difyInputs:   (prompt, imageUrl) => ({ prompt, model: 'midjourney', i_url: imageUrl || '' }),
    outputField:  '输出图像附件',
    mimeType:     'image/jpeg',
    ext:          'jpg',
    abilities:    ['图像生成·文本', '图像生成·文本+图像', '图像生成·图生图'],
    timeout:      240000,
    friendlyNames: ['Midjourney', 'midjourney', 'MJ'],
  },
  // 待凭据可用 + Dify 工作流加 IF 分支后解注释：
  // 'cogview-4-250304': {
  //   difyKey:      'app-t6QHK94kBcV2bXsvCny2t6wJ',
  //   difyInputs:   (prompt) => ({ prompt, model: 'cogview-4-250304' }),
  //   outputField:  '输出图像附件',
  //   mimeType:     'image/jpeg',
  //   ext:          'jpg',
  //   abilities:    ['图像生成·文本'],
  //   timeout:      60000,
  //   friendlyNames: ['cogview', 'CogView'],
  // },

  // ── 视频生成（dev_huang_视频生成 工作流）─────────────────
  'doubao-seedance-1-0-lite-t2v': {
    difyKey:      'app-FdMdpGKycnOIj9Iwf5jiyS9q',
    difyInputs:   (prompt) => ({ prompt, model: 'doubao-seedance-1-0-lite-t2v' }),
    outputField:  '输出视频附件',
    mimeType:     'video/mp4',
    ext:          'mp4',
    abilities:    ['视频生成·文本'],
    timeout:      180000,
    friendlyNames: ['豆包-Seedance-Lite'],  // ability 不含「图像」时路由到此
  },
  'doubao-seedance-1-0-lite-i2v': {
    difyKey:      'app-FdMdpGKycnOIj9Iwf5jiyS9q',
    difyInputs:   (prompt, imageUrl) => ({ prompt, model: 'doubao-seedance-1-0-lite-i2v', i_url: imageUrl || '' }),
    outputField:  '输出视频附件',
    mimeType:     'video/mp4',
    ext:          'mp4',
    abilities:    ['视频生成·文本+图像', '视频生成·图像(首帧)'],
    timeout:      180000,
    friendlyNames: [],  // 共享豆包-Seedance-Lite，ability 含「图像」时路由到此
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
