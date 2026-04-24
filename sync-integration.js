// 正式同步：扫 dify-extension main + develop 两个分支 → 提取 model_id
//          读飞书「模型清单」表 → 写回「接入状态」字段（已接入 / 接入中 / 已下线）
// 执行即写入，无 dry-run 模式。需要 dry 效果去改完 push 前自己 git diff 就行。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const lark = require('@larksuiteoapi/node-sdk');
const { FEISHU_APP_ID, FEISHU_APP_SECRET } = require('./config');

const DIFY_ROOT = path.join(process.env.HOME, 'claude_projects/dify-extension');
const SCAN_DIRS = ['atmob_image/tools', 'atmob_image/schemas', 'atmob_video/tools', 'atmob_video/schemas'];
const BITABLE = 'IzlCbNPjbaF38As26IJcSd47nKh';
const TABLE   = 'tbloWaN3VqosiudO';

// ── 步骤 1：git fetch 更新远程 refs（不动工作区）──
function gitFetch() {
  try {
    execSync(`git -C "${DIFY_ROOT}" fetch origin main develop`, { stdio: 'pipe' });
    console.log('✅ git fetch origin main develop 完成\n');
  } catch (e) {
    console.warn(`⚠️ git fetch 失败，将使用本地已有 refs: ${e.message.split('\n')[0]}\n`);
  }
}

// ── 步骤 2：从指定 ref 抽所有 py 里的 model_id ──
function extractModelsFromSrc(src) {
  const ids = new Set();
  for (const m of src.matchAll(/^(?:model_name|MODEL_NAME)\s*=\s*["']([^"']+)["']/gm)) ids.add(m[1]);
  for (const m of src.matchAll(/ModelType\s*=\s*Literal\[([^\]]+)\]/g))
    for (const s of m[1].matchAll(/["']([^"']+)["']/g)) ids.add(s[1]);
  for (const m of src.matchAll(/model\s*:\s*Literal\[([^\]]+)\]/g))
    for (const s of m[1].matchAll(/["']([^"']+)["']/g)) ids.add(s[1]);
  for (const m of src.matchAll(/MODEL_ID_MAP[^{]*\{([\s\S]*?)\}/g))
    for (const s of m[1].matchAll(/["']([^"']+)["']/g)) ids.add(s[1]);
  for (const m of src.matchAll(/MODEL_BASE_URLS[^{]*\{([\s\S]*?)\}/g))
    for (const s of m[1].matchAll(/["']([a-zA-Z][\w\-\.\/]+)["']\s*:/g)) ids.add(s[1]);
  for (const m of src.matchAll(/\bmodel\s*=\s*["']([a-zA-Z][\w\-\.\/]+)["']/g)) ids.add(m[1]);
  for (const m of src.matchAll(/^DEFAULT_MODEL\s*=\s*["']([^"']+)["']/gm)) ids.add(m[1]);
  for (const m of src.matchAll(/\bmodel\s*:[^=\n]*=\s*["']([a-zA-Z][\w\-\.\/]+)["']/g)) ids.add(m[1]);
  for (const m of src.matchAll(/\.get\(\s*["']model["']\s*,\s*["']([a-zA-Z][\w\-\.\/]+)["']\s*\)/g)) ids.add(m[1]);
  for (const m of src.matchAll(/\bmodel\s*==\s*["']([a-zA-Z][\w\-\.\/]+)["']/g)) ids.add(m[1]);
  // Enum 常量：只抓类名以 Model 结尾 + 继承 Enum 的 class 块内的 CONST = "xxx"
  // 避开 *Action / *Status / *AspectRatio / *Size / *Style 等无关枚举
  for (const cls of src.matchAll(/class\s+\w+Model\s*\([^)]*\bEnum\b[^)]*\)\s*:([\s\S]*?)(?=^class\s|\Z)/gm)) {
    for (const c of cls[1].matchAll(/^\s{2,}[A-Z][A-Z0-9_]*\s*=\s*["']([^"']+)["']/gm)) ids.add(c[1]);
  }
  return [...ids];
}

function normalize(id) {
  if (!id) return '';
  let x = id.includes('/') ? id.split('/').pop() : id;
  return x.trim().toLowerCase();
}

function buildRefIndex(ref) {
  const allNormalized = new Set();
  let files = [];
  try {
    const out = execSync(
      `git -C "${DIFY_ROOT}" ls-tree -r --name-only ${ref} -- ${SCAN_DIRS.join(' ')}`,
      { encoding: 'utf8' }
    );
    files = out.trim().split('\n').filter(f => f.endsWith('.py'));
  } catch (e) {
    console.error(`❌ ls-tree ${ref} 失败: ${e.message.split('\n')[0]}`);
    return { allNormalized };
  }
  for (const file of files) {
    let src = '';
    try {
      src = execSync(`git -C "${DIFY_ROOT}" show ${ref}:${file}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch { continue; }
    for (const id of extractModelsFromSrc(src)) allNormalized.add(normalize(id));
  }
  return { allNormalized };
}

gitFetch();
const mainIdx = buildRefIndex('origin/main');
const devIdx  = buildRefIndex('origin/develop');
console.log(`main 分支：${mainIdx.allNormalized.size} 个 model_id`);
console.log(`develop 分支：${devIdx.allNormalized.size} 个 model_id\n`);

// 根据代码状态和当前状态决定目标状态；null 表示不动
function decideTarget(current, inMain, inDev) {
  if (['未接入（暂不支持）', '未接入（不考虑）'].includes(current)) return null;
  if (inMain)  return current === '已接入' ? null : '已接入';
  if (inDev)   return current === '接入中' ? null : '接入中';
  if (current === '已接入' || current === '接入中') return '已下线';
  return null;  // 未接入 / 已下线 保持
}

(async () => {
  const client = new lark.Client({ appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET, disableTokenCache: false });

  // 读飞书全表
  const rows = [];
  let page_token;
  do {
    const resp = await client.bitable.appTableRecord.list({
      path: { app_token: BITABLE, table_id: TABLE },
      params: { page_size: 500, page_token },
    });
    for (const r of resp.data.items) rows.push(r);
    page_token = resp.data.has_more ? resp.data.page_token : null;
  } while (page_token);
  console.log(`飞书表读到 ${rows.length} 行\n`);

  const pickText = (v) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(x => x.text || x.name || (typeof x==='string'?x:'')).join('');
    if (typeof v === 'object') return v.text || v.name || '';
    return String(v);
  };
  const pickOpt = (v) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(x => x.text || x.name || '').join(',');
    if (typeof v === 'object') return v.text || v.name || '';
    return String(v);
  };
  const pickAbilities = (v) => {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const x of v) if (x && Array.isArray(x.text_arr)) out.push(...x.text_arr);
    return out;
  };
  const NON_MEDIA_RE = /^(文本生成|文本理解|提示词|Suno服务)·/;
  const isTextOnly = (arr) => arr.length > 0 && arr.every(t => NON_MEDIA_RE.test(t));

  const updates = [];  // { record_id, name, mid, from, to }
  let skippedEmptyMid = 0, skippedManual = 0, skippedTextOnly = 0;

  for (const r of rows) {
    const f = r.fields || {};
    const name     = pickText(f['模型名称']);
    const mid      = pickText(f['模型ID'] || f['模型 ID']);
    const status   = pickOpt(f['接入状态']);
    const abilities= pickAbilities(f['模型可用能力映射']);
    const midNorm  = normalize(mid);

    // 飞书「模型 ID」为空 → 脚本无从判定，跳过
    if (!mid) { skippedEmptyMid++; continue; }
    // 人工态保留
    if (['未接入（暂不支持）', '未接入（不考虑）'].includes(status)) { skippedManual++; continue; }
    // 纯文本 / Suno 能力：不归 dify-extension 判定
    if (isTextOnly(abilities)) { skippedTextOnly++; continue; }

    const inMain = mainIdx.allNormalized.has(midNorm);
    const inDev  = devIdx.allNormalized.has(midNorm);
    const target = decideTarget(status, inMain, inDev);
    if (target === null) continue;

    updates.push({ record_id: r.record_id, name, mid, from: status, to: target });
  }

  console.log(`🔒 跳过：空ID ${skippedEmptyMid} / 人工态 ${skippedManual} / 纯文本 ${skippedTextOnly}`);
  console.log(`\n本次将更新 ${updates.length} 行：`);
  for (const u of updates) {
    const arrow = u.to === '已接入' ? '🟢' : u.to === '接入中' ? '🟡' : '🔻';
    console.log(`  ${arrow} ${u.name} (ID=${u.mid}) "${u.from}" → "${u.to}"`);
  }
  if (updates.length === 0) { console.log('\n无改动，收工。'); return; }

  // 批量写入（batchUpdate 每批最多 1000，这里拆 100 一批稳妥）
  const BATCH = 100;
  let done = 0, failed = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    try {
      await client.bitable.appTableRecord.batchUpdate({
        path: { app_token: BITABLE, table_id: TABLE },
        data: {
          records: slice.map(u => ({
            record_id: u.record_id,
            fields: { '接入状态': u.to },
          })),
        },
      });
      done += slice.length;
      console.log(`✅ 已写入 ${done}/${updates.length}`);
    } catch (e) {
      failed += slice.length;
      console.error(`❌ 批次 ${i}~${i + slice.length} 失败:`, e.message || e);
    }
  }
  console.log(`\n完成：成功 ${done}，失败 ${failed}。`);
})().catch(e => { console.error(e); process.exit(1); });
