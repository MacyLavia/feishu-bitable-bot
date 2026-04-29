/**
 * 图像 / 视频生成模型测试脚本（统一入口）
 *
 * 所有模型通过 Dify 工作流调用，结果下载后以附件形式写入飞书。
 * 新增模型：在 MODEL_REGISTRY 加一行，Dify 工作流加一个 IF 分支。
 *
 * 用法：
 *   node run-media-test.js --model midjourney
 *   node run-media-test.js --model doubao-seedance-1-0-lite-t2v
 *   node run-media-test.js --model midjourney --ability 图像生成·文本
 *   node run-media-test.js --model midjourney --case TC-IMG-TXT-002
 */

const https = require('https');
const http  = require('http');
const {
  FEISHU_APP_ID, FEISHU_APP_SECRET,
  DIFY_HOST, DIFY_PORT, DIFY_UNIFIED_KEY,
} = require('./config');

// ── 飞书配置 ──────────────────────────────────────────────
const BITABLE          = 'WOyBb34Spa4nTOsevVacMJLTnNg';
const TABLE_CASES      = 'tblSdLU5MjOqzIXp';
const TABLE_RECORDS    = 'tbleffJEDv4VSd59';

// ── 媒体模型统一调用：所有图像/视频/口型走运营组工作流（DIFY_UNIFIED_KEY）─
// 入参契约：基础 { type, prompt, model, image_url, video_url, audio_url } + cfg.extraInputs
// 输出契约：outputs.file_url
//
// 注意每个模型的「内部 tool」按 model 字段值再分支选用其中之一：
//   - i2v / r2v / 图生图：读 image_url
//   - video-edit / 视频续写 / 运镜 等：读 video_url
//   - 口型驱动：读 audio_url（+ image_url 或 video_url）
// 不需要的字段传空字符串即可，运营组工作流接收所有字段（user_input_form 都标 optional）
function buildUnifiedInputs(cfg, prompt, imageUrl, videoUrl, audioUrl) {
  return {
    type:      cfg.type,
    prompt,
    model:     cfg.difyModelId,
    image_url: imageUrl || '',
    video_url: videoUrl || '',
    audio_url: audioUrl || '',
    ...(cfg.extraInputs || {}),  // 合并模型特异参数
  };
}

// ── 模型注册表（从共享配置读取）──────────────────────────
// 新增模型：只改 models.config.js，同时在 Dify 工作流加 IF 分支
const { MODEL_REGISTRY, TESTER_NAME } = require('./models.config');

// ── 命令行参数 ─────────────────────────────────────────────
const args           = process.argv.slice(2);
const getArg         = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const TARGET_MODEL   = getArg('--model');
const TARGET_ABILITY = getArg('--ability') || null;
const TARGET_CASE    = getArg('--case')    || null;  // 指定用例编号，如 TC-IMG-TXT-002

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

function callDify(difyKey, inputs, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ inputs, response_mode: 'blocking', user: 'test-runner' });
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
        try {
          const j = JSON.parse(d);
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          if (j.data?.status !== 'succeeded') {
            reject(new Error('Dify 失败: ' + (j.data?.error || JSON.stringify(j).slice(0, 100))));
          } else {
            // 运营组工作流用 outputs.file_url；兼容旧 dev_huang_* 工作流的 outputs.result（过渡期保留）
            const url = j.data.outputs?.file_url || j.data.outputs?.result || '';
            // 工作流 status=succeeded 不代表生成成功 — 工具内部错误会写到 outputs.error
            // 典型场景：内容审核失败(Green net)、模型 API Pydantic 验错、上游下载超时
            const toolError = j.data.outputs?.error || '';
            if (!url && toolError) {
              reject(new Error('工具内错: ' + toolError));
            } else {
              resolve({ url, elapsed: parseFloat(elapsed) });
            }
          }
        } catch(e) { reject(e); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Dify 超时（>' + (timeoutMs/1000) + 's）')); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Dify 调用带重试（最多 3 次，间隔 10s / 20s）
const DIFY_MAX_RETRIES = 3;
async function callDifyWithRetry(difyKey, inputs, timeoutMs, label) {
  for (let attempt = 1; attempt <= DIFY_MAX_RETRIES; attempt++) {
    try {
      return await callDify(difyKey, inputs, timeoutMs);
    } catch (e) {
      if (attempt < DIFY_MAX_RETRIES) {
        const wait = attempt * 10;
        console.log(`\n    ⚠️  第 ${attempt} 次失败（${e.message.slice(0, 60)}），${wait}s 后重试...`);
        await sleep(wait * 1000);
        process.stdout.write('    重试 ' + label + '...');
      } else {
        throw e;
      }
    }
  }
}
function timeTag() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join('');
}

// 从飞书附件字段的 file_token 获取临时下载 URL
async function getAttachmentTmpUrl(fileToken, token) {
  const res = await reqFeishu('GET',
    `/open-apis/drive/v1/medias/batch_get_tmp_download_url?file_tokens=${fileToken}`,
    null, token);
  if (res.code === 0 && res.data?.tmp_download_urls?.length > 0) {
    return res.data.tmp_download_urls[0].tmp_download_url;
  }
  return '';
}

// 下载 URL 内容为 Buffer（支持 http/https 重定向）
function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// 下载媒体文件并上传到飞书 Bitable 附件，返回 file_token
async function uploadFileToFeishu(mediaUrl, filename, mimeType, token) {
  const buf = await downloadBuffer(mediaUrl);
  const boundary = 'FormBoundary' + Date.now();

  const textParts = [
    ['file_name',   filename],
    ['parent_type', 'bitable_file'],
    ['parent_node', BITABLE],
    ['size',        String(buf.length)],
  ].map(([name, val]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`
  ).join('');

  const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const body = Buffer.concat([
    Buffer.from(textParts),
    Buffer.from(fileHeader),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'open.feishu.cn',
      path: '/open-apis/drive/v1/medias/upload_all',
      method: 'POST',
      headers: {
        'Authorization':  'Bearer ' + token,
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.code === 0) resolve(j.data.file_token);
          else reject(new Error('上传失败: ' + (j.msg || JSON.stringify(j).slice(0, 120))));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── 主流程 ────────────────────────────────────────────────
async function main() {
  if (!TARGET_MODEL) {
    console.log('\n用法: node run-media-test.js --model <模型名> [--ability <能力类型>]\n');
    console.log('可用模型:');
    Object.keys(MODEL_REGISTRY).forEach(m => {
      const cfg = MODEL_REGISTRY[m];
      console.log(`  ${m}`);
      console.log(`      输出字段: ${cfg.outputField}`);
      console.log(`      匹配用例: ${cfg.abilities.join(', ')}`);
      console.log(`      超时设置: ${cfg.timeout / 1000}s`);
    });
    process.exit(0);
  }

  const cfg = MODEL_REGISTRY[TARGET_MODEL];
  if (!cfg) {
    console.error(`\n❌  未知模型「${TARGET_MODEL}」，请检查 MODEL_REGISTRY`);
    process.exit(1);
  }

  const batchLabel = new Date().toISOString().slice(0, 7).replace('-', '') + '-' + TARGET_MODEL;
  const mediaType  = cfg.outputField.includes('图像') ? '图像' : cfg.outputField.includes('音频') ? '音频' : '视频';

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ' + mediaType + '生成模型测试');
  console.log('  模型: ' + TARGET_MODEL);
  console.log('  批次: ' + batchLabel);
  console.log('  能力筛选: ' + (TARGET_ABILITY || cfg.abilities.join(' / ')));
  console.log('  超时设置: ' + (cfg.timeout / 1000) + 's');
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 1: 飞书授权
  process.stdout.write('Step 1  获取飞书授权...');
  const tr = await reqFeishu('POST', '/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET });
  if (!tr.tenant_access_token) throw new Error('飞书 Token 失败');
  const token = tr.tenant_access_token;
  console.log(' ✅');

  // Step 2: 读取测试用例
  process.stdout.write('Step 2  读取测试用例库...');
  const casesRes = await reqFeishu('GET',
    `/open-apis/bitable/v1/apps/${BITABLE}/tables/${TABLE_CASES}/records?page_size=100`,
    null, token);
  const allCases = casesRes.data?.items || [];

  const matchAbilities = TARGET_ABILITY ? [TARGET_ABILITY] : cfg.abilities;
  const cases = allCases.filter(r => {
    const ability = (typeof r.fields['能力类型'] === 'object'
      ? r.fields['能力类型'].text : r.fields['能力类型']) || '';
    const caseId  = r.fields['用例编号'] || r.record_id;
    if (TARGET_CASE) return caseId === TARGET_CASE;
    return matchAbilities.includes(ability);
  });
  console.log(` ✅  找到 ${cases.length} 条用例（${matchAbilities.join(' / ')}）\n`);

  if (cases.length === 0) {
    console.log('❌  没有匹配的测试用例，请检查能力类型');
    return;
  }

  // Step 3: 逐条测试
  console.log('Step 3  开始测试\n');
  let ok = 0;

  for (const tc of cases) {
    const f      = tc.fields;
    const ability = (typeof f['能力类型'] === 'object' ? f['能力类型'].text : f['能力类型']) || '';
    const caseId  = f['用例编号'] || tc.record_id;
    const prompt  = Array.isArray(f['Prompt / 指令'])
      ? f['Prompt / 指令'].map(t => t.text).join('') : (f['Prompt / 指令'] || '');

    // 读取所有可能的输入附件 — 工作流根据模型自己选用哪个
    async function getAttachmentUrl(fieldName) {
      const att = f[fieldName];
      if (!Array.isArray(att) || att.length === 0) return '';
      const fileToken = att[0].file_token;
      return fileToken ? await getAttachmentTmpUrl(fileToken, token) : '';
    }
    const imageUrl = await getAttachmentUrl('输入图像附件');
    const videoUrl = await getAttachmentUrl('输入视频附件');
    const audioUrl = await getAttachmentUrl('输入音频附件');

    console.log(`  ▶ [${ability}]  ${caseId}`);
    console.log('    Prompt: ' + prompt.slice(0, 80) + (prompt.length > 80 ? '...' : ''));
    if (imageUrl) console.log('    输入图: ' + imageUrl.slice(0, 80));
    if (videoUrl) console.log('    输入视频: ' + videoUrl.slice(0, 80));
    if (audioUrl) console.log('    输入音频: ' + audioUrl.slice(0, 80));

    // 调用 Dify（带重试）—— 统一走运营组工作流
    // 飞书 internal URL 直接传给工作流：运营工作流内部能拉飞书附件，无需中转
    process.stdout.write(`    调用 ${TARGET_MODEL} → ${cfg.difyModelId}...`);
    let mediaUrl = '', elapsed = 0;
    try {
      const result = await callDifyWithRetry(
        DIFY_UNIFIED_KEY,
        buildUnifiedInputs(cfg, prompt, imageUrl, videoUrl, audioUrl),
        cfg.timeout, TARGET_MODEL
      );
      mediaUrl = result.url;
      elapsed  = result.elapsed;
      console.log(` ✅  (${elapsed}s)`);
    } catch(e) {
      console.log(` ❌  ${e.message}`);
      continue;
    }

    if (!mediaUrl) {
      console.log('    ⚠️  返回 URL 为空，跳过写入');
      continue;
    }
    console.log('    URL: ' + mediaUrl.slice(0, 80) + '...');

    await sleep(1500);

    // 下载并上传到飞书附件字段
    const filename = `${caseId}-${TARGET_MODEL}-${Date.now()}.${cfg.ext}`;
    process.stdout.write(`    上传${mediaType}到飞书...`);
    let fileToken;
    try {
      fileToken = await uploadFileToFeishu(mediaUrl, filename, cfg.mimeType, token);
      console.log(' ✅');
    } catch(e) {
      console.log(` ❌  ${e.message}`);
      continue;
    }

    // 写入飞书（重试 3 次）
    const fields = {
      '记录ID':          'REC-' + TARGET_MODEL + '-' + timeTag(),
      '模型名称':         TARGET_MODEL,
      '能力类型':         ability,
      '供应商':           '其他',
      '测试时间':         Date.now(),
      '批次标签':         batchLabel,
      'Prompt / 指令':   prompt,
      '响应时长(秒)':     elapsed,
      [cfg.outputField]: [{ file_token: fileToken }],
      '测试人':           [TESTER_NAME],
      '关联用例':         [tc.record_id],
    };

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const writeRes = await reqFeishu('POST',
          `/open-apis/bitable/v1/apps/${BITABLE}/tables/${TABLE_RECORDS}/records`,
          { fields }, token);
        if (writeRes.code === 0) {
          console.log('    写入飞书 ✅  record_id=' + writeRes.data.record.record_id);
          console.log('[RECORD] ' + fields['记录ID']);
          ok++; break;
        } else {
          console.log(`    写入失败 ❌  code=${writeRes.code} ${writeRes.msg || ''}`);
          break;
        }
      } catch(e) {
        if (attempt < 3) {
          console.log(`    写入异常，2s 后重试（${attempt}/3）`);
          await sleep(2000);
        } else {
          console.log('    写入失败（已重试3次）❌  ' + e.message.slice(0, 60));
        }
      }
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log(`  完成！成功写入 ${ok} / ${cases.length} 条记录`);
  console.log(`  批次标签: ${batchLabel}`);
  console.log('');
  console.log('  下一步 →');
  console.log(`  打开飞书多维表格 → 找到批次 → 点击「${cfg.outputField}」查看结果`);
  console.log('  运行 AI 自动评分：node ai-scoring.js');
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(e => { console.error('\n❌  ' + e.message); process.exit(1); });
