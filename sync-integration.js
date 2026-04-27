// 正式同步：扫 dify-extension main + develop 两个分支 → 抽 (供应商, model_id)
//          读飞书「模型清单」表 → 按 (供应商, model_id) 双键匹配 → 写回「接入状态」字段
// 供应商识别依赖飞书「供应商映射表」（tblxbV4jCshQFBjJ）：dify关键词（文件路径子串） → 飞书供应商
// 命名规则：dify-extension 文件路径包含某个关键词（大小写不敏感、长度降序匹配）→ 归属对应供应商
//          路径不包含任何关键词的文件 → 跳过 + 警告（保守原则，方案 A）
// 默认写入飞书。DRY=1 node sync-integration.js 只打印不写。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const lark = require('@larksuiteoapi/node-sdk');
const { FEISHU_APP_ID, FEISHU_APP_SECRET } = require('./config');

const DIFY_ROOT = path.join(process.env.HOME, 'claude_projects/dify-extension');
const SCAN_DIRS = ['atmob_image/tools', 'atmob_image/schemas', 'atmob_video/tools', 'atmob_video/schemas'];
const BITABLE = 'IzlCbNPjbaF38As26IJcSd47nKh';
const TABLE   = 'tbloWaN3VqosiudO';
const MAPPING_TABLE = 'tblxbV4jCshQFBjJ';
const DRY = process.env.DRY === '1';

// ── git fetch ──
function gitFetch() {
  try {
    execSync(`git -C "${DIFY_ROOT}" fetch origin main develop`, { stdio: 'pipe' });
    console.log('✅ git fetch origin main develop 完成\n');
  } catch (e) {
    console.warn(`⚠️ git fetch 失败，将使用本地已有 refs: ${e.message.split('\n')[0]}\n`);
  }
}

// ── 抽 model_id ──
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

// ── 加载飞书「供应商映射表」 ──
// 「供应商」是 Lookup 字段，存的是主表 option_id；要先读主表字段元数据拿 id→name 映射
async function loadSupplierMapping(client) {
  const fieldsResp = await client.bitable.appTableField.list({
    path: { app_token: BITABLE, table_id: TABLE },
    params: { page_size: 200 }
  });
  const supplierField = fieldsResp.data.items.find(f => f.field_name === '供应商');
  const id2name = {};
  if (supplierField?.property?.options) {
    for (const o of supplierField.property.options) id2name[o.id] = o.name;
  }

  const rows = [];
  let page_token;
  do {
    const resp = await client.bitable.appTableRecord.list({
      path: { app_token: BITABLE, table_id: MAPPING_TABLE },
      params: { page_size: 500, page_token }
    });
    for (const r of resp.data.items) rows.push(r);
    page_token = resp.data.has_more ? resp.data.page_token : null;
  } while (page_token);

  const entries = [];
  for (const r of rows) {
    const kw = String(r.fields['dify关键词'] || '').trim();
    const ids = Array.isArray(r.fields['供应商']) ? r.fields['供应商'] : [];
    const supplier = ids.map(id => id2name[id] || id).filter(Boolean).join('');
    if (!kw || !supplier) continue;
    entries.push({ keyword: kw, keywordLower: kw.toLowerCase(), supplier });
  }
  // 长度降序：避免短关键词误命中（如 sora 命中 mountsea_sora.yaml）
  entries.sort((a, b) => b.keyword.length - a.keyword.length);
  return entries;
}

// ── 按 supplier 分组建索引 ──
// 返回：{ bySupplier: Map<supplier, Set<normalized model_id>>,
//        unrecognized: [{file, ids}],            // 文件维度，用于日志展示
//        unrecognizedIds: Set<normalized model_id> }  // model_id 维度，主循环用来跳过这些飞书行（保守原则：方案 A）
function buildRefIndex(ref, mappingEntries) {
  const bySupplier = new Map();
  const unrecognized = [];
  const unrecognizedIds = new Set();
  let files = [];
  try {
    const out = execSync(
      `git -C "${DIFY_ROOT}" ls-tree -r --name-only ${ref} -- ${SCAN_DIRS.join(' ')}`,
      { encoding: 'utf8' }
    );
    files = out.trim().split('\n').filter(f => f.endsWith('.py'));
  } catch (e) {
    console.error(`❌ ls-tree ${ref} 失败: ${e.message.split('\n')[0]}`);
    return { bySupplier, unrecognized, unrecognizedIds };
  }
  for (const file of files) {
    let src = '';
    try {
      src = execSync(`git -C "${DIFY_ROOT}" show ${ref}:${file}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch { continue; }
    const ids = extractModelsFromSrc(src);
    if (!ids.length) continue;

    const fileLower = file.toLowerCase();
    const matched = mappingEntries.find(e => fileLower.includes(e.keywordLower));
    if (!matched) {
      unrecognized.push({ file, ids });
      for (const id of ids) unrecognizedIds.add(normalize(id));
      continue;
    }
    if (!bySupplier.has(matched.supplier)) bySupplier.set(matched.supplier, new Set());
    const set = bySupplier.get(matched.supplier);
    for (const id of ids) set.add(normalize(id));
  }
  return { bySupplier, unrecognized, unrecognizedIds };
}

function decideTarget(current, inMain, inDev) {
  if (['未接入（暂不支持）', '未接入（不考虑）'].includes(current)) return null;
  if (inMain)  return current === '已接入' ? null : '已接入';
  if (inDev)   return current === '接入中' ? null : '接入中';
  if (current === '已接入' || current === '接入中') return '已下线';
  return null;
}

(async () => {
  const client = new lark.Client({ appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET, disableTokenCache: false });

  // 1. 拉映射表
  const mappingEntries = await loadSupplierMapping(client);
  console.log(`✅ 供应商映射表读到 ${mappingEntries.length} 条:`);
  for (const e of mappingEntries) console.log(`   • ${e.keyword.padEnd(12)} → ${e.supplier}`);
  console.log('');
  const managedSuppliers = new Set(mappingEntries.map(e => e.supplier));

  // 2. git fetch + 扫源码
  gitFetch();
  const mainIdx = buildRefIndex('origin/main', mappingEntries);
  const devIdx  = buildRefIndex('origin/develop', mappingEntries);

  console.log('=== dify-extension 扫描结果（按供应商）===');
  for (const sup of managedSuppliers) {
    const m = (mainIdx.bySupplier.get(sup) || new Set()).size;
    const d = (devIdx.bySupplier.get(sup) || new Set()).size;
    console.log(`  ${sup.padEnd(10)}  main=${m}  develop=${d}`);
  }
  const allUnrec = new Map();
  for (const x of [...mainIdx.unrecognized, ...devIdx.unrecognized]) {
    if (!allUnrec.has(x.file)) allUnrec.set(x.file, x.ids);
  }
  if (allUnrec.size > 0) {
    console.log(`\n⚠️  ${allUnrec.size} 个文件未匹配任何供应商关键词（已跳过；如需纳管请去飞书映射表加行）：`);
    for (const [f, ids] of allUnrec) {
      console.log(`   • ${f}  → ${ids.join(', ')}`);
    }
  }
  console.log('');

  // 3. 读飞书主表
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
  console.log(`飞书主表读到 ${rows.length} 行\n`);

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

  const allUnrecognizedIds = new Set([...mainIdx.unrecognizedIds, ...devIdx.unrecognizedIds]);
  const updates = [];
  let skippedEmptyMid = 0, skippedManual = 0, skippedTextOnly = 0, skippedEmptySupplier = 0, skippedNotManaged = 0, skippedUnrecognized = 0;

  for (const r of rows) {
    const f = r.fields || {};
    const name     = pickText(f['模型名称']);
    const mid      = pickText(f['模型ID'] || f['模型 ID']);
    const supplier = pickOpt(f['供应商']);
    const status   = pickOpt(f['接入状态']);
    const abilities= pickAbilities(f['模型可用能力映射']);
    const midNorm  = normalize(mid);

    if (!mid) { skippedEmptyMid++; continue; }
    if (['未接入（暂不支持）', '未接入（不考虑）'].includes(status)) { skippedManual++; continue; }
    if (isTextOnly(abilities)) { skippedTextOnly++; continue; }
    if (!supplier) { skippedEmptySupplier++; continue; }
    if (!managedSuppliers.has(supplier)) { skippedNotManaged++; continue; }
    // 方案 A：dify 里有这个 model_id 但归不到任何已知供应商的文件 → 不动飞书（人工维护）
    if (allUnrecognizedIds.has(midNorm)) { skippedUnrecognized++; continue; }

    const inMain = (mainIdx.bySupplier.get(supplier) || new Set()).has(midNorm);
    const inDev  = (devIdx.bySupplier.get(supplier) || new Set()).has(midNorm);
    const target = decideTarget(status, inMain, inDev);
    if (target === null) continue;

    updates.push({ record_id: r.record_id, name, mid, supplier, from: status, to: target });
  }

  console.log(`🔒 跳过：空ID ${skippedEmptyMid} / 空供应商 ${skippedEmptySupplier} / 供应商不在映射表 ${skippedNotManaged} / 人工态 ${skippedManual} / 纯文本 ${skippedTextOnly} / dify无法判定供应商 ${skippedUnrecognized}`);
  console.log(`\n本次将更新 ${updates.length} 行：`);
  for (const u of updates) {
    const arrow = u.to === '已接入' ? '🟢' : u.to === '接入中' ? '🟡' : '🔻';
    console.log(`  ${arrow} [${u.supplier}] ${u.name} (ID=${u.mid}) "${u.from}" → "${u.to}"`);
  }
  if (updates.length === 0) { console.log('\n无改动，收工。'); return; }

  if (DRY) { console.log('\n[DRY] 不写入。去掉 DRY=1 真正写回飞书。'); return; }

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
