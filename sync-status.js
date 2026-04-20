#!/usr/bin/env node
/**
 * 从飞书「AI中台模型能力」规划文档读取状态 → 同步到 ai-model-pricing
 *
 * 同步字段：产品名称 / 使用状态 / 接入状态 / 测试状态
 * 匹配方式：规划文档「pricing关联名」→ ai-model-pricing 的 feishu_ref
 *
 * 用法:
 *   node sync-status.js              # 同步全部
 *   node sync-status.js --dry-run    # 仅预览，不写入
 */

const { FEISHU_APP_ID, FEISHU_APP_SECRET, PRICING_API_URL, PRICING_API_KEY } = require('./config');

// 规划文档（AI中台模型能力表）
const BITABLE_APP_TOKEN = 'IzlCbNPjbaF38As26IJcSd47nKh';
const TABLE_ID = 'tbloWaN3VqosiudO';

const PRICING_API = PRICING_API_URL;
const PRICING_KEY = PRICING_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

// ── 飞书 API ──────────────────────────────────────────────

async function getTenantToken() {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`获取 token 失败: ${data.msg}`);
  return data.tenant_access_token;
}

async function fetchAllRecords(token) {
  const records = [];
  let pageToken = '';
  do {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${TABLE_ID}/records?page_size=100${pageToken ? '&page_token=' + pageToken : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`读取记录失败: ${data.msg}`);
    records.push(...(data.data.items || []));
    pageToken = data.data.page_token || '';
  } while (pageToken);
  return records;
}

// ── 字段值归一化 ─────────────────────────────────────────

function normalizeText(v) {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object' ? (x.text || '') : String(x || ''))).join('').trim();
  if (v && typeof v === 'object' && typeof v.text === 'string') return v.text.trim();
  return '';
}

function normalizeSelect(v) {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v) && v.length > 0) {
    const first = v[0];
    if (typeof first === 'string') return first.trim();
    if (first && typeof first === 'object') return String(first.name || first.text || '').trim();
  }
  if (v && typeof v === 'object') return String(v.name || v.text || '').trim();
  return '';
}

// ── 提取同步数据 ─────────────────────────────────────────

function extractSyncItems(records) {
  const items = [];
  for (const r of records) {
    const fields = r.fields || {};

    // 匹配优先级：pricing关联名 > 模型名称
    const modelName = normalizeText(fields['模型名称']);
    const modelId = normalizeText(fields['模型 ID'] ?? fields['模型ID']);
    const pricingName = normalizeText(fields['pricing 关联名']);
    const matchKey = pricingName || modelName;  // 匹配 pricing 的 feishu_ref
    if (!matchKey) continue;

    const modelLabel = modelName || matchKey;
    const productName = normalizeText(fields['产品名称']);
    const vendor = normalizeText(fields['厂商']);
    const supplier = normalizeSelect(fields['供应商']);
    const usageStatus = normalizeSelect(fields['使用状态']);
    const integrationStatus = normalizeSelect(fields['接入状态']);
    const testStatus = normalizeSelect(fields['测试状态']);

    // 至少有一个字段有值才同步
    if (!modelName && !modelId && !productName && !vendor && !supplier && !usageStatus && !integrationStatus && !testStatus) continue;

    const item = { feishu_ref: matchKey, feishu_record_id: r.record_id, _label: modelLabel };
    if (modelName) item.model_name = modelName;
    if (modelId) item.model_id = modelId;
    if (productName) item.product_name = productName;
    if (vendor) item.vendor = vendor;
    if (supplier) item.supplier = supplier;
    if (usageStatus) item.usage_status = usageStatus;
    if (integrationStatus) item.integration_status = integrationStatus;
    if (testStatus) item.test_status = testStatus;

    items.push(item);
  }
  return items;
}

// ── 调用 ai-model-pricing API ─────────────────────────────

async function pricingRequest(method, urlPath, body) {
  const h = { 'Content-Type': 'application/json; charset=utf-8' };
  if (PRICING_KEY) h['Authorization'] = 'Bearer ' + PRICING_KEY;
  const res = await fetch(PRICING_API + urlPath, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 200) }; }
}

// ── 主流程 ────────────────────────────────────────────────

async function main() {
  console.log('📋 获取飞书 Token...');
  const token = await getTenantToken();

  console.log('📋 读取规划文档「AI中台模型能力」...');
  const records = await fetchAllRecords(token);
  console.log(`  共 ${records.length} 条模型记录`);

  const items = extractSyncItems(records);
  console.log(`  提取到 ${items.length} 条可同步记录`);
  // 提取飞书全量 matchKey（含没有状态字段的记录），用于检测 pricing 孤儿记录
  const allFeishuRefs = records
    .map(r => {
      const f = r.fields || {};
      return normalizeText(f['pricing 关联名']) || normalizeText(f['模型名称']);
    })
    .filter(Boolean);
  const allRecordIds = records
    .map(r => r.record_id)
    .filter(Boolean);
  console.log(`  飞书全量 matchKey: ${allFeishuRefs.length} 个`);

  if (items.length === 0) {
    console.log('⚠️ 未提取到任何可同步记录（没有状态字段有值的模型）');
    return;
  }

  console.log('\n同步汇总:');
  for (const item of items) {
    const parts = [];
    if (item.model_name) parts.push(`家族:${item.model_name}`);
    if (item.model_id) parts.push(`模型ID:${item.model_id}`);
    if (item.product_name) parts.push(`产品:${item.product_name}`);
    if (item.vendor) parts.push(`厂商:${item.vendor}`);
    if (item.supplier) parts.push(`供应商:${item.supplier}`);
    if (item.usage_status) parts.push(`使用:${item.usage_status}`);
    if (item.integration_status) parts.push(`接入:${item.integration_status}`);
    if (item.test_status) parts.push(`测试:${item.test_status}`);
    console.log(`  ${item._label} → ${item.feishu_ref} | ${parts.join(' | ')}`);
  }

  if (DRY_RUN) {
    console.log(`\n🔍 dry-run 模式，共 ${items.length} 条可同步，${allFeishuRefs.length} 个飞书 matchKey，${allRecordIds.length} 个 record_id，未写入`);
    return;
  }

  // 去掉 _label（API 不需要）
  const apiItems = items.map(({ _label, ...rest }) => rest);

  console.log('\n📤 同步到 ai-model-pricing...');
  const result = await pricingRequest('POST', '/api/coze/sync-status', {
    items: apiItems,
    all_feishu_refs: allFeishuRefs,
    all_feishu_record_ids: allRecordIds,
  });

  if (result.raw) {
    console.log('⚠️ API 返回非 JSON:', result.raw.slice(0, 200));
    return;
  }

  if (result.error) {
    console.log(`❌ API 返回错误: ${result.error}`);
    return;
  }

  console.log(`✅ 完成: 修改 ${result.modified || 0} 条，未变 ${result.unchanged || 0} 条，新建 ${result.created} 条，跳过 ${result.skipped} 条，下架 ${result.archived || 0} 条（共 ${result.total} 条）`);

  if (result.details) {
    const modified = result.details.filter(d => d.action === 'modified');
    if (modified.length > 0) {
      console.log('\n修改的记录:');
      for (const d of modified) {
        const fields = d.changed_fields ? d.changed_fields.join(', ') : '';
        console.log(`  ✏️ ${d.feishu_ref}${fields ? ' (' + fields + ')' : ''}`);
      }
    }

    const failures = result.details.filter(d => d.action === 'skipped');
    if (failures.length > 0) {
      console.log('\n跳过的记录:');
      for (const d of failures) {
        console.log(`  ❌ ${d.feishu_ref}: ${d.error}`);
      }
    }
  }
}

main().catch(e => { console.error('❌ 同步失败:', e.message); process.exit(1); });
