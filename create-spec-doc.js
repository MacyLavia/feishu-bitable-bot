/**
 * 生成 AI 模型价格管理平台 · 需求规格说明 Spec 文档
 * 目标: https://pcn28q31n7ee.feishu.cn/docx/Dfz0dQw37oUMoKxt4zicsKp2n5g
 */
const https = require('https')

const APP_ID     = 'cli_a9143292ee391cc9'
const APP_SECRET = '4AHv3R5tmEXZ06NmRRnW2f2qrAWu1k0J'
const DOC_ID     = 'Dfz0dQw37oUMoKxt4zicsKp2n5g'

function feishu(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : ''
    const h = { 'Content-Type': 'application/json; charset=utf-8' }
    if (b) h['Content-Length'] = Buffer.byteLength(b)
    if (token) h['Authorization'] = 'Bearer ' + token
    const r = https.request({ hostname: 'open.feishu.cn', path, method, headers: h }, res => {
      let d = ''; res.on('data', c => d += c)
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch(e) { resolve({ raw: d }) } })
    })
    r.on('error', reject)
    if (b) r.write(b)
    r.end()
  })
}

// ── Block 构建 ────────────────────────────────────────────────
const run  = (content, style = {}) => ({ text_run: { content, text_element_style: style } })
const bold = (t) => run(t, { bold: true })
const ic   = (t) => run(t, { inline_code: true })
const it   = (t) => run(t, { italic: true })

const h1 = (t) => ({ block_type: 3, heading1: { elements: [run(t)], style: {} } })
const h2 = (t) => ({ block_type: 4, heading2: { elements: [run(t)], style: {} } })
const h3 = (t) => ({ block_type: 5, heading3: { elements: [run(t)], style: {} } })
const p  = (...els) => ({ block_type: 2, text: { elements: els, style: {} } })
const bl = (...els) => ({ block_type: 12, bullet: { elements: els, style: {} } })
const hr = () => ({ block_type: 22, divider: {} })

// ── 文档内容 ──────────────────────────────────────────────────
const BLOCKS = [

  // ═══════════════════════════════════════════════════════════
  // 标题 & 元信息
  // ═══════════════════════════════════════════════════════════
  h1('AI 模型价格管理平台 · 需求规格说明 Spec'),
  p(it('版本 v1.0 · 2026-03-12 · 面向 AI 模型，用于代码理解、维护与功能扩展')),
  p(run('本文档完整描述系统的数据模型、API 规格、业务逻辑规则、UI 行为和已知约束，读取本文档后应能独立完成任意功能的新增与修改而不破坏现有逻辑。')),
  hr(),

  // ═══════════════════════════════════════════════════════════
  // 一、系统概览
  // ═══════════════════════════════════════════════════════════
  h2('一、系统概览'),
  bl(bold('定位：'), run('内部工具，集中管理各 AI 厂商模型定价信息，支持查询对比与成本估算')),
  bl(bold('仓库：'), ic('https://github.com/MacyLavia/ai-model-pricing'), run('  branch: master')),
  bl(bold('本地路径：'), ic('D:/claude_projects/ai-model-pricing/')),
  bl(bold('部署：'), run('Vercel（免费额度，GitHub 集成，push 自动部署）')),
  bl(bold('Dev 启动：'), ic('cd D:/claude_projects/ai-model-pricing && npm run dev')),
  bl(bold('构建：'), ic('npm run build')),

  h3('技术栈'),
  bl(bold('框架：'), ic('Next.js 16 App Router'), run(' + TypeScript，'), ic('\'use client\''), run(' 标记客户端组件')),
  bl(bold('样式：'), ic('Tailwind CSS v4'), run('（'), ic('@import "tailwindcss"'), run('，CSS 变量系统，不用 dark: 工具类）')),
  bl(bold('数据库：'), ic('SQLite'), run(' via '), ic('better-sqlite3'), run('，单文件 '), ic('data/pricing.db')),
  bl(bold('Excel：'), ic('SheetJS (xlsx)'), run('，导入导出')),
  bl(bold('图表：'), ic('Recharts'), run('，成本估算柱状图')),
  bl(bold('主题：'), run('默认浅色，深色用 '), ic('.dark'), run(' class on '), ic('<html>'), run('，ThemeProvider 管理')),
  hr(),

  // ═══════════════════════════════════════════════════════════
  // 二、文件结构
  // ═══════════════════════════════════════════════════════════
  h2('二、关键文件结构'),
  bl(ic('lib/db.ts'), run('  —  SQLite 连接、schema 初始化、增量 ALTER TABLE 迁移（新字段用 try/catch 静默忽略已有列）')),
  bl(ic('lib/types.ts'), run('  —  Model / StatsData / UploadHistory 接口定义')),
  bl(ic('app/globals.css'), run('  —  CSS 变量系统（:root=浅色，.dark=深色）、.data-table 样式')),
  bl(ic('components/ThemeProvider.tsx'), run('  —  主题 Context，初始化读 localStorage，切换写 localStorage + 切换 html.dark')),
  bl(ic('components/Nav.tsx'), run('  —  侧边栏导航，折叠态/展开态，底部主题切换按钮')),
  bl(ic('components/NavProvider.tsx'), run('  —  侧边栏折叠状态 Context')),
  bl(ic('app/api/models/route.ts'), run('  —  GET（列表查询）/ POST（新建）')),
  bl(ic('app/api/models/[id]/route.ts'), run('  —  PUT（更新）/ DELETE（删除）')),
  bl(ic('app/api/config/route.ts'), run('  —  GET/PUT 系统配置（分类/厂商/计费方式/渠道/规格标签）')),
  bl(ic('app/admin/models/page.tsx'), run('  —  模型管理页（列表视图+分组视图），所有核心 CRUD 逻辑')),
  bl(ic('app/compare/page.tsx'), run('  —  价格对比页（列表+分组，列可显示/隐藏）')),
  bl(ic('app/calculator/page.tsx'), run('  —  成本估算页（输入参数→多模型费用对比）')),
  bl(ic('data/pricing.db'), run('  —  SQLite 数据库，134 条模型，提交前须做 WAL checkpoint')),
  hr(),

  // ═══════════════════════════════════════════════════════════
  // 三、数据模型
  // ═══════════════════════════════════════════════════════════
  h2('三、数据模型'),

  h3('3.1 models 表（核心表）'),
  p(run('以下为完整字段清单，括号内为 SQLite 类型，* 为必填：')),
  bl(ic('id'), run('  INTEGER PK AUTOINCREMENT')),
  bl(ic('category *'), run('  TEXT  —  能力分类，枚举值来自 settings.categories。当前值：图片模型 / 视频生成 / 对口型 / 文本模型')),
  bl(ic('vendor *'), run('  TEXT  —  厂商名，如 智谱 / 火山 / 可灵 / gpt')),
  bl(ic('channel'), run('  TEXT DEFAULT \'MUSE AI\'  —  渠道商')),
  bl(ic('model_name *'), run('  TEXT  —  模型标识名（如 glm-4.5），API 调用名')),
  bl(ic('model_version'), run('  TEXT  —  细化版本描述（默认等于 model_name）')),
  bl(ic('resolution'), run('  TEXT NULL  —  原始分辨率字符串（可选，非结构化）')),
  bl(ic('resolution_label'), run('  TEXT NULL  —  规格标签，逗号分隔多值如 "720p,1080p"，来自 settings.resolution_labels')),
  bl(ic('duration_sec'), run('  REAL NULL  —  视频时长（秒），用于按次计费的时长匹配')),
  bl(ic('billing_type'), run('  TEXT NULL  —  计费方式，枚举：次 / 秒 / 百万tokens')),
  bl(ic('currency'), run('  TEXT DEFAULT \'RMB\'  —  币种：RMB 或 USD')),
  bl(ic('list_price'), run('  REAL NULL  —  刊例价（¥ 或 $ 每次/秒/M tokens，文本模型为输入价）')),
  bl(ic('discount'), run('  REAL NULL  —  折扣率，0~1 小数（如 0.5 = 五折）')),
  bl(ic('discounted_price'), run('  REAL NULL  —  折后单价。可由 API 自动计算：list_price × discount（仅当传入 discount 且未传 discounted_price 时）')),
  bl(ic('price_output'), run('  REAL NULL  —  文本模型输出刊例价（¥/M tokens），向后兼容，存多档 tiers 的第一档 price')),
  bl(ic('price_output_discounted'), run('  REAL NULL  —  文本模型输出折后价（¥/M tokens），向后兼容第一档')),
  bl(ic('price_output_tiers'), run('  TEXT NULL  —  JSON 数组：'), ic('[{label: string, price: number}]'), run('。单档无标签存 NULL，多档时使用此字段；前端解析时 try/catch')),
  bl(ic('concurrency'), run('  INTEGER NULL  —  并发数限制')),
  bl(ic('quality_score'), run('  REAL NULL  —  质量评分（0~10）')),
  bl(ic('sort_order'), run('  INTEGER NULL  —  分组视图内手动排序权重，默认等于 id')),
  bl(ic('price_confirmed'), run('  INTEGER DEFAULT 1  —  折扣价已确认标志，0=待确定，1=已确认')),
  bl(ic('list_price_confirmed'), run('  INTEGER DEFAULT 1  —  刊例价已确认标志，0=待确定，1=已确认')),
  bl(ic('discount_expires_at'), run('  TEXT NULL  —  折扣到期日，格式 YYYY-MM-DD')),
  bl(ic('tags'), run('  TEXT DEFAULT \'[]\'  —  JSON 字符串数组')),
  bl(ic('notes'), run('  TEXT DEFAULT \'\'  —  备注文本')),
  bl(ic('sample_urls'), run('  TEXT DEFAULT \'[]\'  —  JSON 字符串数组，示例图/视频 URL')),
  bl(ic('product_lines'), run('  TEXT DEFAULT \'["muse_ai"]\'  —  JSON 字符串数组')),
  bl(ic('created_at'), run('  DATETIME  —  SQLite CURRENT_TIMESTAMP，存储为 UTC，格式 "YYYY-MM-DD HH:MM:SS"')),
  bl(ic('updated_at'), run('  DATETIME  —  同上。通过 SQL TRIGGER 在每次 UPDATE 后自动刷新')),

  h3('3.2 settings 表（系统配置）'),
  bl(run('结构：'), ic('key TEXT PK'), run('，'), ic('value TEXT（JSON 数组）')),
  bl(ic('categories'), run('  —  能力分类选项，如 ["图片模型","视频生成","对口型","文本模型"]')),
  bl(ic('vendors'), run('  —  厂商选项')),
  bl(ic('billing_types'), run('  —  计费方式选项：["次","秒","百万tokens"]')),
  bl(ic('channels'), run('  —  渠道商选项：["MUSE AI"]')),
  bl(ic('resolution_labels'), run('  —  规格标签选项：["不限","720p","1080p","2K","4K"]（可动态增删）')),

  h3('3.3 TypeScript 接口（lib/types.ts）'),
  bl(ic('Model'), run('  —  对应 models 表全部字段，'), ic('tags/sample_urls/product_lines/price_output_tiers'), run(' 在 DB 中为 JSON 字符串，前端使用前需手动 JSON.parse')),
  bl(ic('ConfigData'), run('  —  5 个 string[] 字段，由 /api/config GET 返回，PUT 逐 key 更新')),
  bl(ic('UploadHistory'), run('  —  upload_history 表记录，含 added/updated/unchanged 计数')),
  hr(),

  // ═══════════════════════════════════════════════════════════
  // 四、API 规格
  // ═══════════════════════════════════════════════════════════
  h2('四、API 规格'),
  p(run('所有 API 路由均标注 '), ic('export const dynamic = \'force-dynamic\''), run('，禁止静态缓存。')),

  h3('4.1  GET /api/models'),
  p(run('返回 Model[] 数组，所有参数均为可选查询字符串：')),
  bl(ic('category'), run('  精确匹配')),
  bl(ic('vendor'), run('  精确匹配')),
  bl(ic('channel'), run('  精确匹配')),
  bl(ic('billing_type'), run('  精确匹配')),
  bl(ic('resolution_label'), run('  LIKE 匹配（%value%），值为 "不限" 时不过滤')),
  bl(ic('search'), run('  模糊匹配 model_name / model_version / vendor')),
  bl(ic('price_confirmed=0'), run('  仅返回 price_confirmed=0 或 list_price_confirmed=0 的记录')),
  bl(ic('sort'), run('  排序字段（白名单：discounted_price/list_price/discount/vendor/category/model_name/created_at），默认 discounted_price')),
  bl(ic('order'), run('  asc（默认）/ desc')),
  p(run('排序特例：'), ic('sort=vendor'), run(' 时使用 vendor ASC, model_name ASC, sort_order ASC NULLS LAST, id ASC（分组视图标准排序）')),

  h3('4.2  POST /api/models'),
  p(run('必填字段：'), ic('category'), run('、'), ic('vendor'), run('、'), ic('model_name'), run('。其余字段可选，默认值见 models 表定义。')),
  p(bold('自动计算规则：'), run('若传入 '), ic('list_price'), run(' 和 '), ic('discount'), run(' 但未传 '), ic('discounted_price'), run('，则 '), ic('discounted_price = list_price × discount'), run('。')),
  p(run('返回：201 + 新建 Model 对象')),

  h3('4.3  PUT /api/models/[id]'),
  p(run('请求体结构与 POST 相同（全量更新）。'), ic('updated_at'), run(' 由数据库 TRIGGER 自动更新，不需传入。')),
  p(run('返回：200 + 更新后的 Model 对象。404 若 id 不存在。')),

  h3('4.4  DELETE /api/models/[id]'),
  p(run('返回：'), ic('{ success: true }'), run('。404 若 id 不存在。')),

  h3('4.5  GET /api/config'),
  p(run('返回完整 ConfigData 对象，所有 5 个 key 均包含。')),

  h3('4.6  PUT /api/config'),
  p(run('Body: '), ic('{ key: string, values: string[] }'), run('。key 必须在白名单内（categories/vendors/billing_types/channels/resolution_labels），否则 400。values 过滤空值并 trim。')),
  hr(),

  // ═══════════════════════════════════════════════════════════
  // 五、业务逻辑规则
  // ═══════════════════════════════════════════════════════════
  h2('五、业务逻辑规则'),

  h3('5.1  isMTokenBilling 判断'),
  p(run('判断是否为文本类/按百万 token 计费模型，控制价格列的显示形式和成本计算入口：')),
  bl(ic('isMTokenBilling = category === \'文本模型\' || billing_type === \'百万tokens\'')),
  p(run('此条件在 admin、compare、calculator 三处各自独立计算，未抽取为共享函数。')),

  h3('5.2  price_output_tiers 多档位规则'),
  bl(run('单档无标签：'), ic('price_output_tiers = NULL'), run('，价格存 '), ic('price_output')),
  bl(run('多档：'), ic('price_output_tiers = JSON stringify([{label, price}, ...])'), run('，同时 '), ic('price_output'), run(' 冗余存第一档 price（向后兼容）')),
  bl(run('前端读取时：优先解析 '), ic('price_output_tiers'), run('，为空则 fallback 到 '), ic('price_output'), run('（单档）')),
  bl(run('折后价显示：'), ic('tier.price × model.discount'), run('（前端实时计算，不另存字段）')),
  bl(run('UI: modelToForm() 将老记录自动升级为单档 tiers 格式（无感兼容）')),

  h3('5.3  汇率换算'),
  bl(ic('EXCHANGE_RATE = 7.2'), run('（RMB/USD），在三个页面文件顶部各自 const 定义，修改时须同步三处')),
  bl(run('USD 模型折后价展示时，下方加一行 '), ic('≈¥xx.xxxx'), run('（EXCHANGE_RATE × 价格）')),
  bl(run('成本估算排序统一换算为 CNY 再比较（cheapestId 也以 CNY 为准）')),

  h3('5.4  成本估算计算公式（calcCost 函数，calculator/page.tsx）'),
  p(run('输入：CalcInput = { category, count, duration, withAudio, resLabel, inputTokens, outputTokens }')),
  bl(bold('文本模型：'), run('inputCost = (inputTokens/1000) × discounted_price × count；outputCost = (outputTokens/1000) × price_output_discounted × count；总计 = inputCost + outputCost')),
  bl(bold('图片模型：'), run('discounted_price × count')),
  bl(bold('视频生成·百万tokens：'), run('(discounted_price/1,000,000) × (duration/5×10,000) × count')),
  bl(bold('视频生成·次（有 model.duration_sec）：'), run('仅当 |input.duration − model.duration_sec| ≤ 2 时匹配，否则返回 null（不参与对比）；费用 = discounted_price × count')),
  bl(bold('视频生成·次（无 duration_sec）：'), run('discounted_price × count')),
  bl(bold('视频生成·秒：'), run('discounted_price × duration × count')),
  bl(bold('对口型·含"5秒"计费：'), run('discounted_price × ceil(duration/5) × count')),
  bl(bold('对口型·次：'), run('discounted_price × count')),
  bl(bold('对口型·兜底：'), run('discounted_price × duration × count（按秒）')),
  p(run('返回 null 表示该模型不参与本次估算（不显示在结果表中）。')),

  h3('5.5  时间字段解析规则（relTime 函数，三页各自定义）'),
  bl(run('SQLite '), ic('CURRENT_TIMESTAMP'), run(' 存储 UTC 时间，格式 '), ic('"YYYY-MM-DD HH:MM:SS"'), run('（空格分隔）')),
  bl(run('JS 解析：'), ic('new Date(dateStr.replace(\' \', \'T\') + \'Z\')'), run('，明确声明 UTC，否则被当作本地时间（差 8 小时）')),
  bl(run('时间展示：不用 toLocaleTimeString（zh-CN 环境输出上午/下午），改用 getHours()/getMinutes() + padStart(2,\'0\')')),
  bl(run('UI 格式：上行 '), ic('MM/DD HH:mm'), run('（精确），下行相对时间（今天/昨天/N天前/N周前/N个月前/N年前）')),

  h3('5.6  折扣到期颜色规则（expiryTag/expiryBadge）'),
  bl(run('已过期（diff < 0）：红色 '), ic('#f87171')),
  bl(run('30 天内到期（0 ≤ diff ≤ 30）：黄色 '), ic('#facc15'), run('，显示剩余天数')),
  bl(run('30 天以上：灰色 '), ic('var(--text-4)'), run('，仅显示 MM/DD')),

  h3('5.7  分组视图排序规则'),
  bl(run('调用 GET /api/models?sort=vendor，后端使用 vendor ASC → model_name ASC → sort_order ASC NULLS LAST → id ASC')),
  bl(run('管理页分组视图支持行内拖拽调序，drop 后调 PUT /api/models/[id] 批量更新 sort_order')),
  hr(),

  // ═══════════════════════════════════════════════════════════
  // 六、UI 页面规格
  // ═══════════════════════════════════════════════════════════
  h2('六、UI 页面规格'),

  h3('6.1  模型管理页（/admin/models）'),
  bl(run('视图模式：列表视图（list）/ 分组视图（group），状态存 localStorage')),
  bl(run('列表视图：表格展示所有模型，支持行内编辑（editingId 状态），编辑态覆盖原行渲染')),
  bl(run('分组视图：按厂商分组，每组可折叠（vendorCollapsed: Set<string>），模型名称行可折叠规格明细（modelCollapsed: Set<string>，key = vendor__modelName）')),
  bl(run('分组视图支持拖拽排序（dragSrcId / dragOverId），drop 后批量 PUT sort_order')),
  bl(run('新增/复制：ModelModal 弹窗（state: {open, mode(create/copy/edit), form: ModelForm}）')),
  bl(run('操作栏 Split Button：主按钮「⧉ 复制」，▾ 下拉菜单含「✏ 编辑」；🗑 删除独立按钮')),
  bl(run('下拉菜单用 position:fixed + getBoundingClientRect 定位（避免 overflow:hidden 截断）')),
  bl(run('activeDropdown 状态：'), ic('{id, top, right, view: \'list\'|\'group\'}'), run('，渲染在组件根层级')),
  bl(run('筛选：filterCats / filterVendors（string[]）+ search 文本，联合过滤后端数据')),
  bl(run('Excel 导入：SheetJS 解析，字段映射，调 POST /api/models')),
  bl(run('列宽：useColumnResize hook，localStorage key: models_list_col_widths / models_group_col_widths')),

  h3('6.2  价格对比页（/compare）'),
  bl(run('ColKey 联合类型定义所有可见列，COLUMNS 数组定义默认可见性')),
  bl(run('可见列通过 visibleCols: Set<ColKey> 控制，持久化 localStorage key: compare_visible_cols_v2')),
  bl(run('updated_at 列默认隐藏，可通过列显示开关启用')),
  bl(run('筛选状态持久化 localStorage key: compare_filters_v2（含 v2 防旧数据污染）')),
  bl(run('列宽 localStorage key: compare_list_col_widths / compare_group_col_widths')),
  bl(run('分组视图与 admin 同构，vendorCollapsed + modelCollapsed')),

  h3('6.3  成本估算页（/calculator）'),
  bl(run('全宽布局（无侧边栏遮挡），输入区在上，结果表在下，右侧柱状图')),
  bl(run('CalcInput：category / count / duration / withAudio / resLabel / inputTokens / outputTokens')),
  bl(run('结果按 CNY 排序，cheapestId 锚定最低价（不随 sortBy/sortOrder 变化），高亮绿色行')),
  bl(run('sortBy: \'unit\'|\'total\'，sortOrder: \'asc\'|\'desc\'，列标题点击切换')),
  bl(run('分页：PAGE_SIZE = 20，排序后再分页')),
  bl(run('柱状图：Recharts BarChart，COLORS 数组从 accent 系列取色')),
  bl(run('CALC_HINTS 卡片：显示计费类型名 + 公式 + 橙色 note，不显示 why 说明文字')),
  bl(run('列宽 localStorage key: calc_col_widths')),
  hr(),

  // ═══════════════════════════════════════════════════════════
  // 七、主题与样式系统
  // ═══════════════════════════════════════════════════════════
  h2('七、主题与样式系统'),

  h3('7.1  CSS 变量（globals.css）'),
  p(run('所有颜色通过 CSS 变量引用，不直接使用 Tailwind 颜色工具类：')),
  bl(ic('--bg'), run('  页面背景')),
  bl(ic('--surface'), run('  卡片/表格背景')),
  bl(ic('--surface-hover'), run('  hover 背景')),
  bl(ic('--surface2'), run('  次级背景（标签、输入框）')),
  bl(ic('--border'), run('  一般边框')),
  bl(ic('--border2'), run('  强调边框（表头分割线）')),
  bl(ic('--text-1/2/3/4'), run('  文本四级灰度（1最深，4最浅）')),
  bl(ic('--accent'), run('  主色 #6366f1，'), ic('--accent-hover'), run(' #4f46e5')),

  h3('7.2  主题切换'),
  bl(run('默认浅色：'), ic(':root'), run(' 定义浅色变量值')),
  bl(run('深色：'), ic('.dark'), run(' class 覆盖深色变量值（加在 '), ic('<html>'), run(' 元素上）')),
  bl(run('ThemeProvider 初始化：读 '), ic('localStorage.getItem(\'theme\')'), run('，fallback \'light\'；调 '), ic('document.documentElement.classList.toggle(\'dark\', saved === \'dark\')')),
  bl(run('切换：toggle() → 写 localStorage → 切换 html.dark class')),

  h3('7.3  表格列宽调整（useColumnResize）'),
  bl(run('检测：th onMouseDown 时判断 '), ic('rect.right - e.clientX ≤ 8'), run('（右边缘 8px）才触发拖拽')),
  bl(run('列分割线：'), ic('box-shadow: inset -1px 0 0 var(--border2)'), run('（border-collapse 下 border 失效，用 box-shadow 代替）')),
  bl(run('持久化：每次 mousemove 写 localStorage')),
  hr(),

  // ═══════════════════════════════════════════════════════════
  // 八、状态与持久化
  // ═══════════════════════════════════════════════════════════
  h2('八、状态与 localStorage 持久化'),
  bl(ic('theme'), run('  \'light\'|\'dark\'，默认 \'light\'')),
  bl(ic('models_list_col_widths'), run('  admin 列表视图列宽 Record<string,number>')),
  bl(ic('models_group_col_widths'), run('  admin 分组视图列宽')),
  bl(ic('compare_list_col_widths'), run('  compare 列表视图列宽')),
  bl(ic('compare_group_col_widths'), run('  compare 分组视图列宽')),
  bl(ic('calc_col_widths'), run('  calculator 列宽')),
  bl(ic('compare_visible_cols_v2'), run('  compare 可见列 ColKey[]，v2 后缀防旧数据污染')),
  bl(ic('compare_filters_v2'), run('  compare 筛选状态，v2 后缀')),
  bl(ic('models_page_filters'), run('  admin 页筛选状态（search/filterCats/filterVendors）')),
  bl(ic('calc_filter_vendors'), run('  calculator 厂商筛选 string[]')),
  p(run('注意：localStorage key 版本号（如 v2）用于在格式变更后强制清除旧数据，避免脏数据复现。新增持久化字段若格式有 breaking change 需升级后缀。')),
  hr(),

  // ═══════════════════════════════════════════════════════════
  // 九、已知约束与陷阱
  // ═══════════════════════════════════════════════════════════
  h2('九、已知约束与陷阱'),

  h3('9.1  SQLite / Vercel'),
  bl(run('⚠ Vercel 只读文件系统：'), ic('lib/db.ts'), run(' 检测 process.env.VERCEL，将 data/pricing.db 复制到 /tmp 再使用；写入不持久（冷启动重置）')),
  bl(run('⚠ WAL checkpoint 必须：SQLite WAL 模式下数据先写 .db-wal，.gitignore 已排除 WAL 文件；'), bold('提交 pricing.db 前必须执行：'), ic('node -e "require(\'better-sqlite3\')(\'data/pricing.db\').pragma(\'wal_checkpoint(TRUNCATE)\')"')),
  bl(run('⚠ 增量迁移：新增字段用 '), ic('try { db.exec(\'ALTER TABLE models ADD COLUMN ...\') } catch {}'), run('，不用 IF NOT EXISTS（SQLite 语法不支持）')),

  h3('9.2  时间与时区'),
  bl(run('⚠ SQLite CURRENT_TIMESTAMP 存 UTC，JS new Date() 解析无时区标识字符串时按本地时间处理，中国（UTC+8）会差 8 小时')),
  bl(run('✅ 修复方案：'), ic('.replace(\' \', \'T\') + \'Z\''), run(' 明确声明 UTC，再 getHours() 返回本地时间')),
  bl(run('⚠ toLocaleTimeString(\'zh-CN\') 在 Node/某些 V8 环境输出 "上午09:30" 格式，避免使用，改用 getHours().padStart')),

  h3('9.3  CSS 布局'),
  bl(run('⚠ border-collapse: collapse 导致 <th> 的 position:relative 失效，列宽调整改用 getBoundingClientRect 检测右边缘')),
  bl(run('⚠ 操作栏下拉菜单必须用 position:fixed，position:absolute 会被表格容器 overflow-x:auto 截断')),
  bl(run('⚠ Tailwind v4 dark: 工具类默认响应 prefers-color-scheme 而非 class，本项目不用 dark: 工具类，完全用 CSS 变量控制主题')),

  h3('9.4  数据一致性'),
  bl(run('⚠ EXCHANGE_RATE = 7.2 在三个页面文件顶部各自定义，修改时需同步三处：'), ic('app/admin/models/page.tsx'), run('、'), ic('app/compare/page.tsx'), run('、'), ic('app/calculator/page.tsx')),
  bl(run('⚠ price_output_tiers 是 JSON 字符串，UI 写入时需 JSON.stringify，读取时 try/catch JSON.parse')),
  bl(run('⚠ discount 字段存小数（0~1），UI 展示百分比时 × 100，存储时 ÷ 100')),
  bl(run('⚠ resolution_label 支持逗号分隔多值（如 "720p,1080p"），API 过滤用 LIKE %value%')),
  hr(),

  // ═══════════════════════════════════════════════════════════
  // 十、扩展指南
  // ═══════════════════════════════════════════════════════════
  h2('十、扩展指南'),

  h3('10.1  新增 DB 字段'),
  bl(run('1. lib/db.ts initSchema() 末尾加 '), ic('try { db.exec(\'ALTER TABLE models ADD COLUMN xxx TYPE\') } catch {}')),
  bl(run('2. lib/types.ts Model 接口补充字段')),
  bl(run('3. app/api/models/route.ts POST + PUT 两处增加字段读取和写入')),
  bl(run('4. 按需在三个页面文件中添加展示和编辑逻辑')),

  h3('10.2  新增页面'),
  bl(run('在 app/ 下建目录，页面文件加 \'use client\'，从 components/ 引入 Nav、ThemeProvider')),
  bl(run('使用 var(--bg)、var(--surface) 等 CSS 变量保证主题一致性，不用 Tailwind 颜色类')),

  h3('10.3  修改汇率'),
  bl(run('三处同步修改顶部 '), ic('const EXCHANGE_RATE = 7.2'), run('：admin/models、compare、calculator 页面')),

  p(run('')),
  p(it('本文档由 Claude Code 自动生成 · AI 模型价格管理平台 Spec v1.0 · 2026-03-12')),
]

// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  process.stdout.write('Step 1  获取飞书授权...')
  const tr = await feishu('POST', '/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: APP_ID, app_secret: APP_SECRET })
  if (!tr.tenant_access_token) { console.error('\n❌ Token 失败', tr); process.exit(1) }
  const token = tr.tenant_access_token
  console.log(' ✅')

  process.stdout.write('Step 2  读取文档结构...')
  const blocksRes = await feishu('GET',
    `/open-apis/docx/v1/documents/${DOC_ID}/blocks?page_size=500`, null, token)
  if (blocksRes.code !== 0) { console.error('\n❌', JSON.stringify(blocksRes)); process.exit(1) }
  const rootBlock  = blocksRes.data?.items?.find(b => b.block_id === DOC_ID)
  const childCount = rootBlock?.children?.length || 0
  console.log(` ✅  当前子块数: ${childCount}`)

  if (childCount > 0) {
    process.stdout.write(`Step 3  清空已有 ${childCount} 个子块...`)
    const delRes = await feishu('DELETE',
      `/open-apis/docx/v1/documents/${DOC_ID}/blocks/${DOC_ID}/children/batch_delete`,
      { start_index: 0, end_index: childCount }, token)
    if (delRes.code !== 0) { console.error('\n❌', JSON.stringify(delRes)); process.exit(1) }
    console.log(' ✅')
  } else {
    console.log('Step 3  文档为空，跳过清空')
  }

  process.stdout.write('Step 4  更新文档标题...')
  const titleRes = await feishu('PATCH',
    `/open-apis/docx/v1/documents/${DOC_ID}/blocks/${DOC_ID}`,
    { update_text_elements: { elements: [{ text_run: { content: 'AI 模型价格管理平台 · 需求规格说明 Spec v1.0' } }] } }, token)
  if (titleRes.code !== 0) console.warn('\n⚠️  标题更新失败（不影响内容）:', titleRes.msg)
  else console.log(' ✅')

  console.log(`Step 5  写入 ${BLOCKS.length} 个 block（每批 20 个）`)
  const BATCH = 20
  let written = 0
  for (let i = 0; i < BLOCKS.length; i += BATCH) {
    const batch = BLOCKS.slice(i, i + BATCH)
    const res = await feishu('POST',
      `/open-apis/docx/v1/documents/${DOC_ID}/blocks/${DOC_ID}/children`,
      { children: batch, index: i }, token)
    if (res.code !== 0) {
      console.error(`\n❌ 写入失败（第 ${i} 块起）:`, JSON.stringify(res))
      process.exit(1)
    }
    written += batch.length
    console.log(`  ✅  ${written} / ${BLOCKS.length}`)
  }

  console.log('\n✅ Spec 文档写入完成！')
  console.log(`   链接：https://pcn28q31n7ee.feishu.cn/docx/${DOC_ID}`)
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1) })
