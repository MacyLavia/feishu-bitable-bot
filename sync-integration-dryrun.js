// dry-run：扫 dify-extension main + develop 两个分支 → 抽 (供应商, model_id)
//          读飞书「模型清单」表 → 按 (供应商, model_id) 双键匹配 → 对比出「→已接入 / →接入中 / →已下线 / 未映射」清单
// 不写任何东西，只打印报告
// 供应商识别依赖飞书「供应商映射表」（tblxbV4jCshQFBjJ）：dify关键词（文件路径子串） → 飞书供应商
// 路径不命中任何关键词的文件 → 跳过 + 警告（保守原则，方案 A）
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

function gitFetch() {
  try {
    execSync(`git -C "${DIFY_ROOT}" fetch origin main develop`, { stdio: 'pipe' });
    console.log('✅ git fetch origin main develop 完成\n');
  } catch (e) {
    console.warn(`⚠️ git fetch 失败，将使用本地已有 refs: ${e.message.split('\n')[0]}\n`);
  }
}

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

// 加载映射表（同 sync-integration.js）
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
  entries.sort((a, b) => b.keyword.length - a.keyword.length);
  return entries;
}

// buildRefIndex：按 supplier 分组（同 sync-integration.js），同时保留每条 model_id 的原始拼写以便日志展示
function buildRefIndex(ref, mappingEntries) {
  const bySupplier = new Map();        // supplier -> Set<normalized model_id>
  const unrecognized = [];              // {file, ids}
  const unrecognizedIds = new Set();    // normalized model_id（主循环 skip 用）
  const normalToRaw = new Map();        // normalized -> [raw ids]（日志展示）
  const toolIndex = [];                 // [{tool, category, file, ids, normalized}]
  let files = [];
  try {
    const out = execSync(
      `git -C "${DIFY_ROOT}" ls-tree -r --name-only ${ref} -- ${SCAN_DIRS.join(' ')}`,
      { encoding: 'utf8' }
    );
    files = out.trim().split('\n').filter(f => f.endsWith('.py'));
  } catch (e) {
    console.error(`❌ ls-tree ${ref} 失败: ${e.message.split('\n')[0]}`);
    return { bySupplier, unrecognized, unrecognizedIds, normalToRaw, toolIndex };
  }
  for (const file of files) {
    let src = '';
    try {
      src = execSync(`git -C "${DIFY_ROOT}" show ${ref}:${file}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch { continue; }
    const ids = extractModelsFromSrc(src);
    if (!ids.length) continue;
    const category = file.includes('atmob_image') ? '图像' : '视频';
    const toolName = path.basename(file, '.py');
    const normSet = new Set(ids.map(normalize));
    toolIndex.push({ tool: toolName, category, file, ids, normalized: normSet });
    for (const n of normSet) {
      if (!normalToRaw.has(n)) normalToRaw.set(n, []);
      normalToRaw.get(n).push(...ids.filter(x => normalize(x) === n));
    }

    const fileLower = file.toLowerCase();
    const matched = mappingEntries.find(e => fileLower.includes(e.keywordLower));
    if (!matched) {
      unrecognized.push({ file, ids });
      for (const n of normSet) unrecognizedIds.add(n);
      continue;
    }
    if (!bySupplier.has(matched.supplier)) bySupplier.set(matched.supplier, new Set());
    const set = bySupplier.get(matched.supplier);
    for (const n of normSet) set.add(n);
  }
  return { bySupplier, unrecognized, unrecognizedIds, normalToRaw, toolIndex };
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

  const mappingEntries = await loadSupplierMapping(client);
  console.log(`✅ 供应商映射表读到 ${mappingEntries.length} 条:`);
  for (const e of mappingEntries) console.log(`   • ${e.keyword.padEnd(12)} → ${e.supplier}`);
  console.log('');
  const managedSuppliers = new Set(mappingEntries.map(e => e.supplier));

  gitFetch();
  const mainIdx = buildRefIndex('origin/main', mappingEntries);
  const devIdx  = buildRefIndex('origin/develop', mappingEntries);

  console.log('=== 代码侧（按供应商）===');
  for (const sup of managedSuppliers) {
    const m = (mainIdx.bySupplier.get(sup) || new Set()).size;
    const d = (devIdx.bySupplier.get(sup) || new Set()).size;
    console.log(`  ${sup.padEnd(10)}  main=${m}  develop=${d}`);
  }

  // 仅 develop（待发布）
  const allMainIds = new Set();
  for (const set of mainIdx.bySupplier.values()) for (const n of set) allMainIds.add(n);
  const allDevIds = new Set();
  for (const set of devIdx.bySupplier.values()) for (const n of set) allDevIds.add(n);
  const onlyInDevelop = new Set([...allDevIds].filter(n => !allMainIds.has(n)));
  const onlyInMain    = new Set([...allMainIds].filter(n => !allDevIds.has(n)));
  console.log(`\n仅 develop 有（待发布到 main）：${onlyInDevelop.size} 个`);
  for (const n of [...onlyInDevelop].sort()) {
    const raw = devIdx.normalToRaw.get(n) || [];
    console.log(`  • ${raw.join(' / ')}`);
  }
  if (onlyInMain.size > 0) {
    console.log(`\n仅 main 有（develop 已移除，罕见）：${onlyInMain.size} 个`);
    for (const n of [...onlyInMain].sort()) {
      const raw = mainIdx.normalToRaw.get(n) || [];
      console.log(`  • ${raw.join(' / ')}`);
    }
  }

  // 未识别供应商的文件
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

  // 读飞书全表 + 比对
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
  console.log(`\n=== 飞书表读到 ${rows.length} 行 ===\n`);

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

  const toIntegrated = [];
  const toInProgress = [];
  const toRetired    = [];
  const alreadyCorrect = [];
  const untouchedManual = [];
  const unmappedRows = [];   // 两边代码都无 + 飞书当前是"未接入" → 未映射
  const skippedTextOnly = [];
  const skippedEmptyMid = [];
  const skippedEmptySupplier = [];
  const skippedNotManaged = [];      // 供应商不在映射表 → 脚本不管
  const skippedUnrecognized = [];    // dify 文件无法判定供应商 → 方案 A 保守跳过

  for (const r of rows) {
    const f = r.fields || {};
    const name     = pickText(f['模型名称']);
    const mid      = pickText(f['模型ID'] || f['模型 ID']);
    const vendor   = pickOpt(f['厂商']);
    const supplier = pickOpt(f['供应商']);
    const status   = pickOpt(f['接入状态']);
    const abilities= pickAbilities(f['模型可用能力映射']);
    const midNorm  = normalize(mid);

    const inMainSupplier = supplier && (mainIdx.bySupplier.get(supplier) || new Set()).has(midNorm);
    const inDevSupplier  = supplier && (devIdx.bySupplier.get(supplier) || new Set()).has(midNorm);
    const baseInfo = { record_id: r.record_id, name, mid, vendor, supplier, status, inMain: !!inMainSupplier, inDev: !!inDevSupplier };

    if (!mid) { skippedEmptyMid.push(baseInfo); continue; }
    if (['未接入（暂不支持）', '未接入（不考虑）'].includes(status)) {
      untouchedManual.push(baseInfo);
      continue;
    }
    if (isTextOnly(abilities)) { skippedTextOnly.push(baseInfo); continue; }
    if (!supplier) { skippedEmptySupplier.push(baseInfo); continue; }
    if (!managedSuppliers.has(supplier)) { skippedNotManaged.push(baseInfo); continue; }
    if (allUnrecognizedIds.has(midNorm)) { skippedUnrecognized.push(baseInfo); continue; }

    const target = decideTarget(status, inMainSupplier, inDevSupplier);
    if (target === null) {
      if (status === '已接入' && inMainSupplier)            alreadyCorrect.push(baseInfo);
      else if (status === '接入中' && inDevSupplier)        alreadyCorrect.push(baseInfo);
      else if (status === '已下线' && !inMainSupplier && !inDevSupplier) alreadyCorrect.push(baseInfo);
      else if (status === '未接入' && !inMainSupplier && !inDevSupplier) unmappedRows.push(baseInfo);
      else                                                   alreadyCorrect.push(baseInfo);
      continue;
    }
    if (target === '已接入')      toIntegrated.push(baseInfo);
    else if (target === '接入中')  toInProgress.push(baseInfo);
    else if (target === '已下线')  toRetired.push(baseInfo);
  }

  const codeState = (i) => i.inMain ? 'main' : i.inDev ? 'develop-only' : 'none';

  console.log('─────────── 对比结果 ───────────');
  console.log(`✅ 状态已正确：${alreadyCorrect.length} 行（不改动）`);
  console.log(`🔒 人工态保留：${untouchedManual.length} 行（暂不支持 / 不考虑）`);
  console.log(`📝 纯文本能力跳过：${skippedTextOnly.length} 行`);
  console.log(`⚫ 模型ID为空跳过：${skippedEmptyMid.length} 行`);
  for (const x of skippedEmptyMid) console.log(`    • ${x.name} (ID为空) 当前="${x.status}"`);
  console.log(`⚫ 供应商为空跳过：${skippedEmptySupplier.length} 行`);
  for (const x of skippedEmptySupplier) console.log(`    • ${x.name} (mid=${x.mid}) 当前="${x.status}"`);
  console.log(`⚫ 供应商不在映射表跳过：${skippedNotManaged.length} 行（脚本不管，由你人工维护）`);
  for (const x of skippedNotManaged) console.log(`    • [${x.supplier}] ${x.name} (mid=${x.mid}) 当前="${x.status}"`);
  console.log(`⚫ dify 无法判定供应商跳过：${skippedUnrecognized.length} 行（方案 A 保守原则）`);

  console.log(`\n🟢 应改为「已接入」：${toIntegrated.length} 行`);
  for (const x of toIntegrated) {
    console.log(`    • [${x.supplier}] ${x.name} (ID=${x.mid}) 当前="${x.status}" → 已接入  [code=${codeState(x)}]`);
  }
  console.log(`\n🟡 应改为「接入中」：${toInProgress.length} 行（只在 develop 出现，待发布到 main）`);
  for (const x of toInProgress) {
    console.log(`    • [${x.supplier}] ${x.name} (ID=${x.mid}) 当前="${x.status}" → 接入中  [code=${codeState(x)}]`);
  }
  console.log(`\n🔻 应改为「已下线」：${toRetired.length} 行（main 和 develop 均找不到）`);
  for (const x of toRetired) {
    console.log(`    • [${x.supplier}] ${x.name} (ID=${x.mid}) 当前="${x.status}" → 已下线`);
  }

  console.log(`\n⚪ 飞书未映射（未接入 + 代码两边都无，保持不动）：${unmappedRows.length} 行`);
  for (const x of unmappedRows.slice(0, 20)) {
    console.log(`    • [${x.supplier || '-'}] ${x.name} (ID=${x.mid})`);
  }
  if (unmappedRows.length > 20) console.log(`    ... 还有 ${unmappedRows.length - 20} 行`);
})().catch(e => { console.error(e); process.exit(1); });
