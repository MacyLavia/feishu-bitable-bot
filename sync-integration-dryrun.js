// dry-run：扫 dify-extension main + develop 两个分支 → 提取 model_id
//          读飞书「模型清单」表 → 对比出「→已接入 / →接入中 / →已下线 / 未映射」清单
// 不写任何东西，只打印报告
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const lark = require('@larksuiteoapi/node-sdk');
const { FEISHU_APP_ID, FEISHU_APP_SECRET } = require('./config');

const DIFY_ROOT = path.join(process.env.HOME, 'claude_projects/dify-extension');
const TOOL_DIRS = ['atmob_image/tools', 'atmob_image/schemas', 'atmob_video/tools', 'atmob_video/schemas'];
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
  // DEFAULT_MODEL = "xxx" （mountsea_gpt_image 这种用法）
  for (const m of src.matchAll(/^DEFAULT_MODEL\s*=\s*["']([^"']+)["']/gm)) ids.add(m[1]);
  // model: str = "xxx" / model: Optional[str] = "xxx" （字段默认值、函数参数默认值 —— aliyun_wan_image 这种用法）
  for (const m of src.matchAll(/\bmodel\s*:[^=\n]*=\s*["']([a-zA-Z][\w\-\.\/]+)["']/g)) ids.add(m[1]);
  // tool_parameters.get("model", "xxx") / dict.get("model", "xxx") 默认值
  for (const m of src.matchAll(/\.get\(\s*["']model["']\s*,\s*["']([a-zA-Z][\w\-\.\/]+)["']\s*\)/g)) ids.add(m[1]);
  // model == "xxx" 等值比较（抓 validate 逻辑里的模型名）
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
  const normalToRaw = new Map();
  const toolIndex = [];
  let files = [];
  try {
    const out = execSync(
      `git -C "${DIFY_ROOT}" ls-tree -r --name-only ${ref} -- ${TOOL_DIRS.join(' ')}`,
      { encoding: 'utf8' }
    );
    files = out.trim().split('\n').filter(f => f.endsWith('.py'));
  } catch (e) {
    console.error(`❌ ls-tree ${ref} 失败: ${e.message.split('\n')[0]}`);
    return { allNormalized, normalToRaw, toolIndex };
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
      allNormalized.add(n);
      if (!normalToRaw.has(n)) normalToRaw.set(n, []);
      normalToRaw.get(n).push(...ids.filter(x => normalize(x) === n));
    }
  }
  return { allNormalized, normalToRaw, toolIndex };
}

gitFetch();
const mainIdx = buildRefIndex('origin/main');
const devIdx  = buildRefIndex('origin/develop');

const onlyInDevelop = new Set([...devIdx.allNormalized].filter(n => !mainIdx.allNormalized.has(n)));
const onlyInMain    = new Set([...mainIdx.allNormalized].filter(n => !devIdx.allNormalized.has(n)));

console.log('=== 代码侧 ===');
console.log(`main 分支：${mainIdx.toolIndex.length} 个 tool / ${mainIdx.allNormalized.size} 个 model_id`);
console.log(`develop 分支：${devIdx.toolIndex.length} 个 tool / ${devIdx.allNormalized.size} 个 model_id`);
console.log(`仅 develop 有（待发布到 main）：${onlyInDevelop.size} 个`);
if (onlyInDevelop.size > 0) {
  for (const n of [...onlyInDevelop].sort()) {
    const raw = devIdx.normalToRaw.get(n) || [];
    console.log(`  • ${raw.join(' / ')}`);
  }
}
if (onlyInMain.size > 0) {
  console.log(`\n仅 main 有（develop 已移除，罕见）：${onlyInMain.size} 个`);
  for (const n of [...onlyInMain].sort()) {
    const raw = mainIdx.normalToRaw.get(n) || [];
    console.log(`  • ${raw.join(' / ')}`);
  }
}

// ── 步骤 3：读飞书全表 + 比对 ──
(async () => {
  const client = new lark.Client({ appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET, disableTokenCache: false });
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

  // 根据代码状态和当前状态决定目标状态；null 表示不动
  function decideTarget(current, inMain, inDev) {
    if (['未接入（暂不支持）', '未接入（不考虑）'].includes(current)) return null;
    if (inMain)  return current === '已接入' ? null : '已接入';
    if (inDev)   return current === '接入中' ? null : '接入中';
    // 两边都没
    if (current === '已接入' || current === '接入中') return '已下线';
    return null;  // 未接入 / 已下线 保持
  }

  const toIntegrated = [];   // → 已接入
  const toInProgress = [];   // → 接入中
  const toRetired    = [];   // → 已下线
  const alreadyCorrect = [];
  const untouchedManual = [];
  const unmappedRows = [];   // 两边代码都无 + 飞书当前是"未接入" → 未映射，保持不动
  const skippedTextOnly = [];
  const skippedEmptyMid = []; // 飞书「模型 ID」字段为空，无法判定
  const matchedNormalized = new Set();

  for (const r of rows) {
    const f = r.fields || {};
    const name     = pickText(f['模型名称']);
    const mid      = pickText(f['模型ID'] || f['模型 ID']);
    const vendor   = pickOpt(f['厂商']);
    const supplier = pickOpt(f['供应商']);
    const status   = pickOpt(f['接入状态']);
    const abilities= pickAbilities(f['模型可用能力映射']);
    const midNorm  = normalize(mid);

    const inMain = !!(mid && mainIdx.allNormalized.has(midNorm));
    const inDev  = !!(mid && devIdx.allNormalized.has(midNorm));
    const baseInfo = { record_id: r.record_id, name, mid, vendor, supplier, status, inMain, inDev };

    // 飞书「模型 ID」为空 → 脚本无从判定，跳过
    if (!mid) {
      skippedEmptyMid.push(baseInfo);
      continue;
    }
    // 人工态（暂不支持 / 不考虑）保留
    if (['未接入（暂不支持）', '未接入（不考虑）'].includes(status)) {
      untouchedManual.push(baseInfo);
      if (inMain || inDev) matchedNormalized.add(midNorm);
      continue;
    }
    // 纯文本 / Suno 能力：不归 dify-extension 判定
    if (isTextOnly(abilities)) {
      skippedTextOnly.push(baseInfo);
      if (inMain || inDev) matchedNormalized.add(midNorm);
      continue;
    }

    const target = decideTarget(status, inMain, inDev);
    if (inMain || inDev) matchedNormalized.add(midNorm);

    if (target === null) {
      // 不动
      if (status === '已接入' && inMain)            alreadyCorrect.push(baseInfo);
      else if (status === '接入中' && inDev)        alreadyCorrect.push(baseInfo);
      else if (status === '已下线' && !inMain && !inDev) alreadyCorrect.push(baseInfo);
      else if (status === '未接入' && !inMain && !inDev) unmappedRows.push(baseInfo);
      else                                           alreadyCorrect.push(baseInfo);
      continue;
    }
    if (target === '已接入')     toIntegrated.push(baseInfo);
    else if (target === '接入中') toInProgress.push(baseInfo);
    else if (target === '已下线') toRetired.push(baseInfo);
  }

  // py 里有、飞书没任何行命中的 model_id
  const unmappedPyMain = [...mainIdx.allNormalized].filter(n => !matchedNormalized.has(n));
  const unmappedPyDev  = [...devIdx.allNormalized].filter(n => !matchedNormalized.has(n) && !mainIdx.allNormalized.has(n));

  const codeState = (i) => i.inMain ? 'main' : i.inDev ? 'develop-only' : 'none';

  console.log('─────────── 对比结果 ───────────');
  console.log(`✅ 状态已正确：${alreadyCorrect.length} 行（不改动）`);
  console.log(`🔒 人工态保留：${untouchedManual.length} 行（暂不支持 / 不考虑）`);
  console.log(`📝 纯文本能力跳过：${skippedTextOnly.length} 行`);
  console.log(`⚫ 模型ID为空跳过：${skippedEmptyMid.length} 行（无法匹配代码）`);
  for (const x of skippedEmptyMid) {
    console.log(`    • ${x.name} (ID为空) 当前="${x.status}"`);
  }

  console.log(`\n🟢 应改为「已接入」：${toIntegrated.length} 行`);
  for (const x of toIntegrated) {
    console.log(`    • ${x.name} (ID=${x.mid}) 当前="${x.status}" → 已接入  [code=${codeState(x)}]`);
  }
  console.log(`\n🟡 应改为「接入中」：${toInProgress.length} 行（只在 develop 出现，待发布到 main）`);
  for (const x of toInProgress) {
    console.log(`    • ${x.name} (ID=${x.mid}) 当前="${x.status}" → 接入中  [code=${codeState(x)}]`);
  }
  console.log(`\n🔻 应改为「已下线」：${toRetired.length} 行（main 和 develop 均找不到）`);
  for (const x of toRetired) {
    console.log(`    • ${x.name} (ID=${x.mid}) 当前="${x.status}" → 已下线`);
  }

  console.log(`\n⚪ 飞书未映射（未接入 + 代码两边都无，保持不动）：${unmappedRows.length} 行`);
  for (const x of unmappedRows.slice(0, 20)) {
    console.log(`    • [${x.vendor || '-'} | ${x.supplier || '-'}] ${x.name} (ID=${x.mid})`);
  }
  if (unmappedRows.length > 20) console.log(`    ... 还有 ${unmappedRows.length - 20} 行`);

  console.log(`\n🔶 main 有但飞书没任何行：${unmappedPyMain.length} 个（需手动在飞书加记录）`);
  for (const n of unmappedPyMain) console.log(`    • ${mainIdx.normalToRaw.get(n).join(' / ')}`);
  console.log(`\n🔶 只 develop 有但飞书没任何行：${unmappedPyDev.length} 个（新模型，建议先在飞书加记录标"接入中"）`);
  for (const n of unmappedPyDev) console.log(`    • ${devIdx.normalToRaw.get(n).join(' / ')}`);
})().catch(e => { console.error(e); process.exit(1); });
