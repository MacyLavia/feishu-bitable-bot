/**
 * Muse AI 中台助手 · 飞书通知系统
 *
 * 支持 4 种通知场景：
 *   suno      Suno 功能追踪提醒（待评估 / 值得对接清单）
 *   models    AI 中台模型状态周报（使用中 / 已接入待用 / 未接入）
 *   features  端内功能规划进展（P0/P1 功能状态）
 *   newmodels 新接模型通知（已接入但尚未启用的模型）
 *
 * 用法：
 *   node notify.js all        发送全部通知（周报模式）
 *   node notify.js suno       仅发 Suno 功能提醒
 *   node notify.js models     仅发模型状态周报
 *   node notify.js features   仅发功能规划进展
 *   node notify.js newmodels  仅发新接模型通知
 *
 * 定时任务（Windows 任务计划程序）：
 *   每周一 9:00  → node D:\claude_projects\notify.js all
 */

const https = require('https');
const { FEISHU_APP_ID, FEISHU_APP_SECRET } = require('./config');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CONFIG  ← 创建新应用后填入这里
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CONFIG = {
  app_id:     FEISHU_APP_ID,
  app_secret: FEISHU_APP_SECRET,

  // 多维表格（你创建的表格）
  bitable: {
    app_id:     FEISHU_APP_ID,
    app_secret: FEISHU_APP_SECRET,
    app_token:  'IzlCbNPjbaF38As26IJcSd47nKh',
    tables: {
      suno:  'tblGArxslG3hGpJP',   // Suno功能追踪
      model: 'tbloWaN3VqosiudO',   // AI中台模型能力
      cap:   'tblJHDy2FCqaNkyL',   // 端内能力映射
      feat:  'tbl4hqR2rPbCyfRb',   // 端内功能规划
    },
  },

  // 收件人配置
  // subscribe 填要接收的通知类型：suno / models / features / newmodels / all
  personal_open_id: 'ou_fe05f1ec509b57fa6e4285e871d12841',  // 个人始终收全部
  groups: [
    {
      chat_id:   'oc_741c4f25c99a8ed4615a3ac5490e1259',
      name:      '测试-中台助手',
      subscribe: ['suno', 'models', 'features', 'newmodels'],  // 收全部
    },
    {
      chat_id:   'oc_ccd88120d13c4233200eea37a39a65f0',
      name:      '测试2-AI中台助手',
      subscribe: ['models'],  // 只收模型状态周报
    },
  ],

  bitable_url: 'https://pcn28q31n7ee.feishu.cn/base/IzlCbNPjbaF38As26IJcSd47nKh',
};
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── HTTP 工具 ─────────────────────────────────────
function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    if (token)   headers['Authorization']  = `Bearer ${token}`;
    const r = https.request({ hostname: 'open.feishu.cn', path, method, headers }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Token 获取 ────────────────────────────────────
async function getToken(appId, appSecret) {
  const res = await req('POST', '/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: appId, app_secret: appSecret,
  });
  if (!res.tenant_access_token) throw new Error(`Token获取失败: ${JSON.stringify(res)}`);
  return res.tenant_access_token;
}

// ── 读取多维表格全量记录 ──────────────────────────
async function getRecords(tableId, bitableToken, bitableAppToken) {
  const records = [];
  let pageToken = '';
  do {
    await sleep(400);
    const url = `/open-apis/bitable/v1/apps/${CONFIG.bitable.app_token}/tables/${tableId}/records`
      + `?page_size=100${pageToken ? '&page_token=' + pageToken : ''}`;
    const res = await req('GET', url, null, bitableAppToken);
    if (res.code !== 0) throw new Error(`读取表格失败 [${tableId}]: ${res.msg}`);
    (res.data.items || []).forEach(r => records.push(r.fields));
    pageToken = res.data.has_more ? res.data.page_token : '';
  } while (pageToken);
  return records;
}

// ── 发送飞书卡片消息 ──────────────────────────────
async function sendCard(card, receiveId, receiveIdType, msgToken) {
  await sleep(300);
  const res = await req('POST',
    `/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
    { receive_id: receiveId, msg_type: 'interactive', content: JSON.stringify(card) },
    msgToken
  );
  if (res.code !== 0) {
    console.warn(`  ⚠️  发送失败 [${receiveId}]: ${res.msg}`);
  } else {
    console.log(`  ✅ 已发送 → ${receiveIdType}:${receiveId}`);
  }
  return res;
}

async function broadcast(card, msgToken, type) {
  await sendCard(card, CONFIG.personal_open_id, 'open_id', msgToken);
  for (const group of CONFIG.groups) {
    if (group.subscribe.includes(type) || group.subscribe.includes('all')) {
      await sendCard(card, group.chat_id, 'chat_id', msgToken);
    } else {
      console.log(`  ⏭  跳过 ${group.name}（未订阅 ${type}）`);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  卡片构建函数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── 1. Suno 功能追踪提醒 ──────────────────────────
function buildSunoCard(records) {
  const worthy   = records.filter(r => r['对接评估'] === '值得对接').sort((a,b) => {
    const order = {'P1-高':0,'P2-中':1,'P3-低':2};
    return (order[a['评估优先级']] ?? 9) - (order[b['评估优先级']] ?? 9);
  });
  const pending  = records.filter(r => r['对接评估'] === '待评估');
  const skipped  = records.filter(r => r['对接评估'] === '暂不对接');

  const fmtList = (items, fields) => items.length === 0
    ? '_（无）_'
    : items.map(r => {
        const parts = fields.map(f => r[f]).filter(Boolean);
        return `• ${parts.join('  |  ')}`;
      }).join('\n');

  const worthyText  = fmtList(worthy,  ['功能名称', '评估优先级']);
  const pendingText = fmtList(pending, ['功能名称', '评估优先级']);

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'purple',
      title: { tag: 'plain_text', content: `📡 Suno 功能追踪  ·  共 ${records.length} 项` },
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md',
        content: `🔥 **值得对接（${worthy.length} 个）**\n${worthyText}` } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md',
        content: `⏳ **待评估（${pending.length} 个）**\n${pendingText}` } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md',
        content: `🚫 **暂不对接（${skipped.length} 个）**  ${skipped.map(r=>r['功能名称']).join('、')}` } },
      { tag: 'hr' },
      { tag: 'action', actions: [{
        tag: 'button', type: 'primary',
        text: { tag: 'plain_text', content: '打开 Suno功能追踪 表' },
        url: CONFIG.bitable_url,
      }]},
      { tag: 'note', elements: [{ tag: 'plain_text',
        content: `更新时间：${new Date().toLocaleString('zh-CN')}` }]},
    ],
  };
}

// ── 2. 模型接入状态周报 ───────────────────────────
function buildModelCard(records) {
  const using    = records.filter(r => r['使用状态'] === '使用中');
  const ready    = records.filter(r => r['接入状态'] === '已接入' && r['使用状态'] === '未使用');
  const notIn    = records.filter(r => r['接入状态'] === '未接入');
  const noplan   = records.filter(r => String(r['接入状态']).startsWith('暂不接入'));

  const fmtModel = items => items.length === 0 ? '_（无）_'
    : items.map(r => {
        const ability = Array.isArray(r['模型能力']) ? r['模型能力'].join('、') : (r['模型能力'] || '');
        const vendor  = r['厂商'] || '';
        return `• **${r['模型名称']}**  ${vendor ? `[${vendor}]  ` : ''}${ability}`;
      }).join('\n');

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: `🤖 AI中台模型状态周报  ·  共 ${records.length} 个` },
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md',
        content: `✅ **使用中（${using.length} 个）**\n${fmtModel(using)}` } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md',
        content: `📦 **已接入·待启用（${ready.length} 个）**\n${fmtModel(ready)}` } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md',
        content: `⏳ **未接入（${notIn.length} 个）** · 暂不接入 ${noplan.length} 个` } },
      { tag: 'hr' },
      { tag: 'action', actions: [{
        tag: 'button', type: 'primary',
        text: { tag: 'plain_text', content: '打开 AI中台模型能力 表' },
        url: CONFIG.bitable_url,
      }]},
      { tag: 'note', elements: [{ tag: 'plain_text',
        content: `更新时间：${new Date().toLocaleString('zh-CN')}` }]},
    ],
  };
}

// ── 3. 端内功能规划进展 ───────────────────────────
function buildFeatCard(records) {
  const online  = records.filter(r => r['功能状态'] === '已上线');
  const planned = records.filter(r => r['功能状态'] === '规划中');
  const backlog = records.filter(r => r['功能状态'] === '需求池');

  // P0/P1 未上线的重点功能
  const critical = [...planned, ...backlog].filter(r =>
    r['优先级'] === 'P0' || r['优先级'] === 'P1'
  ).sort((a,b) => {
    const o = {P0:0,P1:1,P2:2,P3:3};
    return (o[a['优先级']]??9) - (o[b['优先级']]??9);
  });

  const fmtFeat = items => items.length === 0 ? '_（无）_'
    : items.map(r => `• **${r['功能名称']}**  [${r['优先级']||'-'}] [${r['功能模块']||'-'}]`).join('\n');

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'green',
      title: { tag: 'plain_text',
        content: `📋 端内功能规划进展  ·  已上线 ${online.length} / 共 ${records.length} 个` },
    },
    elements: [
      ...(critical.length > 0 ? [
        { tag: 'div', text: { tag: 'lark_md',
          content: `🔴 **P0/P1 待推进（${critical.length} 个）**\n${fmtFeat(critical)}` } },
        { tag: 'hr' },
      ] : []),
      { tag: 'column_set', flex_mode: 'stretch', background_style: 'default', columns: [
        { tag: 'column', width: 'weighted', weight: 1, elements: [
          { tag: 'div', text: { tag: 'lark_md',
            content: `✅ **已上线**\n${online.map(r=>`• ${r['功能名称']}`).join('\n') || '_（无）_'}` } },
        ]},
        { tag: 'column', width: 'weighted', weight: 1, elements: [
          { tag: 'div', text: { tag: 'lark_md',
            content: `🚧 **规划中**\n${planned.map(r=>`• ${r['功能名称']}`).join('\n') || '_（无）_'}` } },
        ]},
        { tag: 'column', width: 'weighted', weight: 1, elements: [
          { tag: 'div', text: { tag: 'lark_md',
            content: `💡 **需求池**\n${backlog.map(r=>`• ${r['功能名称']}`).join('\n') || '_（无）_'}` } },
        ]},
      ]},
      { tag: 'hr' },
      { tag: 'action', actions: [{
        tag: 'button', type: 'primary',
        text: { tag: 'plain_text', content: '打开 端内功能规划 表' },
        url: CONFIG.bitable_url,
      }]},
      { tag: 'note', elements: [{ tag: 'plain_text',
        content: `更新时间：${new Date().toLocaleString('zh-CN')}` }]},
    ],
  };
}

// ── 4. 新接模型通知 ───────────────────────────────
function buildNewModelCard(records) {
  // 已接入但未使用 = 刚接入、尚未投入使用的模型
  const newModels = records.filter(r =>
    r['接入状态'] === '已接入' && r['使用状态'] === '未使用'
  );

  const rows = newModels.map(r => {
    const ability  = Array.isArray(r['模型能力']) ? r['模型能力'].join('、') : (r['模型能力'] || '-');
    const supplier = Array.isArray(r['供应商'])   ? r['供应商'].join('、')   : (r['供应商']   || '-');
    return [
      { tag: 'div', text: { tag: 'lark_md',
        content: `**${r['模型名称']}**  [${r['厂商'] || '-'}]`
          + `\n能力：${ability}`
          + `\n供应商：${supplier}`
          + (r['接口文档'] ? `\n文档：[查看链接](${r['接口文档'].split('\n').find(l=>l.startsWith('http')) || r['接口文档']})` : ''),
      }},
      { tag: 'hr' },
    ];
  }).flat();

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'yellow',
      title: { tag: 'plain_text',
        content: `🆕 已接入·待启用模型清单  ·  共 ${newModels.length} 个` },
    },
    elements: [
      ...(rows.length > 0 ? rows : [
        { tag: 'div', text: { tag: 'lark_md', content: '_当前没有已接入但未使用的模型_' } },
      ]),
      { tag: 'action', actions: [{
        tag: 'button', type: 'primary',
        text: { tag: 'plain_text', content: '打开 AI中台模型能力 表' },
        url: CONFIG.bitable_url,
      }]},
      { tag: 'note', elements: [{ tag: 'plain_text',
        content: `更新时间：${new Date().toLocaleString('zh-CN')}` }]},
    ],
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  主流程
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function main() {
  const mode = process.argv[2] || 'all';
  console.log(`\n🚀 Muse AI 中台助手 · 通知模式: ${mode}\n`);

  // 获取两套 token
  const msgToken     = await getToken(CONFIG.app_id, CONFIG.app_secret);
  const bitableToken = await getToken(CONFIG.bitable.app_id, CONFIG.bitable.app_secret);
  console.log('✅ Token 获取成功\n');

  const shouldRun = name => mode === 'all' || mode === name;

  // ── Suno 功能追踪 ──────────────────────────────
  if (shouldRun('suno')) {
    console.log('📡 Suno 功能追踪提醒...');
    const records = await getRecords(CONFIG.bitable.tables.suno, CONFIG.bitable.app_token, bitableToken);
    const card = buildSunoCard(records);
    await broadcast(card, msgToken, 'suno');
    console.log();
  }

  // ── 模型状态周报 ───────────────────────────────
  if (shouldRun('models')) {
    console.log('🤖 AI中台模型状态周报...');
    const records = await getRecords(CONFIG.bitable.tables.model, CONFIG.bitable.app_token, bitableToken);
    const card = buildModelCard(records);
    await broadcast(card, msgToken, 'models');
    console.log();
  }

  // ── 功能规划进展 ───────────────────────────────
  if (shouldRun('features')) {
    console.log('📋 端内功能规划进展...');
    const records = await getRecords(CONFIG.bitable.tables.feat, CONFIG.bitable.app_token, bitableToken);
    const card = buildFeatCard(records);
    await broadcast(card, msgToken, 'features');
    console.log();
  }

  // ── 新接模型通知 ───────────────────────────────
  if (shouldRun('newmodels')) {
    console.log('🆕 新接模型通知...');
    const records = await getRecords(CONFIG.bitable.tables.model, CONFIG.bitable.app_token, bitableToken);
    const card = buildNewModelCard(records);
    await broadcast(card, msgToken, 'newmodels');
    console.log();
  }

  if (!['all','suno','models','features','newmodels'].includes(mode)) {
    console.error(`❌ 未知模式: ${mode}`);
    console.log('用法: node notify.js [all|suno|models|features|newmodels]');
    process.exit(1);
  }

  console.log('✅ 全部通知发送完成');
}

main().catch(e => {
  console.error('❌ 出错:', e.message);
  process.exit(1);
});
