/**
 * 向飞书文档追加 Spec 补充章节
 * 文档：Dfz0dQw37oUMoKxt4zicsKp2n5g
 */
const { FEISHU_APP_ID, FEISHU_APP_SECRET } = require('./config');
const https = require('https');

const DOC_ID = 'Dfz0dQw37oUMoKxt4zicsKp2n5g';

function req(method, path, body, token) {
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

// ── 标准 text_element_style ────────────────────────────────
const DEFAULT_STYLE = { bold: false, inline_code: false, italic: false, strikethrough: false, underline: false };
const BLOCK_STYLE = { align: 1, folded: false };

function mkRun(text, overrides = {}) {
  return { text_run: { content: text, text_element_style: { ...DEFAULT_STYLE, ...overrides } } };
}

// ── Block 构建 helpers ─────────────────────────────────────
function para(text, bold = false) {
  return { block_type: 2, text: { elements: [mkRun(text, bold ? { bold: true } : {})], style: BLOCK_STYLE } };
}
function h1(text) {
  return { block_type: 3, heading1: { elements: [mkRun(text)], style: BLOCK_STYLE } };
}
function h2(text) {
  return { block_type: 4, heading2: { elements: [mkRun(text)], style: BLOCK_STYLE } };
}
function h3(text) {
  return { block_type: 5, heading3: { elements: [mkRun(text)], style: BLOCK_STYLE } };
}
function bullet(text) {
  return { block_type: 12, bullet: { elements: [mkRun(text)], style: BLOCK_STYLE } };
}
function code(text) {
  return { block_type: 14, code: { elements: [mkRun(text)], style: { language: 1, wrap: true } } };
}
function divider() {
  return { block_type: 22, divider: {} };
}

// ── 追加 blocks（每批最多 50 个）─────────────────────────────
async function appendBlocks(token, blocks) {
  const BATCH = 50;
  for (let i = 0; i < blocks.length; i += BATCH) {
    const batch = blocks.slice(i, i + BATCH);
    const res = await req(
      'POST',
      `/open-apis/docx/v1/documents/${DOC_ID}/blocks/${DOC_ID}/children`,
      { children: batch, index: -1 },
      token
    );
    if (res.code !== 0) {
      console.error('写入失败 batch', Math.floor(i / BATCH) + 1, JSON.stringify(res));
      throw new Error('写入失败');
    }
    console.log(`✅ batch ${Math.floor(i / BATCH) + 1}（${batch.length} 块）写入成功`);
    await new Promise(r => setTimeout(r, 600));
  }
}

// ── 删除最后 N 个子块（清理测试块）──────────────────────────
async function deleteLastN(token, n) {
  // 获取根块子块总数
  let allChildren = [];
  let pageToken = '';
  while (true) {
    const url = `/open-apis/docx/v1/documents/${DOC_ID}/blocks?page_size=100&document_revision_id=-1` + (pageToken ? `&page_token=${pageToken}` : '');
    const res = await req('GET', url, null, token);
    for (const item of (res.data?.items || [])) {
      if (item.parent_id === DOC_ID) allChildren.push(item);
    }
    if (!res.data?.has_more) break;
    pageToken = res.data.page_token;
  }
  const total = allChildren.length;
  const startIndex = total - n;
  console.log(`共 ${total} 个子块，删除最后 ${n} 个（index ${startIndex}~${total - 1}）`);
  const delRes = await req('DELETE', `/open-apis/docx/v1/documents/${DOC_ID}/blocks/${DOC_ID}/children/batch_delete`,
    { start_index: startIndex, end_index: total }, token);
  console.log('删除结果:', JSON.stringify(delRes));
}

async function main() {
  const tokenRes = await req('POST', '/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET,
  });
  const token = tokenRes.tenant_access_token;
  console.log('Token OK:', !!token);

  // 先删掉之前写入的测试块（1 个）
  if (process.argv[2] === '--clean') {
    await deleteLastN(token, 1);
    return;
  }

  const blocks = [
    // ══ 分隔 ══
    divider(),
    para('── 以下为补充章节（v1.1 新增）──', true),
    divider(),

    // ══════════════════════════════════════════
    // 2. 目标与非目标
    // ══════════════════════════════════════════
    h1('2. 目标与非目标（Goals & Non-Goals）'),

    h2('✅ 目标（Goals）'),
    bullet('提供统一的 Web 界面，管理各 AI 厂商模型的价格数据（增删改查 + 批量导入）'),
    bullet('支持按分类、厂商、规格多维度筛选与排序，快速定位模型'),
    bullet('提供成本估算器：输入使用量参数，自动对比所有可用模型的费用并排序'),
    bullet('支持人民币/美元双币显示，内置固定汇率换算'),
    bullet('支持浅色/深色主题，列宽可拖拽调整，筛选状态持久化'),
    bullet('支持分组视图与列表视图切换，分组内可折叠并拖拽排序'),

    h2('❌ 非目标（Non-Goals）'),
    para('以下内容明确不在本系统范围内，AI 开发时不得自行添加：'),
    bullet('不做 用户登录 / 权限管理 / 多租户隔离（内部工具，无需鉴权）'),
    bullet('不做 价格变更历史记录 / 审计日志 / 操作记录（后续迭代）'),
    bullet('不做 价格订阅推送 / 邮件/IM 通知（后续迭代）'),
    bullet('不做 实时同步厂商官网价格（全部为手动录入）'),
    bullet('不做 移动端 App 或小程序'),
    bullet('不做 多语言国际化'),
    bullet('不做 图表以外的数据可视化（仅成本估算页有柱状图）'),
    bullet('不做 模型 API 调用测试、质量测试'),
    bullet('不做 任何 AI 生成内容功能'),
    bullet('不做 评论 / 协作 / 版本控制'),
    bullet('不做 将 EXCHANGE_RATE 做成可配置的后台设置（当前为代码常量，修改需同步三处）'),

    // ══════════════════════════════════════════
    // 3. 功能需求
    // ══════════════════════════════════════════
    h1('3. 功能需求（Functional Requirements）'),
    para('格式：[优先级] 系统应该...'),
    para('P0 = 必须实现 / P1 = 应该实现 / P2 = 可以实现（允许暂缓）'),

    h2('3.1 模型数据管理'),
    bullet('[P0] 系统应该支持新增、编辑、删除单条模型记录，必填字段为：category（分类）、vendor（厂商）、model_name（模型名称）'),
    bullet('[P0] 系统应该在创建模型时，若传入 list_price 和 discount 但未传 discounted_price，则自动计算 discounted_price = list_price × discount'),
    bullet('[P0] 系统应该支持 Excel 文件批量导入模型数据，解析后调用 POST /api/models 逐条写入，并记录 added/updated/unchanged 计数'),
    bullet('[P0] 系统应该支持导出全部模型数据为 Excel 文件'),
    bullet('[P0] 系统应该提供「选项配置」面板，允许用户动态增删以下下拉枚举值：分类、厂商、渠道商、计费方式、规格标签'),
    bullet('[P0] 系统应该为每条模型记录维护 created_at 和 updated_at 时间戳，updated_at 通过数据库 TRIGGER 自动刷新，无需前端传入'),
    bullet('[P1] 系统应该支持为刊例价和折后价分别标记「已确认」或「待确定」状态（price_confirmed / list_price_confirmed）'),
    bullet('[P1] 系统应该支持为折后价设置到期日（discount_expires_at），并在到期前 30 天显示警告标签，到期后显示「已过期」'),
    bullet('[P1] 系统应该支持文本模型的输出价格多档位（price_output_tiers：标签 + 价格），单档时向后兼容 price_output 字段'),
    bullet('[P1] 系统应该在模型管理分组视图中支持行内拖拽排序，drop 后批量更新 sort_order 字段'),
    bullet('[P2] 系统应该支持一键「复制」已有模型（预填所有字段后打开新增弹窗）'),

    h2('3.2 价格查看与对比'),
    bullet('[P0] 系统应该支持列表视图和分组视图（按厂商分组）两种展示模式'),
    bullet('[P0] 系统应该支持按分类、厂商多选筛选，筛选条件以 Pills 形式展示，刷新后从 localStorage 恢复'),
    bullet('[P0] 系统应该在对比页提供列显示开关，允许用户控制每列是否可见，可见状态持久化到 localStorage（key: compare_visible_cols_v2）'),
    bullet('[P0] 系统应该支持按折后单价、刊例价、折扣、厂商、模型名排序'),
    bullet('[P0] 系统应该在折扣列用颜色区分折扣力度：≤40% 绿色、41–65% 黄色、>65% 红色'),
    bullet('[P1] 系统应该支持人民币与美元双币显示，按 EXCHANGE_RATE = 7.2 换算；USD 模型折后价下方额外显示换算后的人民币金额'),
    bullet('[P1] 系统应该支持所有表格列宽拖拽调整，宽度持久化到 localStorage'),
    bullet('[P1] 系统应该在分组视图中支持按厂商折叠/展开，及按模型名折叠/展开规格明细行'),

    h2('3.3 成本估算'),
    bullet('[P0] 系统应该根据用户输入的分类、生成数量、时长/token 数，自动筛选匹配模型并计算总费用'),
    bullet('[P0] 系统应该按费用从低到高排序，高亮最便宜的方案（cheapestId，以 CNY 为统一基准）'),
    bullet('[P0] 系统应该在结果行中展示费用计算公式（buildFormula），方便核验计算逻辑'),
    bullet('[P0] 系统应该对视频生成·按次计费模型，仅在 |input.duration - model.duration_sec| ≤ 2 时纳入对比，超出则不显示'),
    bullet('[P1] 系统应该提供柱状图可视化各模型费用对比（Recharts BarChart）'),
    bullet('[P1] 系统应该支持按厂商多选筛选，缩小对比范围（状态持久化 localStorage key: calc_filter_vendors）'),
    bullet('[P1] 系统应该展示 CALC_HINTS 卡片说明各分类的计费口径（类型名 + 公式 + 橙色 note），不显示 why 说明文字'),
    bullet('[P1] 系统应该支持对结果列表分页展示，每页 20 条（PAGE_SIZE = 20）'),
    bullet('[P1] 系统应该支持按单条成本或总费用两种维度排序，列标题点击切换升降序'),

    // ══════════════════════════════════════════
    // 4. 用户故事
    // ══════════════════════════════════════════
    h1('4. 用户故事 / 使用场景（User Stories）'),

    h2('场景 A：录入新模型价格'),
    para('As a 内部运营人员，I want 在模型管理页新增一条 glm-4.5 文本模型的价格，填写输入价、多档输出价，并标记折扣待确定，So that 团队成员查询时能看到最新价格，并清楚知道折扣尚未确认。'),
    para('验收要点：'),
    bullet('弹窗中 category 选"文本模型"后，显示输入价 + 输出价档位区域'),
    bullet('可添加多档输出价（如 0~128K / 128K+），每档填标签和单价'),
    bullet('折扣确认状态可切换为「⏳ 待确定」'),
    bullet('保存后列表刷新，新记录可见'),

    para('As a 运营人员，I want 批量导入一份包含 30 条模型数据的 Excel，So that 不需要逐条手动录入，节省时间。'),
    para('验收要点：'),
    bullet('选择 .xlsx 文件后系统自动解析并按字段映射写入'),
    bullet('页面提示 added/updated/unchanged 计数'),
    bullet('导入失败的行有错误提示，不阻断其他行'),

    h2('场景 B：查询某类模型价格'),
    para('As a 产品经理，I want 在价格对比页筛选「视频生成」分类，按折后价升序排列，So that 快速找到当前最便宜的视频生成模型。'),
    para('验收要点：'),
    bullet('选中「视频生成」分类 Pill 后，列表立即过滤'),
    bullet('可按「折后单价」列排序'),
    bullet('筛选状态刷新页面后保留'),

    para('As a 产品经理，I want 在分组视图中展开「字节」厂商，看到旗下各视频模型按规格分行展示，So that 可以横向对比同一厂商不同规格的价格差异。'),
    para('边界情况：'),
    bullet('厂商下无模型时，折叠按钮禁用或隐藏'),
    bullet('模型名相同但规格不同的行，折叠模型时整组收起'),

    h2('场景 C：估算项目成本'),
    para('As a 商务人员，I want 输入「视频生成，100 条，每条 5 秒」，查看各模型的估算总费用并排序，So that 项目报价时能快速选出性价比最高的方案。'),
    para('验收要点：'),
    bullet('结果列表按总费用升序，最低价绿色高亮'),
    bullet('每行展示计算公式（如 ¥0.0200/秒 × 5s × 100条）'),
    bullet('「按次」计费模型仅显示时长匹配的版本（误差≤2秒）'),
    bullet('右侧柱状图可视化各模型费用差距'),

    para('As a 商务人员，I want 估算文本模型费用，输入每次请求 1K tokens 输入 + 2K tokens 输出，发起 500 次，So that 对比 glm-4.5 和其他文本模型的实际花费。'),
    para('边界情况：'),
    bullet('文本模型 discounted_price（输入价）为 null 时，输入部分费用为 0'),
    bullet('price_output_discounted 为 null 时，输出部分费用为 0'),
    bullet('两者均为 null 时，该模型不参与对比'),

    h2('场景 D：折扣到期提醒'),
    para('As a 运营人员，I want 看到折扣即将到期的模型自动显示黄色警告标签「⚠14天」，So that 及时联系厂商续签或更新价格。'),
    para('边界情况：'),
    bullet('超过 30 天显示灰色到期日（MM/DD 格式）'),
    bullet('已过期显示红色「已过期」'),
    bullet('未设置 discount_expires_at 时不显示任何标签'),

    // ══════════════════════════════════════════
    // 5. 技术规格补充
    // ══════════════════════════════════════════
    h1('5. 技术规格补充（Technical Specifications）'),
    para('注：现有文档第二节「💻技术要求」已覆盖完整架构，本节补充关键设计决策。'),

    h2('5.1 架构决策记录（ADR）'),
    bullet('数据库：SQLite (better-sqlite3)，理由：零运维、单文件、适合内部轻量工具。不选 PostgreSQL（过重）、Prisma（增加复杂性）'),
    bullet('API 层：Next.js Route Handlers，理由：与前端同仓库，无需单独后端。不选 Express 独立服务（不必要）'),
    bullet('状态管理：React useState + localStorage，理由：无跨页面复杂状态，无需全局 store。不选 Redux/Zustand（过度设计）'),
    bullet('主题：CSS 变量 + .dark class，理由：不依赖 Tailwind dark: 修饰符，行为可控。不选 prefers-color-scheme（无法手动切换）'),
    bullet('列宽持久化：localStorage per-page key，理由：各页独立，互不干扰。不选 URL 参数（会污染分享链接）'),

    h2('5.2 数据流示意'),
    code('用户操作\n  → React State 更新\n  → fetch /api/models 或 /api/config\n  → Next.js Route Handler\n  → better-sqlite3 同步读写 data/pricing.db\n  → 返回 JSON → 前端重新渲染'),

    h2('5.3 关键约束（不得违反）'),
    bullet('所有 API 路由必须标注 export const dynamic = "force-dynamic"，禁止 Next.js 静态缓存'),
    bullet('better-sqlite3 为同步 API，不兼容 Edge Runtime，路由必须在 Node.js runtime 运行'),
    bullet('新增 DB 字段必须走 try { ALTER TABLE } catch {} 增量迁移，不得重建表'),
    bullet('EXCHANGE_RATE 在三个页面顶部各自定义为常量，修改时需同步：admin/models、compare、calculator 三处'),

    // ══════════════════════════════════════════
    // 6. UI/UX 规格
    // ══════════════════════════════════════════
    h1('6. UI/UX 规格（Design Specifications）'),

    h2('6.1 页面流程'),
    code('/ (首页)\n├── /admin/models     模型管理（增删改查 + 导入导出）\n├── /compare          价格对比（只读查询）\n└── /calculator       成本估算（交互计算）'),
    para('侧边栏导航贯穿所有页面（NavProvider 管理折叠状态），折叠态仅显示图标，展开态显示文字。主题切换按钮在侧边栏底部。'),

    h2('6.2 模型管理页（/admin/models）'),
    code('顶部操作栏：[列表视图][分组视图]  搜索框  [筛选Pills:分类/厂商]  [+新增][导入][导出][⚙选项配置]\n\n列表视图表格：\n分类 | 厂商 | 模型 | 版本 | 规格 | 时长 | 计费 | 刊例价 | 折扣 | 折后价 | 操作[⧉▾][🗑]\n（行内编辑态：输入框直接覆盖单元格内容）'),
    para('操作栏 Split Button 规则：'),
    bullet('主按钮「⧉ 复制」→ 打开 ModelModal（mode=copy，预填当前行数据）'),
    bullet('下拉 ▾ → 展开含「✏ 编辑」的下拉菜单（position:fixed 定位，避免被 overflow 截断）'),
    bullet('🗑 删除独立按钮'),
    para('文本模型价格列特殊展示：'),
    bullet('列分两行：第一行「输入 ¥x.xxxx/M」，第二行「输出 ¥x.xxxx/M」'),
    bullet('输出价有多档时，每档分行显示（标签 + 价格）'),

    h2('6.3 价格对比页（/compare）'),
    code('筛选区：分类Pills | 厂商Pills | 计费方式Pills | 规格Pills | 币种切换 | [列显示▾]\n\n表格：厂商 | 模型 | 版本 | 规格 | 时长 | 计费 | 刊例价 | 折扣↑↓ | 折后价↑↓\n（可见列由用户勾选，默认隐藏：渠道商/分辨率/并发/备注/更新时间）'),

    h2('6.4 成本估算页（/calculator）'),
    code('输入区：\n  分类 [Tab: 图片/视频/对口型/文本]\n  生成数量:[___]  时长:[___]s  规格:[Pills]  厂商筛选:[Pills]\n  （文本模型时显示：输入Tokens[___]K  输出Tokens[___]K）\n\n左侧：CALC_HINTS 卡片（类型名 + 公式 + 橙色 note，不显示 why 说明文字）\n右侧：Recharts BarChart 柱状图\n\n结果表格：# | 厂商 | 模型 | 规格 | 时长 | 计费 | 折后单价↑↓ | 单条成本↑↓ | 估算总费用↑↓ | 更新时间\n🏆 cheapestId 行绿色高亮，不随排序变化；分页每页 20 条'),

    // ══════════════════════════════════════════
    // 7. 非功能需求
    // ══════════════════════════════════════════
    h1('7. 非功能需求（Non-Functional Requirements）'),

    h2('7.1 性能要求'),
    bullet('页面首次加载 < 2s（Vercel CDN + SSR）'),
    bullet('200 条模型列表渲染流畅，列宽拖动无卡顿'),
    bullet('成本估算用 useMemo 派生排序结果，参数变化时立即响应'),
    bullet('Excel 导入（≤500行）< 5s 完成'),
    bullet('结果列表分页展示，每页 20 条，避免大量 DOM 节点渲染卡顿'),

    h2('7.2 安全要求'),
    bullet('无鉴权：内部工具，不做登录和权限控制（明确非目标）'),
    bullet('SQL 注入防护：所有 DB 操作使用 better-sqlite3 Prepared Statement，不拼接 SQL 字符串'),
    bullet('API 字段白名单：PUT /api/config 的 key 必须在 ALLOWED_KEYS 白名单内，否则返回 400'),
    bullet('XSS：React 默认转义，不使用 dangerouslySetInnerHTML'),

    h2('7.3 兼容性要求'),
    bullet('浏览器：Chrome / Edge / Firefox 最新两个主版本'),
    bullet('屏幕宽度：≥ 1280px（内部工具，不做移动端适配）'),
    bullet('部署环境：Vercel（Node.js runtime，非 Edge Runtime）'),
    bullet('本地开发：Node.js 18+，npm run dev 启动'),

    h2('7.4 交互逻辑说明'),
    para('筛选器行为：'),
    bullet('多选 Pills：点击选中高亮，再次点击取消；全不选等价于「显示全部」'),
    bullet('筛选状态通过 localStorage 持久化，key 含版本号（如 _v2）防止格式变更后脏数据'),
    bullet('筛选结果实时响应，无需点击「确认」按钮'),
    para('弹窗行为：'),
    bullet('新增/编辑弹窗（ModelModal）：max-h-[90vh] overflow-y-auto，内容过长时可滚动'),
    bullet('保存成功显示绿色提示，失败显示红色提示'),
    bullet('点击遮罩层不关闭弹窗（防误操作）'),
    para('折后价自动计算：'),
    bullet('ModelModal 中输入 list_price 和 discount → 实时显示折后价预览（前端计算，不影响字段独立编辑）'),
    bullet('文本模型输出价折后：tier.price × (model.discount ?? 1)，前端实时计算显示'),

    // ══════════════════════════════════════════
    // 9. 验收标准
    // ══════════════════════════════════════════
    h1('9. 验收标准（Acceptance Criteria）'),

    h2('9.1 模型管理'),
    bullet('[ ] 新增模型：填写 category + vendor + model_name → 保存成功 → 列表出现该记录'),
    bullet('[ ] 编辑模型：修改任意字段保存 → updated_at 更新为当前时间'),
    bullet('[ ] 删除模型：删除后列表不再显示该记录'),
    bullet('[ ] 自动计算折后价：传入 list_price=1.0 + discount=0.7 → discounted_price 自动为 0.7'),
    bullet('[ ] 待确定状态：点击「✓ 已确认」切换为「⏳ 待确定」，再次点击恢复'),
    bullet('[ ] 折扣到期：设置 discount_expires_at 为明天 → 显示黄色「⚠1天」'),
    bullet('[ ] 文本模型多档位：添加两档输出价（0-128K 和 128K+）→ 保存后列表展示两行'),
    bullet('[ ] Excel 导入：上传合法格式文件 → 显示 added/updated 计数，数据出现在列表'),
    bullet('[ ] 选项配置：在「厂商」中新增「测试厂商」→ 新增模型弹窗厂商下拉中出现该选项'),
    bullet('[ ] 分组视图折叠：点击厂商标题行 → 该厂商下所有模型行收起，再次点击展开'),

    h2('9.2 价格对比'),
    bullet('[ ] 筛选：选中「视频生成」分类 Pill → 仅显示该分类模型'),
    bullet('[ ] 多选筛选：同时选中「智谱」和「火山」→ 显示两个厂商的模型'),
    bullet('[ ] 刷新保留筛选：刷新页面后筛选状态恢复'),
    bullet('[ ] 列显示开关：隐藏「备注」列 → 表格不显示备注列，刷新后状态保留'),
    bullet('[ ] USD 换算：将币种切换为 USD → 原 RMB 模型显示美元价格'),
    bullet('[ ] 列宽拖拽：拖拽列边缘 → 列宽改变，刷新后保留'),

    h2('9.3 成本估算'),
    bullet('[ ] 视频估算：输入 100 条 × 5秒 → 按秒计费模型费用 = discounted_price × 5 × 100'),
    bullet('[ ] 时长过滤：按次计费且 model.duration_sec = 10 的模型，输入时长 5s → 该模型不出现在结果中'),
    bullet('[ ] 最低价高亮：cheapestId 行绿色高亮，排序方向改变时高亮不变'),
    bullet('[ ] 文本模型：输入 1K input + 2K output × 500次 → 费用 = (1/1000×priceIn + 2/1000×priceOut)×500'),
    bullet('[ ] 厂商筛选：仅选「智谱」→ 结果表只显示智谱旗下模型'),
    bullet('[ ] 分页：结果超过 20 条 → 显示翻页控件，点击下一页显示第 21～40 条'),
    bullet('[ ] 柱状图：结果有数据 → 柱状图正确显示各模型费用'),

    h2('9.4 通用'),
    bullet('[ ] 主题切换：点击切换按钮 → 页面变为深色模式，刷新后保持深色'),
    bullet('[ ] 侧边栏折叠：点击折叠按钮 → 侧边栏收起为图标态，主内容区域扩展'),
    bullet('[ ] 更新时间格式：updated_at 显示为「03/13 10:30」（上行）+ 「今天」（下行），无「上午/下午」字样'),
    bullet('[ ] 部署验证：Vercel 部署后 GET /api/models 能正常返回数据'),

    // ══════════════════════════════════════════
    // 10. 术语表
    // ══════════════════════════════════════════
    h1('10. 术语表（Glossary）'),

    h2('价格相关'),
    bullet('刊例价 (list_price)：厂商官方公开报价，未打折的原始价格'),
    bullet('折后价 (discounted_price)：经过折扣后的实际计费单价，= 刊例价 × 折扣率'),
    bullet('折扣率 (discount)：0~1 的小数，0.7 = 七折（70%）。UI 展示时 ×100 显示百分比，存储时为小数'),
    bullet('price_output_tiers：文本模型输出价多档位，JSON 格式 [{label: string, price: number}]，单档时为 NULL'),
    bullet('EXCHANGE_RATE：人民币/美元汇率常量，当前值 7.2，定义在 admin/models、compare、calculator 三个页面文件顶部，修改须同步三处'),

    h2('技术术语'),
    bullet('isMTokenBilling：判断是否为文本类/百万token计费模型的布尔值，= category === "文本模型" || billing_type === "百万tokens"'),
    bullet('ConfigData：系统配置数据类型，包含 categories/vendors/billing_types/channels/resolution_labels 5个 string[]'),
    bullet('cheapestId：成本估算结果中以 CNY 计算最低总费用的模型 id，用于绿色高亮行，不随排序方向变化'),
    bullet('sort_order：分组视图内的手动排序权重，默认等于 id，拖拽排序后更新'),
    bullet('WAL checkpoint：SQLite WAL 模式下将 .db-wal 写回主文件的操作，提交前必须执行，否则 GitHub 上的 pricing.db 为旧数据'),
    bullet('ModelForm：编辑弹窗内部状态类型，所有字段均为 string（含数值字段），保存时转换为正确类型'),
    bullet('modelToForm()：将后端 Model 对象转换为 ModelForm 的函数，含老记录自动升级为单档 tiers 格式的兼容逻辑'),
    bullet('relTime()：将 updated_at 渲染为「MM/DD HH:mm + 相对时间」的工具函数，三个页面各自定义，不共享'),

    h2('UI 术语'),
    bullet('Split Button：操作栏的组合按钮：左侧主操作「⧉ 复制」+ 右侧 ▾ 下拉菜单「✏ 编辑」'),
    bullet('v2 后缀：localStorage key 的版本后缀（如 compare_filters_v2），格式变更时升级后缀强制清除旧数据'),
    bullet('resolution_label：规格标签，逗号分隔多值如 "720p,1080p"，与 resolution（原始分辨率字符串如 "1920x1080"）是两个不同字段'),

    h2('计费方式'),
    bullet('按次：每次 API 调用收固定费，与时长无关'),
    bullet('按秒：按视频实际时长计费，单价单位为 ¥/秒'),
    bullet('百万tokens：按 token 消耗量计价，用于文本模型（输入/输出分别计费）或豆包视频模型（5s ≈ 1万 tokens）'),
  ];

  await appendBlocks(token, blocks);
  console.log('\n🎉 全部写入完成！共', blocks.length, '个块');
}

main().catch(console.error);
