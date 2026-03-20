/**
 * 向飞书优化文档追加「AI 模型价格管理平台」一节
 * 目标文档：https://pcn28q31n7ee.feishu.cn/docx/Dfz0dQw37oUMoKxt4zicsKp2n5g
 *
 * 用法：node append-pricing-opt-doc.js
 */

['HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','https_proxy','http_proxy','all_proxy'].forEach(k => delete process.env[k]);

const https = require('https');
const { FEISHU_APP_ID: APP_ID, FEISHU_APP_SECRET: APP_SECRET } = require('./config');

const DOC_ID = 'Dfz0dQw37oUMoKxt4zicsKp2n5g';

function feishu(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : '';
    const h = { 'Content-Type': 'application/json; charset=utf-8' };
    if (b) h['Content-Length'] = Buffer.byteLength(b);
    if (token) h['Authorization'] = 'Bearer ' + token;
    const r = https.request({ hostname: 'open.feishu.cn', path, method, headers: h }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d }); } });
    });
    r.on('error', reject);
    if (b) r.write(b);
    r.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// -- Block 构建工具 --
const run  = (content, style = {}) => ({ text_run: { content, text_element_style: style } });
const bold = (content) => run(content, { bold: true });
const mono = (content) => run(content, { inline_code: true });
const gray = (content) => run(content, { italic: true });

const h1   = (text)   => ({ block_type: 3,  heading1:  { elements: [run(text)], style: {} } });
const h2   = (text)   => ({ block_type: 4,  heading2:  { elements: [run(text)], style: {} } });
const h3   = (text)   => ({ block_type: 5,  heading3:  { elements: [run(text)], style: {} } });
const p    = (...els) => ({ block_type: 2,  text:      { elements: els.length ? els : [run('')], style: {} } });
const bl   = (...els) => ({ block_type: 12, bullet:    { elements: els, style: {} } });
const ol   = (...els) => ({ block_type: 13, ordered:   { elements: els, style: {} } });
const hr   = ()       => ({ block_type: 22, divider: {} });

// -- 追加内容 --
const APPEND_BLOCKS = [

  hr(),
  h1('AI 模型价格管理平台'),
  p(gray('2026-03-12 · 平台版本 v1.x · D:/claude_projects/ai-model-pricing/')),
  p(),

  // 1. 功能需求
  h2('1. 功能需求'),

  h3('要做什么事情'),
  p(run('构建一个 Web 平台，统一管理和展示各 AI 厂商模型的价格信息，帮助团队快速查询、对比不同模型的计费标准，并估算实际使用成本。')),
  p(),

  h3('具体功能描述'),
  bl(bold('模型管理：'), run('支持新增、编辑、删除模型，列表/分组视图切换，可拖动列宽，操作栏 Split Button')),
  bl(bold('价格对比：'), run('多模型横向对比，列表/分组视图，多维度筛选（分类/厂商/计费类型/规格），可排序')),
  bl(bold('成本估算：'), run('输入 token 数量或调用次数，实时计算各模型单条及总费用，柱状图可视化，结果可排序')),
  bl(bold('Excel 导入导出：'), run('批量导入 Excel 价格表，导出当前数据到 Excel')),
  bl(bold('配置管理：'), run('可视化管理分类、厂商、计费类型、规格标签等枚举值，实时生效')),
  p(),

  h3('业务逻辑'),
  bl(bold('计费类型分支：'), run('文本模型按「百万 tokens」计费（输入/输出分开）；图像模型按「次」计费；视频模型按「分钟」或「次」计费；对口型按「次」计费，不乘时长')),
  bl(bold('价格双列：'), run('刊例价 + 折后价，文本模型分输入/输出两行展示，多档位支持按标签分档（如按分辨率）')),
  bl(bold('USD/CNY 自动换算：'), run('USD 计价模型在折后价下方显示 ≈¥xx（EXCHANGE_RATE = 7.2，各页文件顶部定义）')),
  bl(bold('多档输出定价：'), run('price_output_tiers JSON 数组存储各档，单档无标签时向后兼容存 price_output')),
  p(),

  // 2. 技术要求
  h2('2. 技术要求'),

  h3('编程语言'),
  bl(run('TypeScript（前端页面及 API 路由） + JavaScript（工具脚本）')),
  p(),

  h3('框架 / 库'),
  bl(mono('Next.js 16'), run(' (App Router)  —  SSR + API Routes')),
  bl(mono('TailwindCSS'), run('  —  样式，默认浅色主题，.dark 类覆盖深色')),
  bl(mono('better-sqlite3'), run('  —  本地 SQLite，同步 API，不支持 Edge Runtime')),
  bl(mono('SheetJS (xlsx)'), run('  —  Excel 导入导出')),
  bl(mono('Recharts'), run('  —  成本估算柱状图')),
  p(),

  h3('性能指标'),
  bl(run('页面首次加载 < 2s（Vercel CDN + SSR）')),
  bl(run('200 条模型列表渲染流畅，列宽拖动无卡顿')),
  bl(run('成本估算分页 20 条/页，useMemo 派生排序结果，避免重复计算')),
  p(),

  h3('兼容性要求'),
  bl(run('现代浏览器：Chrome / Edge / Firefox 最新版')),
  bl(run('部署环境：Vercel（只读文件系统，SQLite 需复制到 /tmp 使用）')),
  bl(run('本地开发：Node.js 18+，'), mono('npm run dev'), run(' 启动')),
  p(),

  // 3. 输入输出定义
  h2('3. 输入输出定义'),

  h3('数据格式'),
  bl(bold('models 表核心字段：'), mono('id / name / vendor / category / billing_type / channel / price_input / price_output / price_output_discounted / price_output_tiers / resolution_label / updated_at')),
  bl(bold('price_output_tiers：'), run('JSON 数组 '), mono('[{ label: "1080p", price: 0.12 }, ...]'), run('，单档无标签时字段为 NULL，向后兼容 price_output')),
  bl(bold('resolution_label：'), run('逗号分隔字符串，如 '), mono('"720p,1080p"')),
  bl(bold('config 表：'), run('categories / vendors / billing_types / channels / resolution_labels，均存 JSON 数组')),
  p(),

  h3('接口规范'),
  bl(mono('GET  /api/models'), run('  —  查询列表，支持 category / vendor / billing_type / channel / resolution_label 等 query 参数过滤')),
  bl(mono('POST /api/models'), run('  —  新增模型')),
  bl(mono('PUT  /api/models/[id]'), run('  —  更新模型')),
  bl(mono('DELETE /api/models/[id]'), run('  —  删除模型')),
  bl(mono('GET  /api/config'), run('  —  获取枚举配置（ConfigData）')),
  bl(mono('PUT  /api/config'), run('  —  更新枚举配置（Partial<ConfigData>，局部更新）')),
  p(),

  h3('参数说明'),
  bl(bold('isMTokenBilling：'), run('判断条件 '), mono("category==='文本模型' || billing_type==='百万tokens'"), run('，影响价格显示与成本计算公式')),
  bl(bold('resolution_label 过滤：'), run('后端用 LIKE '), mono('%value%'), run(' 匹配，支持多值逗号分隔字段')),
  bl(bold('EXCHANGE_RATE：'), run('固定 7.2，定义在各页面文件顶部（admin/compare/calculator 三处），需同步修改')),
  p(),

  // 4. 设计约束
  h2('4. 设计约束'),

  h3('系统限制'),
  bl(bold('Vercel 只读文件系统：'), mono('lib/db.ts'), run(' 检测 '), mono('process.env.VERCEL'), run('，自动将 '), mono('data/pricing.db'), run(' 复制到 '), mono('/tmp'), run(' 后使用')),
  bl(bold('SQLite WAL 模式：'), run('写操作先写 .db-wal，提交 GitHub 前必须 checkpoint，否则生产拿到旧数据'), run('')),
  bl(bold('better-sqlite3：'), run('同步 API，不支持 Edge Runtime，所有 API 路由必须走 Node.js runtime')),
  bl(bold('操作栏下拉定位：'), run('必须用 '), mono('position:fixed'), run(' + '), mono('getBoundingClientRect'), run('，'), mono('position:absolute'), run(' 会被表格 '), mono('overflow-x:auto'), run(' 截断')),
  bl(bold('列分割线：'), run('用 '), mono('box-shadow: inset -1px 0 0 var(--border2)'), run('，'), mono('border-collapse:collapse'), run(' 下 position:relative 失效，不能用伪元素')),
  p(),

  h3('依赖关系'),
  bl(bold('列宽持久化：'), run('各页 localStorage key 独立：'), mono('models_list_col_widths'), run(' / '), mono('compare_list_col_widths'), run(' / '), mono('calc_col_widths'), run(' 等')),
  bl(bold('筛选器持久化：'), run('compare 页用 '), mono('compare_filters_v2'), run(' key（v2 后缀防旧版脏数据）；calculator 厂商用 '), mono('calc_filter_vendors')),
  bl(bold('ModelModal 回调：'), run('通过 '), mono('onConfigUpdate: (update: Partial<ConfigData>) => void'), run(' 同步父组件 config，避免额外 API 请求')),
  bl(bold('时区处理：'), run('SQLite '), mono('CURRENT_TIMESTAMP'), run(' 为 UTC，前端解析用 '), mono("dateStr.replace(' ','T')+'Z'"), run(' 确保正确换算本地时区')),
  p(),

  h3('时间 / 资源限制'),
  bl(run('Vercel Serverless 函数超时 10s（免费版），单次 SQLite 查询应 < 1s，无需担忧')),
  bl(run('SQLite 单写无并发问题（单用户平台），无需连接池或事务队列')),
  bl(run('Excel 导入建议 < 500 行，SheetJS 全量读入内存，超大文件可能触发 Vercel 内存限制')),
  p(),

  hr(),
  p(gray('本节由 Claude Code 生成 · 2026-03-12 · ai-model-pricing v1.x')),
];

// -- 写入 blocks --
async function writeBlocks(token, blocks, startIndex) {
  const BATCH = 20;
  let written = 0;
  for (let i = 0; i < blocks.length; i += BATCH) {
    const batch = blocks.slice(i, i + BATCH);
    const res = await feishu('POST',
      `/open-apis/docx/v1/documents/${DOC_ID}/blocks/${DOC_ID}/children`,
      { children: batch, index: startIndex + i }, token);
    if (res.code !== 0) {
      console.error(`\n写入失败（第 ${startIndex + i} 块起）:`, JSON.stringify(res));
      process.exit(1);
    }
    written += batch.length;
    process.stdout.write(`  已写入 ${written} / ${blocks.length}\n`);
    if (i + BATCH < blocks.length) await sleep(300);
  }
}

async function main() {
  process.stdout.write('Step 1  获取飞书授权...');
  const tr = await feishu('POST', '/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: APP_ID, app_secret: APP_SECRET });
  if (!tr.tenant_access_token) { console.error('\nToken 失败', tr); process.exit(1); }
  const token = tr.tenant_access_token;
  console.log(' OK');

  process.stdout.write('Step 2  读取文档结构...');
  const blocksRes = await feishu('GET',
    `/open-apis/docx/v1/documents/${DOC_ID}/blocks?page_size=500`, null, token);
  if (blocksRes.code !== 0) { console.error('\n读取失败', JSON.stringify(blocksRes)); process.exit(1); }
  const rootBlock  = blocksRes.data?.items?.find(b => b.block_id === DOC_ID);
  const childCount = rootBlock?.children?.length || 0;
  console.log(` OK  当前子块数: ${childCount}`);

  console.log(`Step 3  追加 ${APPEND_BLOCKS.length} 个 block 到末尾（index ${childCount} 起）`);
  await writeBlocks(token, APPEND_BLOCKS, childCount);

  console.log('\n追加完成！');
  console.log(`   链接：https://pcn28q31n7ee.feishu.cn/docx/${DOC_ID}`);
}

main().catch(e => { console.error('\n', e.message); process.exit(1); });
