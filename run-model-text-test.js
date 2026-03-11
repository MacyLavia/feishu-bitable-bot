/**
 * 文本模型测试脚本（通用）
 *
 * 功能：
 *   1. 从「模型测试用例库」读取指定能力类型的用例
 *   2. 默认通过 Dify 工作流调用模型；加 --siliconflow 则走 SiliconFlow 直连
 *   3. 把 Prompt + 模型输出 + 响应时长 写入「模型测试记录」
 *
 * 用法：
 *   node run-model-text-test.js                               查看帮助 / 可用模型
 *   node run-model-text-test.js --model glm-4.5               Dify 跑指定模型
 *   node run-model-text-test.js --ability 文本生成·歌词        只跑指定能力类型（Dify）
 *   node run-model-text-test.js --siliconflow                  走 SiliconFlow 直连（默认 GLM-4.7）
 *   node run-model-text-test.js --siliconflow --model deepseek-ai/DeepSeek-V3
 *
 * 默认批次: 自动生成（YYYYMM-模型名）
 */

const https = require('https');
const { FEISHU_APP_ID, FEISHU_APP_SECRET, SILICONFLOW_KEY } = require('./config');

// ── 配置 ─────────────────────────────────────────────────
const BITABLE          = 'WOyBb34Spa4nTOsevVacMJLTnNg';
const TABLE_CASES      = 'tblSdLU5MjOqzIXp';   // 模型测试用例库
const TABLE_RECORDS    = 'tbleffJEDv4VSd59';   // 模型测试记录

// Dify 工作流配置
const DIFY_API_KEY  = 'app-1kXJtHp5pZL7pzaF4c5eHCu8';
const DIFY_HOST     = '43.160.192.41';
const DIFY_PORT     = 9090;

// ── Dify 文本模型注册表（从共享配置读取）──
// 新增模型：只改 models.config.js，同时在 Dify 工作流加 IF 分支
const { DIFY_TEXT_MODELS, TESTER_NAME } = require('./models.config');

// 解析命令行参数
const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const USE_SF = args.includes('--siliconflow');  // 默认 Dify，加此参数才走 SiliconFlow

const TARGET_MODEL   = getArg('--model')   || (USE_SF ? 'Pro/zai-org/GLM-4.7' : DIFY_TEXT_MODELS[0].model);
const TARGET_ABILITY = getArg('--ability') || null;  // null = 跑全部文本类

// 无参数时显示帮助
if (args.length === 0) {
  console.log('\n用法: node run-model-text-test.js [--model <模型名>] [--ability <能力类型>] [--siliconflow]\n');
  console.log('Dify 文本模型（默认，需在 Dify 工作流配置 IF 分支）:');
  DIFY_TEXT_MODELS.forEach(m => {
    console.log(`  ${m.model.padEnd(30)} 厂商: ${m.vendor}${m.note ? '  (' + m.note + ')' : ''}`);
  });
  console.log('\nSiliconFlow 直连（加 --siliconflow，--model 填 SiliconFlow 模型 ID）:');
  console.log('  默认模型: Pro/zai-org/GLM-4.7');
  console.log('  示例: node run-model-text-test.js --siliconflow --model deepseek-ai/DeepSeek-V3\n');
  process.exit(0);
}

// 模型名 → 飞书供应商选项映射
const VENDOR_MAP = {
  'glm': '智谱', 'qwen': '其他', 'deepseek': '其他',
  'gpt': '其他', 'claude': '其他',
};
function getVendor(model) {
  const m = model.toLowerCase();
  for (const [k, v] of Object.entries(VENDOR_MAP)) if (m.includes(k)) return v;
  return '其他';
}

// 能力类型 → 大类映射（用于能力分类字段）
function getAbilityCategory(abilityType) {
  if (abilityType.startsWith('文本生成') || abilityType.startsWith('文本理解') || abilityType.startsWith('提示词')) return '文本能力';
  if (abilityType.startsWith('视频')) return '视频生成';
  if (abilityType.startsWith('图像')) return '图像生成';
  if (abilityType.startsWith('口型')) return '口型驱动';
  return '其他';
}

// ── 工具函数 ─────────────────────────────────────────────
function req(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : '';
    const h = { 'Content-Type': 'application/json; charset=utf-8' };
    if (b) h['Content-Length'] = Buffer.byteLength(b);
    if (token) h['Authorization'] = 'Bearer ' + token;
    const r = https.request({ hostname: 'open.feishu.cn', path: p, method, headers: h }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d }); } });
    });
    r.on('error', reject); if (b) r.write(b); r.end();
  });
}

function callLLM(model, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
      temperature: 0.7,
    });
    const start = Date.now();
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
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          if (j.error) reject(new Error(j.error.message || JSON.stringify(j.error)));
          else resolve({ text: j.choices[0].message.content, elapsed: parseFloat(elapsed) });
        } catch(e) { reject(e); }
      });
    });
    r.on('error', reject); r.write(body); r.end();
  });
}

const DIFY_TIMEOUT_MS = 60000;  // Dify 文本模型超时（60s）

function callDify(prompt, model) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      inputs: { prompt, model },
      response_mode: 'blocking',
      user: 'test-runner',
    });
    const start = Date.now();
    const r = require('http').request({
      hostname: DIFY_HOST, port: DIFY_PORT,
      path: '/v1/workflows/run', method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + DIFY_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          if (j.data?.status !== 'succeeded') {
            reject(new Error('Dify 执行失败: ' + (j.data?.error || JSON.stringify(j).slice(0, 80))));
          } else {
            // 去掉 GLM 的 <think>...</think> 推理标签
            let text = j.data.outputs?.result || '';
            text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            resolve({ text, elapsed: parseFloat(elapsed) });
          }
        } catch(e) { reject(e); }
      });
    });
    r.setTimeout(DIFY_TIMEOUT_MS, () => { r.destroy(); reject(new Error('Dify 超时（>' + (DIFY_TIMEOUT_MS/1000) + 's）')); });
    r.on('error', reject); r.write(body); r.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function timeTag() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join('');
}

// ── 主流程 ───────────────────────────────────────────────
async function main() {
  const modelShortName = TARGET_MODEL.split('/').pop(); // GLM-4.7
  const batchLabel = new Date().toISOString().slice(0, 7).replace('-', '') + '-' + modelShortName;

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  文本模型测试');
  console.log('  模型: ' + TARGET_MODEL + (USE_SF ? '  [via SiliconFlow]' : '  [via Dify]'));
  console.log('  批次: ' + batchLabel);
  console.log('  能力筛选: ' + (TARGET_ABILITY || '全部文本类'));
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 1: 获取飞书 Token
  process.stdout.write('Step 1  获取飞书授权...');
  const tr = await req('POST', '/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET });
  if (!tr.tenant_access_token) throw new Error('Token 失败');
  const token = tr.tenant_access_token;
  console.log(' ✅');

  // Step 2: 读取测试用例
  process.stdout.write('Step 2  读取测试用例库...');
  const casesRes = await req('GET',
    '/open-apis/bitable/v1/apps/' + BITABLE + '/tables/' + TABLE_CASES + '/records?page_size=100',
    null, token);
  const allCases = casesRes.data && casesRes.data.items || [];

  // 筛选文本类用例
  const textCases = allCases.filter(r => {
    const ability = (typeof r.fields['能力类型'] === 'object'
      ? r.fields['能力类型'].text : r.fields['能力类型']) || '';
    const isText = ability.startsWith('文本') || ability.startsWith('提示词');
    if (TARGET_ABILITY) return ability === TARGET_ABILITY;
    return isText;
  });
  console.log(' ✅  找到 ' + textCases.length + ' 条用例\n');

  if (textCases.length === 0) {
    console.log('❌  没有找到匹配的测试用例，请检查能力类型名称');
    return;
  }

  // Step 3: 逐条调用 GLM-4.7 并写入记录
  console.log('Step 3  开始测试（每条 Prompt → 调用模型 → 写入表格）\n');
  let ok = 0;

  for (const tc of textCases) {
    const f = tc.fields;
    const ability = (typeof f['能力类型'] === 'object' ? f['能力类型'].text : f['能力类型']) || '';
    const caseId  = f['用例编号'] || tc.record_id;
    const prompt  = f['Prompt / 指令'] || '';

    console.log('  ▶ [' + ability + ']  ' + caseId);
    console.log('    Prompt: ' + prompt.slice(0, 60) + (prompt.length > 60 ? '...' : ''));

    // 调用模型
    process.stdout.write('    调用 ' + modelShortName + (USE_SF ? ' [SiliconFlow]' : ' [Dify]') + '...');
    let output = '', elapsed = 0;
    try {
      const result = USE_SF
        ? await callLLM(TARGET_MODEL, prompt)
        : await callDify(prompt, TARGET_MODEL);
      output  = result.text;
      elapsed = result.elapsed;
      console.log(' ✅  (' + elapsed + 's)');
    } catch(e) {
      console.log(' ❌  ' + e.message);
      continue;
    }

    // 展示输出前 100 字
    console.log('    输出预览: ' + output.slice(0, 100).replace(/\n/g, ' ') + (output.length > 100 ? '...' : ''));

    // 等待网络稳定后再写飞书（长时 HTTP 连接后 TLS 需要缓冲）
    await sleep(USE_SF ? 500 : 1500);

    // 写入飞书多维表格（失败自动重试 3 次）
    const recordId = 'REC-' + modelShortName + '-' + timeTag();
    const fields = {
      '记录ID':         recordId,
      '模型名称':        modelShortName,
      '能力类型':        ability,
      '供应商':          getVendor(TARGET_MODEL),
      '测试时间':        Date.now(),
      '批次标签':        batchLabel,
      'Prompt / 指令':  prompt,
      '响应时长(秒)':    elapsed,
      '输出结果文本':    output,
      '测试人':          [TESTER_NAME],
      '关联用例':        [tc.record_id],
    };

    let written = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const writeRes = await req('POST',
          '/open-apis/bitable/v1/apps/' + BITABLE + '/tables/' + TABLE_RECORDS + '/records',
          { fields }, token);
        if (writeRes.code === 0) {
          console.log('    写入飞书 ✅  record_id=' + writeRes.data.record.record_id);
          ok++; written = true; break;
        } else {
          console.log('    写入失败 ❌  code=' + writeRes.code + ' ' + (writeRes.msg || ''));
          break;
        }
      } catch(e) {
        if (attempt < 3) {
          console.log('    写入异常，2s 后重试（' + attempt + '/3）: ' + e.message.slice(0, 60));
          await sleep(2000);
        } else {
          console.log('    写入失败（已重试3次）❌  ' + e.message.slice(0, 60));
        }
      }
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('  测试完成！成功写入 ' + ok + ' / ' + textCases.length + ' 条记录');
  console.log('');
  console.log('  下一步 →');
  console.log('  1. 打开飞书多维表格，找到批次「' + batchLabel + '」');
  console.log('     查看「人工结论备注」里的模型输出');
  console.log('  2. 运行 AI 自动评分：node ai-scoring.js');
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(e => { console.error('\n❌  ' + e.message); process.exit(1); });
