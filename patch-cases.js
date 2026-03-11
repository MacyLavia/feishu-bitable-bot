/**
 * 补全模型测试用例库
 *
 * 自动填补以下空字段：
 *   规则生成  →  用例编号
 *   AI  生成  →  Prompt/指令、难度、输入素材说明、参考标准/期望效果、备注
 *
 * AI 调用：默认走 Dify 工作流 dev_huang_文本生成
 *          加 --siliconflow 参数可切换为直连 SiliconFlow API
 *
 * 用法：
 *   node patch-cases.js                                   预览，全量
 *   node patch-cases.js --ability 视频生成·文本            预览，只处理该能力类型
 *   node patch-cases.js --apply                           写入飞书（Dify）
 *   node patch-cases.js --apply --ability 视频生成·文本   写入飞书，只处理该能力类型
 *   node patch-cases.js --siliconflow                     预览，走 SiliconFlow 直连
 *   node patch-cases.js --apply --siliconflow             写入飞书，走 SiliconFlow 直连
 *   node patch-cases.js --debug-fields                    打印飞书真实字段名
 */

const https = require('https');
const { ABILITY_PREFIXES } = require('./models.config');
const { FEISHU_APP_ID, FEISHU_APP_SECRET, SILICONFLOW_KEY } = require('./config');

// ── 飞书配置 ──────────────────────────────────────────────
const BITABLE          = 'WOyBb34Spa4nTOsevVacMJLTnNg';
const TABLE_CASES      = 'tblSdLU5MjOqzIXp';

// ── 命令行参数 ────────────────────────────────────────────
const _args          = process.argv.slice(2);
const _hasFlag       = (f) => _args.includes(f);
const _getArg        = (n) => { const i = _args.indexOf(n); return i >= 0 ? _args[i + 1] : null; };

const APPLY          = _hasFlag('--apply');
const USE_DIFY       = !_hasFlag('--siliconflow');   // 默认 Dify；加 --siliconflow 走 SiliconFlow
const TARGET_ABILITY = _getArg('--ability') || null;   // null = 全量

// ── AI 调用后端配置 ───────────────────────────────────────
// Dify 工作流（dev_huang_文本生成）
const DIFY_KEY        = 'app-1kXJtHp5pZL7pzaF4c5eHCu8';
const DIFY_HOST       = '43.160.192.41';
const DIFY_PORT       = 9090;
const DIFY_FILL_MODEL = 'glm-4.5';   // patch-cases 用来生成字段的文本模型

// SiliconFlow 直连（备用）
const FILL_MODEL      = 'Pro/zai-org/GLM-4.7';

// PREFIX_MAP 已迁移至 models.config.js → ABILITY_PREFIXES（单一数据源）

// ── 需要 AI 填补的字段 & 说明（供 AI 参考）──────────────
const AI_FIELD_DESCS = {
  'Prompt / 指令':     '针对该能力类型的具体测试指令，中文，描述场景/人物/动作/风格，60-150字',
  '难度':              '只能是 "低"、"中"、"高" 三选一，根据 Prompt 的复杂度和对模型的要求判断',
  '输入素材说明':      '描述本用例需要哪种输入素材；无素材需求填 "无"；需要图片时描述图片的内容/风格',
  '参考标准 / 期望效果': '描述本用例期望的输出效果或评判标准，30-80字，聚焦质量维度',
  '备注':              '补充说明，如测试注意事项、特殊评判维度等；必须输出内容，不可为空，无特别说明时写"常规测试"',
};

// ── 工具函数 ──────────────────────────────────────────────
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
    r.on('error', reject); if (b) r.write(b); r.end();
  });
}

// ── Dify 工作流调用（dev_huang_文本生成）──────────────────
function callDify(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      inputs: { prompt, model: DIFY_FILL_MODEL },
      response_mode: 'blocking',
      user: 'patch-cases',
    });
    const r = require('http').request({
      hostname: DIFY_HOST, port: DIFY_PORT,
      path: '/v1/workflows/run', method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + DIFY_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.data?.status !== 'succeeded') {
            reject(new Error('Dify 失败: ' + (j.data?.error || JSON.stringify(j).slice(0, 80))));
          } else {
            let text = j.data.outputs?.result || '';
            text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            resolve(text);
          }
        } catch(e) { reject(e); }
      });
    });
    r.on('error', reject); r.write(body); r.end();
  });
}

// ── SiliconFlow 直连调用（备用）──────────────────────────
function callSiliconFlow(userPrompt, systemPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: FILL_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      max_tokens: 600,
      temperature: 0.3,
    });
    const r = https.request({
      hostname: 'api.siliconflow.cn', path: '/v1/chat/completions', method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + SILICONFLOW_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.error) reject(new Error(j.error.message || JSON.stringify(j.error)));
          else resolve(j.choices[0].message.content.trim());
        } catch(e) { reject(e); }
      });
    });
    r.on('error', reject); r.write(body); r.end();
  });
}

// ── 统一调用入口 ──────────────────────────────────────────
function callAI(userPrompt, systemPrompt) {
  if (USE_DIFY) {
    // Dify 工作流只接受单个 prompt，将 system 指令并入 prompt 头部
    return callDify(systemPrompt + '\n\n' + userPrompt);
  }
  return callSiliconFlow(userPrompt, systemPrompt);
}

async function aiFillFields(ability, existingPrompt, missingFields) {
  const systemPrompt = '你是 AI 模型测试用例设计专家，熟悉图像/视频/文本生成模型的能力评测。'
                     + '根据提供的用例信息，补全缺失字段。只输出 JSON，不要解释，不要 markdown 代码块。';

  const fieldList = missingFields
    .map(f => `  "${f}": <${AI_FIELD_DESCS[f] || '相应内容'}>`)
    .join(',\n');

  const userPrompt = `
用例信息：
  能力类型：${ability}
  ${existingPrompt ? `已有 Prompt/指令：${existingPrompt}` : '（Prompt 也需要生成）'}

请只输出以下缺失字段的 JSON（不要输出已有字段）：
{
${fieldList}
}
`.trim();

  const raw = await callAI(userPrompt, systemPrompt);
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 返回无法解析为 JSON: ' + raw.slice(0, 120));
  return JSON.parse(m[0]);
}

function getStr(field) {
  if (field === null || field === undefined) return '';
  // 飞书多行文本：[{type:"text", text:"..."}, ...]
  if (Array.isArray(field)) return field.map(seg => seg.text || '').join('').trim();
  // 飞书单选 / 富文本对象：{text:"..."}
  if (typeof field === 'object') return field.text || '';
  return String(field).trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 主流程 ────────────────────────────────────────────────
async function main() {
  const modeLabel     = APPLY ? '写入模式' : '预览模式 —— 确认计划后加 --apply 实际写入';
  const aiLabel       = USE_DIFY ? 'Dify · dev_huang_文本生成' : 'SiliconFlow 直连';
  const abilityLabel  = TARGET_ABILITY ? `只处理「${TARGET_ABILITY}」` : '全量';
  console.log(`\n【${modeLabel}】  AI 后端：${aiLabel}  范围：${abilityLabel}`);

  // Step 1: 飞书授权
  process.stdout.write('\nStep 1  获取飞书授权...');
  const tr = await reqFeishu('POST', '/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET });
  if (!tr.tenant_access_token) throw new Error('Token 失败');
  const token = tr.tenant_access_token;
  console.log(' ✅');

  // Step 2: 读取全部用例（支持翻页）
  process.stdout.write('Step 2  读取用例库...');
  let allCases = [], pageToken = '';
  do {
    const url = `/open-apis/bitable/v1/apps/${BITABLE}/tables/${TABLE_CASES}/records?page_size=100`
              + (pageToken ? '&page_token=' + pageToken : '');
    const res = await reqFeishu('GET', url, null, token);
    if (res.code !== 0) throw new Error('读取失败: ' + JSON.stringify(res));
    allCases = allCases.concat(res.data?.items || []);
    pageToken = res.data?.has_more ? res.data.page_token : '';
  } while (pageToken);
  console.log(` ✅  共 ${allCases.length} 条\n`);

  // --debug-fields：打印第一条记录的所有字段名，用于排查字段名拼写问题
  if (_hasFlag('--debug-fields')) {
    const first = allCases[0];
    if (first) {
      console.log('── 飞书实际字段名（第一条记录）──');
      Object.entries(first.fields).forEach(([k, v]) => {
        const val = getStr(v);
        console.log(`  "${k}"  →  ${val ? val.slice(0, 40) : '(空)'}`);
      });
    }
    console.log('\n脚本中配置的 AI_FIELD_DESCS 字段名：');
    Object.keys(AI_FIELD_DESCS).forEach(k => console.log(`  "${k}"`));
    console.log('');
    return;
  }

  // Step 3: 统计现有编号，避免重复
  const counters = {};
  for (const c of allCases) {
    const id = getStr(c.fields['用例编号']);
    if (!id) continue;
    const m = id.match(/^(TC-[\w-]+?)-(\d+)$/);
    if (m) {
      const pfx = m[1], n = parseInt(m[2]);
      if (!counters[pfx] || counters[pfx] < n) counters[pfx] = n;
    }
  }

  // Step 4: 扫描需要补全的记录
  const toProcess = [];
  const noAbility = [];

  for (const c of allCases) {
    const f       = c.fields;
    const id      = getStr(f['用例编号']);
    const ability = getStr(f['能力类型']);
    const prompt  = getStr(f['Prompt / 指令']);

    // 跳过完全空行
    if (!ability && !prompt) continue;

    // --ability 筛选
    if (TARGET_ABILITY && ability !== TARGET_ABILITY) continue;

    // 缺少能力类型，无法确定方向
    if (!ability) {
      noAbility.push({ recordId: c.record_id, prompt: prompt.slice(0, 60) });
      continue;
    }

    // 检查哪些 AI 字段为空
    const missingFields = Object.keys(AI_FIELD_DESCS).filter(field => !getStr(f[field]));
    const needNewId = !id;

    if (!needNewId && missingFields.length === 0) continue;  // 全都有，跳过

    toProcess.push({ recordId: c.record_id, ability, prompt, needNewId, missingFields, currentId: id });
  }

  // 报告无能力类型的行
  if (noAbility.length > 0) {
    console.log(`⚠️  以下 ${noAbility.length} 条缺少「能力类型」，已跳过（请手动补填）：`);
    noAbility.forEach(r => console.log(`   ${r.recordId}  "${r.prompt}"`));
    console.log('');
  }

  if (toProcess.length === 0) {
    console.log('✅  所有用例字段已完整，无需补全。\n');
    return;
  }

  console.log(`共 ${toProcess.length} 条需要补全，逐条处理...\n`);
  console.log('─'.repeat(55));

  let ok = 0;
  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    const idx  = `[${i + 1}/${toProcess.length}]`;

    // ── 定位行：显示飞书中对应哪条记录 ──────────────────
    const idLabel = item.currentId ? `用例编号 ${item.currentId}` : '用例编号 (空)';
    console.log(`\n${idx} ${idLabel}  [${item.ability}]`);
    const promptPreview = item.prompt
      ? item.prompt.slice(0, 60) + (item.prompt.length > 60 ? '…' : '')
      : '（无 Prompt）';
    console.log(`  Prompt: ${promptPreview}`);
    console.log('  待写入字段：');

    const toFill = {};

    // ── 规则生成：用例编号 ────────────────────────────────
    if (item.needNewId) {
      const abilityCfg = ABILITY_PREFIXES[item.ability];
      if (!abilityCfg) {
        console.log(`    ⚠️  未知能力类型「${item.ability}」，请先在 models.config.js → ABILITY_PREFIXES 登记，跳过此条`);
        continue;
      }
      const pfx = abilityCfg.prefix;
      counters[pfx] = (counters[pfx] || 0) + 1;
      toFill['用例编号'] = pfx + '-' + String(counters[pfx]).padStart(3, '0');
      console.log(`    用例编号       →  ${toFill['用例编号']}  ★ 新生成`);
    }

    // ── AI 生成：其余空字段 ───────────────────────────────
    if (item.missingFields.length > 0) {
      process.stdout.write(`    (AI 生成中…)`);
      try {
        const filled = await aiFillFields(item.ability, item.prompt, item.missingFields);
        // 清除"生成中"占位符，换行重新输出
        process.stdout.write('\r' + ' '.repeat(20) + '\r');
        for (const field of item.missingFields) {
          const val = String(filled[field] ?? '').trim();
          if (val) {
            toFill[field] = val;
            const display = val.slice(0, 65) + (val.length > 65 ? '…' : '');
            console.log(`    ${field.padEnd(14)} →  ${display}`);
          } else {
            console.log(`    ${field.padEnd(14)}    （空，跳过）`);
          }
        }
      } catch(e) {
        process.stdout.write('\r' + ' '.repeat(20) + '\r');
        console.log(`    ❌ AI 生成失败: ${e.message.slice(0, 70)}`);
        console.log('    （AI 字段跳过，用例编号仍写入）');
      }
    }

    // ── 写入飞书 ──────────────────────────────────────────
    if (Object.keys(toFill).length === 0) continue;

    if (APPLY) {
      try {
        const res = await reqFeishu('PUT',
          `/open-apis/bitable/v1/apps/${BITABLE}/tables/${TABLE_CASES}/records/${item.recordId}`,
          { fields: toFill }, token);
        if (res.code === 0) {
          const caseId = toFill['用例编号'] || item.currentId || '';
          console.log('  → 已写入飞书 ✅');
          if (caseId) console.log(`[PATCHED] ${caseId}`);
          ok++;
        } else console.log(`  → 写入失败 ❌  code=${res.code} ${res.msg || ''}`);
      } catch(e) {
        console.log('  → 写入异常 ❌  ' + e.message.slice(0, 60));
      }
    } else {
      ok++;  // 预览模式下统计"计划补全"数
    }

    await sleep(600);  // 限速（Dify / SiliconFlow 均适用）
  }

  console.log('\n' + '═'.repeat(55));
  if (APPLY) {
    console.log(`完成！成功写入 ${ok} / ${toProcess.length} 条\n`);
  } else {
    console.log(`预览完成，共 ${ok} 条待补全。`);
    console.log('确认计划无误后执行：');
    console.log('  node patch-cases.js --apply\n');
  }
}

main().catch(e => { console.error('\n❌  ' + e.message); process.exit(1); });
