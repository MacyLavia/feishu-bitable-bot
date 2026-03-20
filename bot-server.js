/**
 * 飞书机器人服务 - 长连接模式
 *
 * 用法：
 *   node bot-server.js
 *
 * 支持的指令（在群里 @ 机器人）：
 *   @机器人 跑测试 --model doubao-seedance-1-0-lite-t2v
 *   @机器人 跑测试 --model midjourney --ability 图像生成·文本
 *   @机器人 跑测试 --model glm-4.5              （文本模型，via Dify）
 *   @机器人 跑测试 --model glm-4.5 --siliconflow （文本模型，via SiliconFlow）
 *   @机器人 帮助
 */

// ── 清除代理环境变量（仅影响本进程，不影响系统其他应用）────
// 飞书 WebSocket 长连接在系统代理下会断连，这里自动处理，无需手动清除
['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY',
 'https_proxy', 'http_proxy', 'all_proxy'].forEach(k => delete process.env[k]);

const lark = require('@larksuiteoapi/node-sdk');
const { spawn } = require('child_process');
const https = require('https');
const { FEISHU_APP_ID: APP_ID, FEISHU_APP_SECRET: APP_SECRET } = require('./config');

// 文本模型默认走 Dify（加 --siliconflow 走直连），图像/视频模型走 Dify
const TEXT_SCRIPT  = 'run-model-text-test.js';
const MEDIA_SCRIPT = 'run-media-test.js';
const SCORE_SCRIPT = 'ai-scoring.js';
const PATCH_SCRIPT = 'patch-cases.js';

const { MEDIA_MODELS, DIFY_TEXT_MODELS, ABILITY_PREFIXES, MODEL_REGISTRY } = require('./models.config');

// ── 媒体模型友好名称 → 实际 ID（从 MODEL_REGISTRY 自动派生，新增模型只改 models.config.js）──
// 构建：friendlyName → [候选实际ID列表]（同一友好名称可能对应多个模型，由 ability 路由）
const FRIENDLY_NAME_MAP = {};  // friendlyName → [actualId, ...]
for (const [id, cfg] of Object.entries(MODEL_REGISTRY)) {
  for (const fn of (cfg.friendlyNames || [])) {
    if (!FRIENDLY_NAME_MAP[fn]) FRIENDLY_NAME_MAP[fn] = [];
    FRIENDLY_NAME_MAP[fn].push(id);
  }
}

function resolveMediaModel(name, ability) {
  if (!name) return name;
  // 已是实际 ID，直接返回
  if (MODEL_REGISTRY[name]) return name;
  // 查友好名称表
  const candidates = FRIENDLY_NAME_MAP[name];
  if (!candidates || candidates.length === 0) return name;
  if (candidates.length === 1) return candidates[0];
  // 多候选：找 abilities 包含当前 ability 的那个
  if (ability) {
    const match = candidates.find(id => MODEL_REGISTRY[id].abilities.includes(ability));
    if (match) return match;
  }
  return candidates[0];
}

// ── 帮助卡片内容构建（从 models.config.js 自动派生）──────
function buildModelsBody() {
  const seen = new Set();
  const mediaLines = [];
  for (const cfg of Object.values(MODEL_REGISTRY)) {
    const names = cfg.friendlyNames || [];
    if (names.length === 0) continue;
    const displayName = names[0];
    if (seen.has(displayName)) continue;
    seen.add(displayName);
    const outputType = cfg.outputField.includes('图像') ? '图像生成' : '视频生成';
    const hasVariants = Object.values(MODEL_REGISTRY).filter(
      c => (c.friendlyNames || []).includes(displayName)
    ).length > 1;
    const note = hasVariants ? '（根据 ability 自动路由）' : '';
    mediaLines.push(`\`${displayName}\`  ${outputType}${note}`);
  }
  const textLines = DIFY_TEXT_MODELS.map(
    m => `\`${m.model}\`  ${m.vendor}${m.note ? '（' + m.note + '）' : ''}`
  );
  return [...mediaLines, ...textLines].join('\n');
}

function buildAbilitiesBody() {
  const groups = {};
  Object.keys(ABILITY_PREFIXES).forEach(ability => {
    const group = ability.split('·')[0];
    if (!groups[group]) groups[group] = [];
    groups[group].push(ability);
  });
  return Object.entries(groups)
    .map(([group, abilities]) => `**${group}：** ${abilities.map(a => `\`${a}\``).join('  ')}`)
    .join('\n');
}

// ── 消息去重 + 历史消息过滤 ──────────────────────────────
// 1. processedMsgIds：同一 message_id 只处理一次（防 SDK 重连重放）
// 2. BOT_START_MS：忽略 create_time 早于启动时刻的消息（防重连后推送历史消息）
const processedMsgIds = new Set();
const BOT_START_MS = Date.now();

// ── 飞书 API（原生 https，避免 axios ECONNRESET）─────────
function reqFeishu(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : '';
    const h = { 'Content-Type': 'application/json; charset=utf-8' };
    if (b) h['Content-Length'] = Buffer.byteLength(b);
    if (token) h['Authorization'] = 'Bearer ' + token;
    const r = https.request({ hostname: 'open.feishu.cn', path, method, headers: h }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d }); } });
    });
    r.on('error', reject);
    if (b) r.write(b);
    r.end();
  });
}

// Token 缓存（有效期约 2 小时）
let cachedToken = '', tokenExpiry = 0;
async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await reqFeishu('POST', '/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: APP_ID, app_secret: APP_SECRET });
  if (!res.tenant_access_token) throw new Error('获取 Token 失败');
  cachedToken = res.tenant_access_token;
  tokenExpiry = Date.now() + (res.expire - 60) * 1000;
  return cachedToken;
}

// ── 飞书多维表格跳转链接 ─────────────────────────────────
const BITABLE        = 'WOyBb34Spa4nTOsevVacMJLTnNg';
const TABLE_RECORDS  = 'tbleffJEDv4VSd59';
const TABLE_CASES    = 'tblSdLU5MjOqzIXp';
const BITABLE_BASE   = `https://pcn28q31n7ee.feishu.cn/base/${BITABLE}`;
const URL_RECORDS    = `${BITABLE_BASE}?table=${TABLE_RECORDS}`;
const URL_CASES      = `${BITABLE_BASE}?table=${TABLE_CASES}`;

// ── 发送消息（失败自动重试 3 次）────────────────────────────
async function sendMsg(chatId, text) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const token = await getToken();
      const res = await reqFeishu('POST',
        '/open-apis/im/v1/messages?receive_id_type=chat_id',
        { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) },
        token);
      if (res.code === 0) return;
      throw new Error('send failed code=' + res.code);
    } catch (e) {
      if (attempt < 3) {
        console.warn(`[BOT] 发送消息失败，${attempt}s 后重试（${attempt}/3）: ${e.message}`);
        await new Promise(r => setTimeout(r, attempt * 1000));
      } else {
        console.error('[BOT] 发送消息最终失败:', e.message);
      }
    }
  }
}

// ── 解析指令 ──────────────────────────────────────────────
// 输入：飞书消息原始文本（群消息含 <at id="...">name</at> 标签）
// 返回：解析结果对象 或 null
function parseCommand(text) {
  // 去掉飞书 @ 标签
  const cleaned = text.replace(/<at[^>]*>[^<]*<\/at>/g, '').replace(/@\S+/g, '').trim();

  if (cleaned === '帮助' || cleaned === 'help') return { cmd: 'help' };

  // 跑测试：--model 可选（缺省时走默认文本模型 glm-4.5）
  if (cleaned.startsWith('跑测试') || cleaned.startsWith('run')) {
    const parts   = cleaned.split(/\s+/);
    const getArg  = (n) => { const i = parts.indexOf(n); return i >= 0 ? parts[i + 1] : null; };
    const model   = getArg('--model') || null;
    const ability = getArg('--ability') || null;
    const caseId  = getArg('--case') || null;
    return { cmd: 'run', model, ability, caseId };
  }

  // 评分：--batch / --all 可选，支持组合
  if (cleaned.startsWith('评分') || cleaned.startsWith('score')) {
    const parts  = cleaned.split(/\s+/);
    const getArg = (n) => { const i = parts.indexOf(n); return i >= 0 ? parts[i + 1] : null; };
    return {
      cmd:   'score',
      batch: getArg('--batch') || null,
      forceAll: parts.includes('--all'),
    };
  }

  // 补全用例：--ability 可选
  if (cleaned.startsWith('补全用例') || cleaned.startsWith('patch')) {
    const parts  = cleaned.split(/\s+/);
    const getArg = (n) => { const i = parts.indexOf(n); return i >= 0 ? parts[i + 1] : null; };
    return { cmd: 'patch', ability: getArg('--ability') || null };
  }

  return null;
}

// ── 执行测试脚本（子进程），实时收集输出 ──────────────────
function runTest(scriptArgs) {
  return new Promise((resolve) => {
    const lines = [];
    const proc  = spawn('node', scriptArgs, { cwd: __dirname });

    proc.stdout.on('data', (d) => {
      const s = d.toString();
      process.stdout.write(s);          // 本地控制台同步显示
      lines.push(...s.split('\n').filter(l => l.trim()));
    });
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      process.stderr.write(s);
      lines.push('ERR: ' + s.trim());
    });
    proc.on('close', (code) => resolve({ code, lines }));
  });
}

// ── 发送卡片消息（带跳转按钮，失败自动重试 3 次）────────
async function sendCard(chatId, headerTitle, headerColor, bodyText, buttonText, buttonUrl) {
  const card = {
    config: { wide_screen_mode: true },
    header: {
      template: headerColor,
      title: { content: headerTitle, tag: 'plain_text' },
    },
    elements: [
      { tag: 'div', text: { content: bodyText, tag: 'lark_md' } },
      {
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { content: buttonText, tag: 'plain_text' },
          url: buttonUrl,
          type: 'default',
        }],
      },
    ],
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const token = await getToken();
      const res = await reqFeishu('POST',
        '/open-apis/im/v1/messages?receive_id_type=chat_id',
        { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) },
        token);
      if (res.code === 0) return;
      throw new Error('sendCard failed code=' + res.code + ' ' + (res.msg || ''));
    } catch (e) {
      if (attempt < 3) {
        console.warn(`[BOT] 发送卡片失败，${attempt}s 后重试: ${e.message}`);
        await new Promise(r => setTimeout(r, attempt * 1000));
      } else {
        console.error('[BOT] 发送卡片最终失败，降级为文本:', e.message);
        await sendMsg(chatId, headerTitle + '\n\n' + bodyText.replace(/\*\*/g, ''));
      }
    }
  }
}

// ── 发送帮助卡片（3 个按钮：文档 + 查看模型 + 查看能力类型）──
async function sendHelpCard(chatId, bodyText) {
  const card = {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { content: '📖 AI 模型测试框架 · 使用说明', tag: 'plain_text' },
    },
    elements: [
      { tag: 'div', text: { content: bodyText, tag: 'lark_md' } },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { content: '📄 查看完整文档', tag: 'plain_text' },
            url: 'https://pcn28q31n7ee.feishu.cn/docx/Ew9zdFETeoQlQ7xWmsDcweiZnib',
            type: 'default',
          },
          {
            tag: 'button',
            text: { content: '🤖 查看可用模型', tag: 'plain_text' },
            type: 'primary',
            value: { action: 'show_models' },
          },
          {
            tag: 'button',
            text: { content: '📋 查看能力类型', tag: 'plain_text' },
            type: 'primary',
            value: { action: 'show_abilities' },
          },
        ],
      },
    ],
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const token = await getToken();
      const res = await reqFeishu('POST',
        '/open-apis/im/v1/messages?receive_id_type=chat_id',
        { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) },
        token);
      if (res.code === 0) return;
      throw new Error('sendHelpCard failed code=' + res.code + ' ' + (res.msg || ''));
    } catch (e) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 1000));
      } else {
        console.error('[BOT] 发送帮助卡片失败，降级为文本:', e.message);
        await sendMsg(chatId, bodyText.replace(/\*\*/g, ''));
      }
    }
  }
}

// ── 生成结果摘要（最多 5 行关键信息）────────────────────
function summarize(lines, code) {
  // 找完成行和错误行
  const summary = lines.filter(l =>
    l.includes('完成') || l.includes('成功写入') ||
    l.includes('❌') || l.includes('批次标签') || l.includes('ERROR')
  ).slice(0, 5);

  if (summary.length === 0) {
    return code === 0 ? '测试已完成 ✅' : '测试异常退出，请查看控制台日志';
  }
  return summary.join('\n');
}

// ── 消息事件处理 ──────────────────────────────────────────
async function handleMessage(data) {
  const msg     = data.message;
  const chatId  = msg.chat_id;
  const msgType = msg.message_type;

  // 过滤历史消息：create_time 早于机器人启动时刻的一律跳过
  // 飞书 create_time 单位为毫秒，重连后可能推送启动前的旧消息
  const createTime = parseInt(msg.create_time || '0');
  if (createTime && createTime < BOT_START_MS) {
    console.log(`[BOT] 跳过历史消息（启动前 ${Math.round((BOT_START_MS - createTime) / 1000)}s）: ${msg.message_id}`);
    return;
  }

  // 去重：同一 message_id 只处理一次（防同次会话内重复推送）
  if (processedMsgIds.has(msg.message_id)) return;
  processedMsgIds.add(msg.message_id);

  // 只处理文本消息
  if (msgType !== 'text') return;

  let text = '';
  try {
    text = JSON.parse(msg.content).text || '';
  } catch { return; }

  console.log('[DEBUG] chat_type:', msg.chat_type, '| mentions:', JSON.stringify(data.message.mentions));
  console.log('[DEBUG] text:', text.slice(0, 100));

  const parsed = parseCommand(text);

  // 未识别指令
  if (!parsed) {
    await sendMsg(chatId,
      '❓ 未识别的指令，发送「帮助」查看用法'
    );
    return;
  }

  // 帮助
  if (parsed.cmd === 'help') {
    const helpBody = [
      '在群里 **@机器人** 加指令即可使用，例如：@机器人 帮助',
      '',
      '**🎬 跑测试 · 图像 / 视频**',
      '`跑测试 --model Midjourney`',
      '`跑测试 --model Midjourney --ability 图像生成·文本`',
      '`跑测试 --model 豆包-Seedance-Lite --ability 视频生成·文本`',
      '',
      '**📝 跑测试 · 文本模型**',
      '`跑测试 --model glm-4.5`',
      '`跑测试 --ability 文本生成·文案`  （默认模型 glm-4.5）',
      '`跑测试 --model qwen3.5-plus --ability 文本生成·歌词`',
      '',
      '支持 `--case 用例编号` 只跑某一条，如：`跑测试 --model glm-4.5 --case TC-TXT-LYR-002`',
      '',
      '**⭐ 评分**  默认只评文本类未评分记录',
      '`评分`',
      '`评分 --all`  强制重评所有',
      '`评分 --batch 202503-glm-4.5`  指定批次',
      '',
      '**🔧 补全用例**',
      '`补全用例`  AI 补全全部空字段',
      '`补全用例 --ability 视频生成·文本`  指定能力类型',
    ].join('\n');

    await sendHelpCard(chatId, helpBody);
    return;
  }

  // 跑测试
  if (parsed.cmd === 'run') {
    const friendlyName = parsed.model;
    const ability      = parsed.ability;

    // 判断是否媒体模型（友好名称查表 或 已是实际 ID）
    const isMediaFriendly = friendlyName && (friendlyName in FRIENDLY_NAME_MAP);
    const isMediaDirect   = friendlyName && MEDIA_MODELS.includes(friendlyName);
    const isMedia         = isMediaFriendly || isMediaDirect;

    if (isMedia) {
      // 媒体模型：解析友好名称 → 实际 ID
      const actualModel = resolveMediaModel(friendlyName, ability);
      if (!MEDIA_MODELS.includes(actualModel)) {
        await sendMsg(chatId, `❌ 未知媒体模型「${friendlyName}」\n可用：Midjourney、豆包-Seedance-Lite`);
        return;
      }

      const scriptArgs = [MEDIA_SCRIPT, '--model', actualModel];
      if (ability)          scriptArgs.push('--ability', ability);
      if (parsed.caseId)    scriptArgs.push('--case', parsed.caseId);

      await sendMsg(chatId,
        `⏳ 开始测试 ${friendlyName}` +
        (ability ? `（${ability}）` : '') +
        (parsed.caseId ? `\n用例：${parsed.caseId}` : '') +
        '\n结果写入完成后通知你。'
      );

      console.log(`\n[BOT] 执行: node ${scriptArgs.join(' ')}`);
      const { code, lines } = await runTest(scriptArgs);
      const recordIds = lines.filter(l => l.startsWith('[RECORD]')).map(l => l.replace('[RECORD]', '').trim());
      const infoLines = lines.filter(l => !l.startsWith('[RECORD]') && (l.includes('完成') || l.includes('成功写入') || l.includes('❌'))).slice(0, 4);
      let bodyText = infoLines.join('\n') || (code === 0 ? '测试完成' : '测试异常，请查看控制台日志');
      if (recordIds.length > 0) bodyText += '\n\n**记录ID：**\n' + recordIds.map(id => `· ${id}`).join('\n');
      await sendCard(chatId,
        code === 0 ? `✅ 测试完成 · ${friendlyName}` : `⚠️ 测试结束（有异常）· ${friendlyName}`,
        code === 0 ? 'green' : 'orange',
        bodyText, '📊 查看模型测试记录', URL_RECORDS
      );

    } else {
      // 文本模型：model 缺省时用默认模型
      const actualModel = friendlyName || DIFY_TEXT_MODELS[0].model;

      const scriptArgs = [TEXT_SCRIPT, '--model', actualModel];
      if (ability)          scriptArgs.push('--ability', ability);
      if (parsed.caseId)    scriptArgs.push('--case', parsed.caseId);

      await sendMsg(chatId,
        `⏳ 开始测试 ${actualModel}` +
        (ability ? `（${ability}）` : '（全部文本类）') +
        (parsed.caseId ? `\n用例：${parsed.caseId}` : '') +
        '\n结果写入完成后通知你。'
      );

      console.log(`\n[BOT] 执行: node ${scriptArgs.join(' ')}`);
      const { code, lines } = await runTest(scriptArgs);
      const recordIds = lines.filter(l => l.startsWith('[RECORD]')).map(l => l.replace('[RECORD]', '').trim());
      const infoLines = lines.filter(l => !l.startsWith('[RECORD]') && (l.includes('完成') || l.includes('成功写入') || l.includes('❌'))).slice(0, 4);
      let bodyText = infoLines.join('\n') || (code === 0 ? '测试完成' : '测试异常，请查看控制台日志');
      if (recordIds.length > 0) bodyText += '\n\n**记录ID：**\n' + recordIds.map(id => `· ${id}`).join('\n');
      await sendCard(chatId,
        code === 0 ? `✅ 测试完成 · ${actualModel}` : `⚠️ 测试结束（有异常）· ${actualModel}`,
        code === 0 ? 'green' : 'orange',
        bodyText, '📊 查看模型测试记录', URL_RECORDS
      );
    }
    return;
  }

  // 评分
  if (parsed.cmd === 'score') {
    const scriptArgs = [SCORE_SCRIPT];
    if (parsed.batch)    scriptArgs.push('--batch', parsed.batch);
    if (parsed.forceAll) scriptArgs.push('--all');

    await sendMsg(chatId,
      '⏳ 开始 AI 自动评分（文本类）' +
      (parsed.batch    ? `\n批次：${parsed.batch}` : '') +
      (parsed.forceAll ? '\n模式：强制重评所有' : '') +
      '\n评分完成后通知你。'
    );

    console.log(`\n[BOT] 执行: node ${scriptArgs.join(' ')}`);
    const { code, lines } = await runTest(scriptArgs);

    // 解析已评分的记录ID
    const scoredIds = lines
      .filter(l => l.startsWith('[SCORED]'))
      .map(l => l.replace('[SCORED]', '').trim());

    // 摘要行（过滤掉标记行）
    const infoLines = lines.filter(l =>
      !l.startsWith('[SCORED]') &&
      (l.includes('完成') || l.includes('成功') || l.includes('❌') || l.includes('待评分'))
    ).slice(0, 4);

    let bodyText = infoLines.join('\n') || (code === 0 ? '评分完成' : '评分异常，请查看控制台日志');
    if (scoredIds.length > 0) {
      bodyText += '\n\n**已评分记录ID：**\n' + scoredIds.map(id => `· ${id}`).join('\n');
    }

    await sendCard(chatId,
      code === 0 ? '✅ 评分完成' : '⚠️ 评分结束（有异常）',
      code === 0 ? 'green' : 'orange',
      bodyText,
      '📊 查看模型测试记录',
      URL_RECORDS
    );
    return;
  }

  // 补全用例
  if (parsed.cmd === 'patch') {
    const scriptArgs = [PATCH_SCRIPT, '--apply'];
    if (parsed.ability) scriptArgs.push('--ability', parsed.ability);

    await sendMsg(chatId,
      '⏳ 开始补全用例库' +
      (parsed.ability ? `\n能力类型：${parsed.ability}` : '（全部）') +
      '\n补全完成后通知你。'
    );

    console.log(`\n[BOT] 执行: node ${scriptArgs.join(' ')}`);
    const { code, lines } = await runTest(scriptArgs);

    // 解析已补全的用例编号
    const patchedIds = lines
      .filter(l => l.startsWith('[PATCHED]'))
      .map(l => l.replace('[PATCHED]', '').trim());

    // 摘要行
    const infoLines = lines.filter(l =>
      !l.startsWith('[PATCHED]') &&
      (l.includes('完成') || l.includes('成功写入') || l.includes('❌'))
    ).slice(0, 4);

    let bodyText = infoLines.join('\n') || (code === 0 ? '补全完成' : '补全异常，请查看控制台日志');
    if (patchedIds.length > 0) {
      bodyText += '\n\n**已补全用例编号：**\n' + patchedIds.map(id => `· ${id}`).join('\n');
    }

    await sendCard(chatId,
      code === 0 ? '✅ 补全完成' : '⚠️ 补全结束（有异常）',
      code === 0 ? 'green' : 'orange',
      bodyText,
      '📋 查看模型测试用例库',
      URL_CASES
    );
    return;
  }
}

// ── 启动长连接 ────────────────────────────────────────────
const wsClient = new lark.WSClient({
  appId: APP_ID,
  appSecret: APP_SECRET,
  loggerLevel: lark.LoggerLevel.debug,
});

wsClient.start({
  eventDispatcher: new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      console.log('[DEBUG] 收到消息事件:', JSON.stringify(data).slice(0, 200));
      try {
        await handleMessage(data);
      } catch(e) {
        console.error('[ERROR] handler 异常:', e.message);
        console.error(e.stack);
      }
    },
    'card.action.trigger': async (data) => {
      console.log('[DEBUG] 收到卡片回调:', JSON.stringify(data).slice(0, 200));
      try {
        const chatId = data.context?.open_chat_id || data.open_chat_id;
        const action = data.action?.value?.action;
        if (!chatId || !action) return;
        if (action === 'show_models') {
          await sendCard(chatId, '🤖 可用模型', 'blue', buildModelsBody(), '📊 查看测试记录', URL_RECORDS);
        } else if (action === 'show_abilities') {
          await sendCard(chatId, '📋 能力类型', 'blue', buildAbilitiesBody(), '📋 查看用例库', URL_CASES);
        }
      } catch(e) {
        console.error('[ERROR] 卡片回调处理异常:', e.message);
      }
    },
  }),
});

console.log('');
console.log('══════════════════════════════════════════');
console.log('  飞书机器人已启动（长连接模式）');
console.log('  等待连接飞书服务器...');
console.log('  群里 @ 机器人发「帮助」查看指令');
console.log('══════════════════════════════════════════');
console.log('');
