/**
 * AI 自动评分 — 使用 Dify 文本生成工作流对测试记录打分
 *
 * 评分维度（1-5 分整数）：
 *   - 指令遵循度：模型输出是否按 Prompt 要求作答
 *   - 综合评分：输出内容的整体质量（语言/逻辑/完整度）
 *
 * 说明：
 *   - 文本类任务（文本生成/文本理解/提示词）：对比 Prompt 和「输出结果文本」评分
 *   - 图像/视频/口型类任务：无文本输出，仅评估 Prompt 描述质量
 *   - AI 后端：默认走 Dify（dev_huang_文本生成），加 --siliconflow 走直连
 *
 * 用法：
 *   node ai-scoring.js                   只评文本类（文本生成/文本理解/提示词），未评分的
 *   node ai-scoring.js --include-media   同时评图像/视频/口型类记录
 *   node ai-scoring.js --limit 10        只处理 10 条（测试用）
 *   node ai-scoring.js --all             强制对所有记录重新评分
 *   node ai-scoring.js --batch 202506    只评分指定批次标签
 *   node ai-scoring.js --siliconflow     走 SiliconFlow 直连
 */

const https = require('https');
const { isTextAbility } = require('./models.config');
const { FEISHU_APP_ID: APP_ID, FEISHU_APP_SECRET: APP_SECRET, SILICONFLOW_KEY } = require('./config');

// ── 飞书配置 ──────────────────────────────────────────────
const BITABLE       = 'WOyBb34Spa4nTOsevVacMJLTnNg';
const TABLE_RECORDS = 'tbleffJEDv4VSd59';
const TABLE_CASES   = 'tblSdLU5MjOqzIXp';

// ── Dify 配置 ─────────────────────────────────────────────
const DIFY_KEY        = 'app-1kXJtHp5pZL7pzaF4c5eHCu8';
const DIFY_HOST       = '43.160.192.41';
const DIFY_PORT       = 9090;
const DIFY_SCORE_MODEL = 'glm-4.5';   // 评分用的文本模型

// ── SiliconFlow 备用 ──────────────────────────────────────
const SILICONFLOW_MODEL = 'Qwen/Qwen2.5-7B-Instruct';

// ── 命令行参数 ────────────────────────────────────────────
const _args     = process.argv.slice(2);
const _hasFlag  = f => _args.includes(f);
const _getArg   = n => { const i = _args.indexOf(n); return i >= 0 ? _args[i + 1] : null; };

const FORCE_ALL     = _hasFlag('--all');
const USE_SF        = _hasFlag('--siliconflow');
const DEBUG         = _hasFlag('--debug');
const INCLUDE_MEDIA = _hasFlag('--include-media');
const LIMIT         = _getArg('--limit') ? parseInt(_getArg('--limit')) : Infinity;
const BATCH_LABEL   = _getArg('--batch') || null;

// ── 工具函数 ──────────────────────────────────────────────
function reqHttps(method, hostname, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    if (token)   headers['Authorization']  = `Bearer ${token}`;
    const r = https.request({ hostname, path, method, headers }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d }); } });
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 重试包装：网络瞬时错误自动重试，最多 3 次，指数退避
async function withRetry(fn, retries = 3, label = '') {
  for (let i = 1; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      const isNetwork = /socket hang up|ECONNRESET|ECONNREFUSED|TLS|network socket/i.test(e.message);
      if (isNetwork && i < retries) {
        const wait = i * 3000;
        process.stdout.write(` [网络错误，${wait/1000}s 后重试 ${i}/${retries-1}]`);
        await sleep(wait);
      } else {
        throw e;
      }
    }
  }
}

// ── Dify 调用（dev_huang_文本生成）────────────────────────
function callDify(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      inputs: { prompt, model: DIFY_SCORE_MODEL },
      response_mode: 'blocking',
      user: 'ai-scoring',
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
    r.setTimeout(60000, () => { r.destroy(); reject(new Error('Dify 超时（>60s）')); });
    r.on('error', reject); r.write(body); r.end();
  });
}

// ── SiliconFlow 调用（备用）──────────────────────────────
function callSiliconFlow(systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: SILICONFLOW_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: 200,
      temperature: 0.1,
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
          if (j.error) reject(new Error(j.error.message));
          else resolve(j.choices[0].message.content.trim());
        } catch(e) { reject(e); }
      });
    });
    r.on('error', reject); r.write(body); r.end();
  });
}

// ── 统一 AI 调用入口 ──────────────────────────────────────
function callAI(systemPrompt, userPrompt) {
  if (USE_SF) return callSiliconFlow(systemPrompt, userPrompt);
  // Dify：合并 system + user（工作流只接受单个 prompt）
  return callDify(systemPrompt + '\n\n' + userPrompt);
}

// isTextAbility() 已统一到 models.config.js，此处直接使用 require 导入的版本

// ── 解析 getStr（飞书字段可能是数组或对象）──────────────
function getStr(field) {
  if (!field) return '';
  if (Array.isArray(field)) return field.map(s => s.text || '').join('').trim();
  if (typeof field === 'object') return field.text || '';
  return String(field).trim();
}

// ── AI 评分核心逻辑 ───────────────────────────────────────
async function aiEvaluate(fields, criteria) {
  const model    = getStr(fields['模型名称']) || '未知模型';
  const ability  = getStr(fields['能力类型']) || '未知能力';
  const prompt   = getStr(fields['Prompt / 指令']).slice(0, 400);
  const output   = getStr(fields['输出结果文本']).slice(0, 800);

  const isText = isTextAbility(ability);

  const systemPrompt = isText
    ? '你是严格的文本内容质量评估专家。请客观、严格地打分，不要偏向高分。只输出 JSON，不要多余文字。'
    : '你是严格的 AI 图像/视频/音频生成模型评测专家。请客观、严格地打分，不要偏向高分。只输出 JSON，不要多余文字。';

  const userPrompt = isText
    ? `严格评估以下文本模型输出，不要轻易给满分：

模型：${model}
任务类型：${ability}

【Prompt 要求】
${prompt || '（无 Prompt）'}

【参考标准 / 期望效果】
${criteria || '（无参考标准，请依据 Prompt 要求严格评判）'}

【模型实际输出】
${output || '（无输出，应给 1 分）'}

请逐项对照「Prompt 要求」和「参考标准」与「模型实际输出」比较后评分。
输出 JSON（每项 1-5 分整数）：
{"指令遵循度":分数,"综合评分":分数,"评分说明":"20字以内，指出不足之处"}

评分标准（请严格执行，5分须完全达到标准）：
- 指令遵循度：5=完全满足所有格式/内容要求，4=基本满足，3=部分满足，2=仅满足少量要求，1=偏题或无输出
- 综合评分：综合内容质量、完整度、与期望效果的差距打分`.trim()
    : `严格评估以下图像/视频生成测试记录，不要轻易给满分：

模型：${model}
能力类型：${ability}

【Prompt】
${prompt || '（无 Prompt）'}

【参考标准 / 期望效果】
${criteria || '（无参考标准，请依据 Prompt 描述清晰度评判）'}

${output ? `【补充说明】\n${output}` : '（无文本输出）'}

输出 JSON（每项 1-5 分整数）：
{"指令遵循度":分数,"综合评分":分数,"评分说明":"20字以内，指出不足之处"}

评分标准（请严格执行）：
- 指令遵循度：Prompt 描述是否清晰完整、符合该能力类型要求（5=极清晰，3=一般，1=描述不足）
- 综合评分：综合 Prompt 质量、参考标准匹配度综合打分`.trim();

  const raw = await callAI(systemPrompt, userPrompt);
  const m = raw.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*?\}/);
  if (!m) throw new Error('无法解析 JSON: ' + raw.slice(0, 80));
  const scored = JSON.parse(m[0]);

  return {
    instrScore:   Math.min(5, Math.max(1, Number(scored['指令遵循度']) || 3)),
    overallScore: Math.min(5, Math.max(1, Number(scored['综合评分'])   || 3)),
    reason:       scored['评分说明'] || '已评分',
  };
}

// ── 飞书 Token ────────────────────────────────────────────
async function getFeishuToken() {
  const res = await reqHttps('POST', 'open.feishu.cn',
    '/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: APP_ID, app_secret: APP_SECRET });
  if (!res.tenant_access_token) throw new Error('飞书 Token 失败');
  return res.tenant_access_token;
}

// ── 读取表格全部记录（支持翻页）─────────────────────────
async function getAllRecords(token, tableId) {
  const records = [];
  let pageToken = '';
  do {
    const url = `/open-apis/bitable/v1/apps/${BITABLE}/tables/${tableId}/records?page_size=100`
              + (pageToken ? '&page_token=' + pageToken : '');
    const res = await reqHttps('GET', 'open.feishu.cn', url, null, token);
    if (res.code !== 0) throw new Error('读取记录失败: ' + JSON.stringify(res));
    (res.data?.items || []).forEach(r => records.push(r));
    pageToken = res.data?.has_more ? res.data.page_token : '';
  } while (pageToken);
  return records;
}

// ── 构建用例 record_id → 参考标准 的查找表 ───────────────
async function buildCriteriaMap(token) {
  const cases = await getAllRecords(token, TABLE_CASES);
  const map = {};
  for (const c of cases) {
    map[c.record_id] = getStr(c.fields['参考标准 / 期望效果']);
  }
  return map;
}

// ── 写入评分到飞书 ────────────────────────────────────────
async function updateRecord(token, recordId, fields) {
  const res = await reqHttps('PUT', 'open.feishu.cn',
    `/open-apis/bitable/v1/apps/${BITABLE}/tables/${TABLE_RECORDS}/records/${recordId}`,
    { fields }, token);
  return res.code === 0;
}

// ── 主流程 ────────────────────────────────────────────────
async function main() {
  const backendLabel = USE_SF ? 'SiliconFlow · Qwen2.5-7B' : `Dify · ${DIFY_SCORE_MODEL}`;
  console.log(`\n🤖 AI 自动评分  ·  后端: ${backendLabel}\n`);

  const token = await getFeishuToken();
  console.log('✅ 飞书 Token OK');

  // 预加载用例库，构建 record_id → 参考标准 查找表
  process.stdout.write('📚 加载用例库...');
  const criteriaMap = await buildCriteriaMap(token);
  console.log(` ✅  共 ${Object.keys(criteriaMap).length} 条用例`);

  const allRecords = await getAllRecords(token, TABLE_RECORDS);
  console.log(`📋 共 ${allRecords.length} 条测试记录`);

  // 筛选待评分记录
  let toScore = allRecords.filter(r => {
    // 默认只评文本类；加 --include-media 才评图像/视频/口型
    const ability = getStr(r.fields['能力类型']);
    if (!INCLUDE_MEDIA && !isTextAbility(ability)) return false;

    if (FORCE_ALL) return true;
    const scored = r.fields['AI自动评分'];
    return !scored || scored === 0;
  });

  // 按批次筛选
  if (BATCH_LABEL) {
    toScore = toScore.filter(r => getStr(r.fields['批次标签']) === BATCH_LABEL);
  }

  toScore = toScore.slice(0, LIMIT);

  const scopeLabel = INCLUDE_MEDIA ? '全部类型' : '文本类';
  console.log(`🎯 待评分: ${toScore.length} 条 [${scopeLabel}]${FORCE_ALL ? '（强制重评）' : ''}${BATCH_LABEL ? `（批次: ${BATCH_LABEL}）` : ''}\n`);

  if (toScore.length === 0) {
    console.log('✅ 无需评分。使用 --all 强制重评，--batch 指定批次。');
    return;
  }

  let ok = 0, fail = 0;
  const start = Date.now();

  for (let i = 0; i < toScore.length; i++) {
    const r      = toScore[i];
    const model  = getStr(r.fields['模型名称']) || '?';
    const ability = getStr(r.fields['能力类型']) || '?';

    const recordId = getStr(r.fields['记录ID']) || r.record_id;
    process.stdout.write(`[${i + 1}/${toScore.length}] ${recordId} | ${model} | ${ability} ... `);

    try {
      // 取关联用例的第一条，查参考标准
      const linkedCases = r.fields['关联用例'];

      // 兼容两种格式：关联记录字段返回 [{record_id,text}]；普通文本返回 [string]
      let caseId = '';
      if (Array.isArray(linkedCases) && linkedCases.length > 0) {
        const first = linkedCases[0];
        caseId = (typeof first === 'object') ? (first.record_id || first.id || '') : String(first);
      }

      if (DEBUG && i === 0) {
        console.log('\n[DEBUG] 关联用例原始值:', JSON.stringify(linkedCases));
        console.log('[DEBUG] 解析出 caseId:', caseId);
        console.log('[DEBUG] criteriaMap 样例 key:', Object.keys(criteriaMap).slice(0, 2));
      }

      const criteria = caseId ? (criteriaMap[caseId] || '') : '';
      const scored = await withRetry(() => aiEvaluate(r.fields, criteria));
      const note   = `指令遵循:${scored.instrScore}/5  综合:${scored.overallScore}/5 — ${scored.reason}`;

      const written = await updateRecord(token, r.record_id, {
        'AI自动评分': scored.overallScore,
        'AI评分说明': note,
      });

      if (written) {
        console.log(`✅  ${note}`);
        console.log(`[SCORED] ${recordId}`);
        ok++;
      } else {
        console.log('⚠️  写入失败');
        fail++;
      }
    } catch(e) {
      console.log(`❌  ${e.message.slice(0, 60)}`);
      fail++;
    }

    await sleep(USE_SF ? 400 : 1200);  // Dify 比 SiliconFlow 慢，多等一点
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log('\n' + '═'.repeat(55));
  console.log(`完成！成功: ${ok}  失败: ${fail}  耗时: ${elapsed}s\n`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
