/**
 * 更新飞书「AI 模型测试框架 · 使用说明」文档
 * 目标文档：https://pcn28q31n7ee.feishu.cn/docx/BGridWskXoePymxfXHrcFCZgnuh
 *
 * 用法：node update-usage-doc.js
 */
const https = require('https');
const { FEISHU_APP_ID: APP_ID, FEISHU_APP_SECRET: APP_SECRET } = require('./config');

const DOC_ID     = 'BGridWskXoePymxfXHrcFCZgnuh';

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

// ── Block 构建工具 ─────────────────────────────────────────────
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
const code = (text, lang = 'shell') => ({
  block_type: 14,
  code: {
    elements: [run(text)],
    style: { language: lang === 'js' ? 4 : 1 },
  },
});

// ── 文档内容 ──────────────────────────────────────────────────
const BLOCKS = [

  h1('AI 模型测试框架 · 使用说明'),
  p(gray('更新于 2026-03-11 · 版本 v2.1 · 适用于 feishu-bitable-bot 仓库')),
  hr(),

  // ════════════════ 项目简介 ════════════════
  h2('📋 项目简介'),
  p(run('通过飞书多维表格统一管理 AI 模型测试用例与测试记录，支持文本、图像、视频等多类型模型自动化测试，并通过飞书群机器人触发测试或接收通知。')),
  p(run('')),
  bl(bold('多维表格 · 模型测试用例库：'), run('维护各类测试 Prompt 和参考标准')),
  bl(bold('多维表格 · 模型测试记录：'), run('存储每次测试的输出结果、响应时长、AI 评分')),
  bl(bold('飞书群机器人：'), run('通过群消息触发测试脚本、接收完成通知（带卡片 + 跳转按钮）')),
  bl(bold('单一配置文件：'), mono('models.config.js'), run('  新增模型或能力类型只改这一个文件')),
  hr(),

  // ════════════════ 快速开始 ════════════════
  h2('🚀 快速开始'),

  h3('环境要求'),
  bl(mono('Node.js 18+'), run('，无需其他依赖，全部使用内置 https/http 模块')),
  bl(run('拥有飞书应用权限（已内置，无需修改）')),
  bl(run('Dify 工作流已配置对应模型的 IF 分支')),

  h3('启动飞书机器人'),
  code('node bot-server.js'),
  p(gray('启动后在飞书群 @机器人 发「帮助」查看所有指令。机器人自动过滤重连后的历史消息，不会重复执行旧指令。')),

  h3('直接在终端运行'),
  code('node run-model-text-test.js --model glm-4.5\nnode run-media-test.js --model midjourney\nnode ai-scoring.js\nnode patch-cases.js --apply'),
  hr(),

  // ════════════════ 飞书群机器人 ════════════════
  h2('🤖 飞书群机器人（bot-server.js）'),
  p(run('在群里 @机器人 加指令使用。所有完成通知以卡片消息发送，含摘要信息和跳转多维表格按钮。')),

  h3('跑测试'),
  bl(bold('图像生成：')),
  p(mono('跑测试 --model Midjourney')),
  p(mono('跑测试 --model Midjourney --ability 图像生成·文本')),
  bl(bold('视频生成：')),
  p(mono('跑测试 --model 豆包-Seedance-Lite')),
  p(mono('跑测试 --model 豆包-Seedance-Lite --ability 视频生成·文本')),
  bl(bold('文本模型（via Dify）：')),
  p(mono('跑测试 --model glm-4.5')),
  p(mono('跑测试 --ability 文本生成·文案'), run('  （--model 可省略，默认 glm-4.5）')),
  p(mono('跑测试 --model qwen3.5-plus --ability 文本生成·歌词')),

  h3('评分'),
  p(run('对文本类测试记录进行 AI 自动评分，完成后发卡片含「查看模型测试记录」按钮。')),
  bl(mono('评分'), run('  —  评文本类未评分记录')),
  bl(mono('评分 --all'), run('  —  强制重评所有记录')),
  bl(mono('评分 --batch 202503-glm-4.5'), run('  —  指定批次')),
  bl(mono('评分 --batch 202503-glm-4.5 --all'), run('  —  指定批次强制重评')),

  h3('补全用例'),
  p(run('AI 自动补全用例库空字段，完成后发卡片含「查看模型测试用例库」按钮。')),
  bl(mono('补全用例'), run('  —  补全全部空字段')),
  bl(mono('补全用例 --ability 视频生成·文本'), run('  —  只补全指定能力类型')),

  h3('技术说明'),
  bl(bold('友好模型名称：'), mono('Midjourney'), run(' 自动解析为 '), mono('midjourney'), run('；'), mono('豆包-Seedance-Lite'), run(' 根据 ability 自动路由 t2v / i2v')),
  bl(bold('历史消息过滤：'), run('记录启动时间戳，重连后推送的旧消息（create_time 早于启动时刻）一律跳过，不重复执行')),
  bl(bold('发送重试：'), run('消息/卡片发送失败自动重试 3 次（间隔 1s/2s），全失败时卡片降级为普通文本')),
  bl(bold('帮助卡片：'), run('@机器人 帮助，蓝色卡片展示所有指令，底部附「查看完整文档」跳转按钮')),
  hr(),

  // ════════════════ 文本模型测试 ════════════════
  h2('📝 文本模型测试（run-model-text-test.js）'),
  p(run('从用例库读取文本类测试用例，调用模型生成输出，写入「模型测试记录」。')),

  h3('用法'),
  code('# 查看帮助\nnode run-model-text-test.js\n\n# 指定模型（via Dify）\nnode run-model-text-test.js --model glm-4.5\nnode run-model-text-test.js --model qwen3.5-plus\n\n# 只指定能力类型（默认模型 glm-4.5）\nnode run-model-text-test.js --ability 文本生成·文案\n\n# 指定模型 + 能力类型\nnode run-model-text-test.js --model qwen3.5-plus --ability 文本生成·歌词\n\n# SiliconFlow 直连\nnode run-model-text-test.js --siliconflow --model deepseek-ai/DeepSeek-V3'),

  h3('已注册文本模型（DIFY_TEXT_MODELS）'),
  bl(mono('glm-4.5'), run('  —  智谱，默认')),
  bl(mono('qwen3.5-plus'), run('  —  阿里')),
  p(gray('新增：在 models.config.js → DIFY_TEXT_MODELS 加一行 + Dify 文本生成工作流加 IF 分支')),
  hr(),

  // ════════════════ 图像/视频模型测试 ════════════════
  h2('🎨 图像 / 视频模型测试（run-media-test.js）'),
  p(run('统一入口，所有模型通过 Dify 工作流调用，结果下载后以附件形式写入飞书。')),

  h3('用法'),
  code('# 图像生成\nnode run-media-test.js --model midjourney\nnode run-media-test.js --model midjourney --ability 图像生成·文本\n\n# 视频生成（文生视频）\nnode run-media-test.js --model doubao-seedance-1-0-lite-t2v\n\n# 视频生成（图生视频，需用例库提供输入图像附件）\nnode run-media-test.js --model doubao-seedance-1-0-lite-i2v'),

  h3('已注册媒体模型（MODEL_REGISTRY）'),
  bl(mono('midjourney'), run('  —  图像生成，写入「输出图像附件」')),
  bl(mono('doubao-seedance-1-0-lite-t2v'), run('  —  文生视频，写入「输出视频附件」')),
  bl(mono('doubao-seedance-1-0-lite-i2v'), run('  —  图生视频，需用例库提供「输入图像附件」')),
  p(gray('新增：在 models.config.js → MODEL_REGISTRY 加一行 + Dify 对应工作流加 IF 分支')),

  h3('媒体文件写入流程'),
  ol(run('Dify 工作流返回媒体文件 URL')),
  ol(run('脚本下载到内存（Buffer）')),
  ol(run('调用飞书 upload_all API 上传，获取 file_token')),
  ol(run('将 file_token 写入附件字段，永久保存，不依赖外链 CDN')),
  hr(),

  // ════════════════ 补全用例库 ════════════════
  h2('🔧 补全用例库（patch-cases.js）'),
  p(run('扫描用例库中的空字段，使用 AI 自动填充（Prompt、参考标准、难度、备注等），用例编号由脚本按规则生成。')),

  h3('用法'),
  code('# 预览（不写入）\nnode patch-cases.js\n\n# 写入飞书\nnode patch-cases.js --apply\n\n# 只处理指定能力类型\nnode patch-cases.js --apply --ability 视频生成·文本\n\n# 调试字段名\nnode patch-cases.js --debug-fields'),

  h3('用例编号规则'),
  p(run('前缀由 '), mono('models.config.js → ABILITY_PREFIXES'), run(' 统一维护，格式如：')),
  bl(mono('TC-IMG-TXT-001'), run('  —  图像生成·文本')),
  bl(mono('TC-VID-TXT-001'), run('  —  视频生成·文本')),
  bl(mono('TC-TXT-LYR-001'), run('  —  文本生成·歌词')),
  p(gray('遇到未在 ABILITY_PREFIXES 登记的能力类型，脚本警告并跳过，不生成错误编号。')),
  hr(),

  // ════════════════ AI 自动评分 ════════════════
  h2('⭐ AI 自动评分（ai-scoring.js）'),
  p(run('读取测试记录，将「输出结果文本」与用例库「参考标准 / 期望效果」对比，由 AI 给出 1–5 分评分。')),

  h3('用法'),
  code('# 默认：只评文本类（文本生成/文本理解/提示词），未评分的记录\nnode ai-scoring.js\n\n# 强制重评所有记录\nnode ai-scoring.js --all\n\n# 指定批次\nnode ai-scoring.js --batch 202503-glm-4.5\n\n# 同时评图像/视频/口型类（默认跳过）\nnode ai-scoring.js --include-media\n\n# 只处理前 N 条（测试用）\nnode ai-scoring.js --limit 5\n\n# 参数可组合\nnode ai-scoring.js --batch 202503-glm-4.5 --all'),

  h3('文本类判定'),
  p(run('通过 '), mono('models.config.js → isTextAbility()'), run(' 查表判断，凡 '), mono('ABILITY_PREFIXES'), run(' 中 '), mono('isText: true'), run(' 的能力类型均属文本类：')),
  bl(mono('文本生成·文案 / 文本生成·歌词 / 文本生成·音乐描述'), run('  ✅ 默认评分')),
  bl(mono('文本理解·翻译 / 文本理解·情感分析'), run('  ✅ 默认评分')),
  bl(mono('提示词·优化'), run('  ✅ 默认评分')),
  bl(mono('图像生成 / 视频生成 / 口型驱动'), run('  ❌ 默认跳过，加 --include-media 才评')),

  h3('评分规则'),
  bl(bold('5 分：'), run('完全符合参考标准，内容完整质量优')),
  bl(bold('4 分：'), run('基本符合，有少量瑕疵')),
  bl(bold('3 分：'), run('部分符合，有明显缺失或偏差')),
  bl(bold('2 分：'), run('质量差，与参考标准差距大')),
  bl(bold('1 分：'), run('完全不符合或无输出')),
  p(gray('写入字段：AI自动评分（综合分）、AI评分说明（含指令遵循度分 + 简短原因）')),

  h3('重试机制'),
  p(run('网络错误（socket hang up / ECONNRESET / TLS 等）自动重试 3 次，间隔 3s / 6s。')),
  hr(),

  // ════════════════ 通知 ════════════════
  h2('📢 飞书群通知（notify.js）'),
  p(run('向指定飞书群发送卡片通知（Suno 订阅、模型上线、功能更新等），支持按群配置订阅类型。')),

  h3('用法'),
  code('node notify.js --suno\nnode notify.js --models --batch 202503-glm-4.5\nnode notify.js --features --text "新增视频评分功能"\nnode notify.js --newmodels --text "Sora 已接入"'),

  h3('订阅配置（notify.js 顶部 CONFIG.groups）'),
  code(`groups: [
  { chat_id: 'oc_xxx', name: '测试群', subscribe: ['suno','models','features','newmodels'] },
  { chat_id: 'oc_yyy', name: '业务群', subscribe: ['newmodels'] },
]`, 'js'),
  hr(),

  // ════════════════ 配置管理 ════════════════
  h2('⚙️ 配置管理（models.config.js）'),
  p(bold('所有模型和能力类型统一在 models.config.js 维护，一处修改全局生效。')),

  h3('ABILITY_PREFIXES — 能力类型注册表'),
  p(run('每条包含 '), mono('prefix'), run('（用例编号前缀）和 '), mono('isText'), run('（是否文本类）两个字段：')),
  code(`'文本生成·歌词': { prefix: 'TC-TXT-LYR', isText: true  },
'视频生成·文本': { prefix: 'TC-VID-TXT', isText: false },`, 'js'),
  bl(bold('新增能力类型：'), run('在 ABILITY_PREFIXES 加一行 + 飞书表格「能力类型」字段加对应选项值')),
  bl(bold('删除能力类型：'), run('删对应行 + 飞书表格同步删除')),
  bl(bold('未登记时：'), mono('patch-cases.js'), run(' 警告跳过；'), mono('ai-scoring.js'), run(' 视为非文本类')),

  h3('新增图像 / 视频模型（两步）'),
  ol(bold('models.config.js → MODEL_REGISTRY'), run(' 加一行：')),
  code(`'new-model': {
  difyKey:     'app-xxxxxxxxxx',
  difyInputs:  (prompt, imageUrl) => ({ prompt, model: 'new-model', i_url: imageUrl || '' }),
  outputField: '输出视频附件',
  mimeType:    'video/mp4',
  ext:         'mp4',
  abilities:   ['视频生成·文本'],   // 必须已在 ABILITY_PREFIXES 登记
  timeout:     180000,
},`, 'js'),
  ol(bold('Dify 对应工作流'), run('加 IF 分支 + 独立输出节点（变量名 '), mono('result'), run('）')),

  h3('新增文本模型（两步）'),
  ol(bold('models.config.js → DIFY_TEXT_MODELS'), run(' 加一行：')),
  code(`{ model: 'new-text-model', vendor: '厂商名' },`, 'js'),
  ol(bold('Dify 文本生成工作流'), run('加 IF 分支')),

  h3('依赖关系'),
  bl(mono('ABILITY_PREFIXES + isTextAbility()'), run('  →  patch-cases.js / ai-scoring.js')),
  bl(mono('MODEL_REGISTRY → MEDIA_MODELS'), run('  →  run-media-test.js / bot-server.js（路由 + 帮助）')),
  bl(mono('DIFY_TEXT_MODELS'), run('  →  run-model-text-test.js / bot-server.js（帮助）')),
  bl(mono('TESTER_NAME'), run('  →  run-media-test.js / run-model-text-test.js（写入测试人字段）')),
  hr(),

  // ════════════════ 注意事项 ════════════════
  h2('⚠️ 常见问题与注意事项'),

  h3('字段名必须精确匹配'),
  bl(run('飞书字段名区分空格，如「Prompt / 指令」斜杠两侧各有一个空格，写错不报错但写入无效')),
  bl(run('排查方法：'), mono('node patch-cases.js --debug-fields'), run(' 打印真实字段名')),

  h3('Dify 工作流'),
  bl(run('每个 IF 分支末尾必须接独立输出节点（变量名固定为 '), mono('result'), run('），不能共用')),
  bl(run('文本模型 prompt 字段类型设为「段落」，最大长度 ≥ 5000，避免超长 Prompt 截断')),

  h3('附件字段格式'),
  bl(run('写入格式：'), mono('[{ file_token: "xxx" }]')),
  bl(run('读取时需调 '), mono('batch_get_tmp_download_url'), run(' 换取临时 URL，直接存储的 file_token 不可直接访问')),

  h3('记录 ID 与批次标签'),
  bl(run('记录 ID 格式：'), mono('REC-模型名-HHMMSS'), run('（6 位时分秒），便于识别，不使用自增')),
  bl(run('批次标签格式：'), mono('YYYYMM-模型名'), run('，如 '), mono('202503-glm-4.5'), run('，用 --batch 过滤')),

  h3('代理环境'),
  bl(mono('bot-server.js'), run(' 启动时自动清除系统代理环境变量，可在开代理情况下正常运行')),
  hr(),

  p(gray('本文档由 Claude Code 自动生成 · AI 模型测试框架使用说明 v2.1 · 2026-03-11')),
];

// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  process.stdout.write('Step 1  获取飞书授权...');
  const tr = await feishu('POST', '/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: APP_ID, app_secret: APP_SECRET });
  if (!tr.tenant_access_token) { console.error('\n❌ Token 失败', tr); process.exit(1); }
  const token = tr.tenant_access_token;
  console.log(' ✅');

  process.stdout.write('Step 2  读取文档结构...');
  const blocksRes = await feishu('GET',
    `/open-apis/docx/v1/documents/${DOC_ID}/blocks?page_size=500`, null, token);
  if (blocksRes.code !== 0) { console.error('\n❌ 读取失败', JSON.stringify(blocksRes)); process.exit(1); }
  const rootBlock  = blocksRes.data?.items?.find(b => b.block_id === DOC_ID);
  const childCount = rootBlock?.children?.length || 0;
  console.log(` ✅  当前子块数: ${childCount}`);

  if (childCount > 0) {
    process.stdout.write(`Step 3  清空已有 ${childCount} 个子块...`);
    const delRes = await feishu('DELETE',
      `/open-apis/docx/v1/documents/${DOC_ID}/blocks/${DOC_ID}/children/batch_delete`,
      { start_index: 0, end_index: childCount }, token);
    if (delRes.code !== 0) { console.error('\n❌ 清空失败', JSON.stringify(delRes)); process.exit(1); }
    console.log(' ✅');
    await sleep(500);
  } else {
    console.log('Step 3  文档为空，跳过清空');
  }

  process.stdout.write('Step 4  更新文档标题...');
  const titleRes = await feishu('PATCH',
    `/open-apis/docx/v1/documents/${DOC_ID}/blocks/${DOC_ID}`,
    { update_text_elements: { elements: [{ text_run: { content: 'AI 模型测试框架 · 使用说明' } }] } }, token);
  if (titleRes.code !== 0) {
    console.warn('\n⚠️  标题更新失败:', titleRes.msg);
  } else {
    console.log(' ✅');
  }

  console.log(`Step 5  写入 ${BLOCKS.length} 个 block（每批 20 个）`);
  const BATCH = 20;
  let written = 0;
  for (let i = 0; i < BLOCKS.length; i += BATCH) {
    const batch = BLOCKS.slice(i, i + BATCH);
    const res = await feishu('POST',
      `/open-apis/docx/v1/documents/${DOC_ID}/blocks/${DOC_ID}/children`,
      { children: batch, index: i }, token);
    if (res.code !== 0) {
      console.error(`\n❌ 写入失败（第 ${i} 块起）:`, JSON.stringify(res));
      process.exit(1);
    }
    written += batch.length;
    console.log(`  ✅  已写入 ${written} / ${BLOCKS.length}`);
    if (i + BATCH < BLOCKS.length) await sleep(300);
  }

  console.log('\n✅ 文档更新完成！');
  console.log(`   链接：https://pcn28q31n7ee.feishu.cn/docx/${DOC_ID}`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
