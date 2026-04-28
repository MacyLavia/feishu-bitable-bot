/**
 * Dify 工作流 smoke 测试
 *
 * 给定模型注册 key，发一条最短 prompt 到 Dify 工作流，验证：
 *   ✅  IF 分支已接好（输出附件 URL 非空）
 *   ⚠️  Dify 200 但输出为空（IF 分支没匹配上 model 字段）
 *   ❌  超时 / HTTP 错误（凭据 / 网络 / 工作流挂了）
 *
 * 不写飞书、不下载文件、不改任何状态，纯调用 + 解析。
 *
 * 用法:
 *   # 走已注册模型（读 models.config.js + 凭据从 .env 加载）
 *   node scripts/dify-smoke-test.js --model gpt-image-2-打开科技
 *
 *   # 探测统一工作流（用 .env 里的 DIFY_UNIFIED_KEY，自定义 inputs）
 *   node scripts/dify-smoke-test.js --unified --inputs '{"type":"image","prompt":"...","model":"gpt-image-2"}'
 *
 *   # 显式传 key（仅当 .env 还没配，不要在 commit 里出现明文）
 *   node scripts/dify-smoke-test.js --key app-xxxxx --inputs '{...}'
 *
 * 退出码: 0 = ✅ ; 2 = ⚠️ ; 1 = ❌
 */

const http = require('http');
const { DIFY_HOST, DIFY_PORT, DIFY_UNIFIED_KEY } = require('../config');

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const TARGET = getArg('--model');
const RAW_KEY = getArg('--key');
const USE_UNIFIED = args.includes('--unified');
const RAW_INPUTS = getArg('--inputs');
const PROMPT = getArg('--prompt') || '一只红苹果';
const TIMEOUT_S = parseInt(getArg('--timeout') || '30', 10);

let smokeKey, smokeInputs;
if (RAW_KEY || USE_UNIFIED) {
  smokeKey = RAW_KEY || DIFY_UNIFIED_KEY;
  if (!smokeKey) {
    console.error('❌  --unified 模式但 .env 里 DIFY_UNIFIED_KEY 为空');
    process.exit(1);
  }
  try { smokeInputs = RAW_INPUTS ? JSON.parse(RAW_INPUTS) : { prompt: PROMPT }; }
  catch (e) { console.error('❌  --inputs 不是合法 JSON:', e.message); process.exit(1); }
} else if (TARGET) {
  const { MODEL_REGISTRY } = require('../models.config');
  const cfg = MODEL_REGISTRY[TARGET];
  if (!cfg) {
    console.error(`❌  models.config.js 中找不到「${TARGET}」`);
    console.error(`    已注册：${Object.keys(MODEL_REGISTRY).join(', ')}`);
    process.exit(1);
  }
  if (!DIFY_UNIFIED_KEY) {
    console.error('❌  .env 里 DIFY_UNIFIED_KEY 为空，无法调用运营组工作流');
    process.exit(1);
  }
  smokeKey = DIFY_UNIFIED_KEY;
  smokeInputs = {
    type: cfg.type,
    prompt: PROMPT,
    model: cfg.difyModelId,
    image_url: '',
    ...(cfg.extraInputs || {}),  // 合并模型特异参数（如 quality_mode）
  };
} else {
  console.error('用法:');
  console.error('  node scripts/dify-smoke-test.js --model <模型 key>');
  console.error('  node scripts/dify-smoke-test.js --unified --inputs \'{"type":"image","prompt":"...","model":"..."}\'');
  console.error('  node scripts/dify-smoke-test.js --key app-xxxxx --inputs \'{...}\'  (调试用，避免明文)');
  process.exit(1);
}

function callDify(difyKey, inputs, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ inputs, response_mode: 'blocking', user: 'smoke-test' });
    const start = Date.now();
    const req = http.request({
      hostname: DIFY_HOST, port: DIFY_PORT,
      path: '/v1/workflows/run', method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + difyKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        try { resolve({ status: res.statusCode, json: JSON.parse(d), elapsed: parseFloat(elapsed) }); }
        catch (e) { resolve({ status: res.statusCode, raw: d, elapsed: parseFloat(elapsed) }); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`超时（>${timeoutMs / 1000}s）`)); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Dify smoke test');
  console.log('  模型 key      : ' + (TARGET || '(--key/--unified 模式)'));
  console.log('  Dify type 字段 : ' + (smokeInputs.type || '(未指定)'));
  console.log('  Dify model 字段: ' + (smokeInputs.model || '(未指定)'));
  console.log('  prompt        : ' + PROMPT);
  console.log('  timeout       : ' + TIMEOUT_S + 's');
  console.log('═══════════════════════════════════════════════════════\n');

  let res;
  try {
    res = await callDify(smokeKey, smokeInputs, TIMEOUT_S * 1000);
  } catch (e) {
    console.log(`❌  ${e.message}`);
    console.log('\n可能原因：网络不通 / Dify 服务挂了 / difyKey 不对');
    process.exit(1);
  }

  console.log(`HTTP ${res.status}  耗时 ${res.elapsed}s`);

  if (res.status !== 200) {
    console.log(`❌  Dify 返回非 200`);
    console.log('Body:', JSON.stringify(res.json || res.raw, null, 2).slice(0, 500));
    process.exit(1);
  }

  const data = res.json?.data;
  if (!data) {
    console.log('❌  响应缺少 data 字段');
    console.log('Body:', JSON.stringify(res.json, null, 2).slice(0, 500));
    process.exit(1);
  }

  if (data.status === 'failed' || data.error) {
    console.log(`❌  Dify 工作流执行失败`);
    console.log('error:', data.error);
    console.log('outputs:', JSON.stringify(data.outputs, null, 2).slice(0, 500));
    process.exit(1);
  }

  // 兼容两种输出契约：旧 dev_huang_* 工作流用 outputs.result，新统一工作流用 outputs.file_url
  const result = data.outputs?.result || data.outputs?.file_url;
  if (!result || result === '') {
    console.log(`⚠️  Dify 200 但输出为空（IF 分支可能没匹配上）`);
    console.log('outputs:', JSON.stringify(data.outputs, null, 2));
    console.log('\n排查方向：');
    console.log(`  1. 运营组工作流 IF 分支匹配的是不是 type="${smokeInputs.type}" + model="${smokeInputs.model}"？`);
    console.log(`  2. Dify URL: http://${DIFY_HOST}:${DIFY_PORT}/app/<工作流ID>/workflow`);
    console.log(`  3. 飞书侧「模型 ID」字段是否跟运营组工作流命名一致？`);
    process.exit(2);
  }

  console.log(`✅  Dify IF 分支已接好`);
  console.log(`    输出 URL: ${String(result).slice(0, 120)}${String(result).length > 120 ? '...' : ''}`);
  console.log(`\n下一步可跑：node run-media-test.js --model ${TARGET}`);
  process.exit(0);
}

main().catch(e => { console.error('\n❌  ' + e.message); process.exit(1); });
