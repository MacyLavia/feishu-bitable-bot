/**
 * 删除机器人创建的飞书文档 / 多维表格
 *
 * 用法：node delete-docs.js <链接1> <链接2> ...
 *
 * 支持格式：
 *   文档：  https://xxx.feishu.cn/docx/AbCdEfGh
 *   多维表格：https://xxx.feishu.cn/base/AbCdEfGh
 *   或直接写 token：AbCdEfGh（需加 --type docx 或 --type bitable）
 */

const https = require('https');

const APP_ID     = 'cli_a9143292ee391cc9';
const APP_SECRET = '4AHv3R5tmEXZ06NmRRnW2f2qrAWu1k0J';

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

async function getToken() {
  const r = await req('POST', '/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: APP_ID, app_secret: APP_SECRET });
  if (!r.tenant_access_token) throw new Error('Token 获取失败');
  return r.tenant_access_token;
}

function parseTarget(arg) {
  // 多维表格：/base/TOKEN
  const baseMatch = arg.match(/\/base\/([A-Za-z0-9_-]+)/);
  if (baseMatch) return { id: baseMatch[1], type: 'bitable' };

  // 文档：/docx/TOKEN
  const docxMatch = arg.match(/\/docx\/([A-Za-z0-9_-]+)/);
  if (docxMatch) return { id: docxMatch[1], type: 'docx' };

  // Wiki 知识库页面：/wiki/TOKEN
  const wikiMatch = arg.match(/\/wiki\/([A-Za-z0-9_-]+)/);
  if (wikiMatch) return { id: wikiMatch[1], type: 'wiki' };

  // 裸 token，默认 docx
  return { id: arg.replace(/[?#].*/, '').trim(), type: 'docx' };
}

async function main() {
  const args = process.argv.slice(2).filter(a => a && !a.startsWith('--'));
  if (args.length === 0) {
    console.log('用法：node delete-docs.js <飞书链接1> [<链接2> ...]');
    console.log('');
    console.log('例：');
    console.log('  node delete-docs.js https://xxx.feishu.cn/docx/AbCdEfGh');
    console.log('  node delete-docs.js https://xxx.feishu.cn/base/XyZwToken');
    console.log('  node delete-docs.js https://xxx.feishu.cn/docx/Aaa https://xxx.feishu.cn/base/Bbb');
    process.exit(0);
  }

  const token = await getToken();
  console.log('✅ Token OK\n');

  for (const arg of args) {
    const { id, type } = parseTarget(arg);
    console.log(`🗑  删除 [${type}] ${id} ...`);
    const res = await req('DELETE', `/open-apis/drive/v1/files/${id}?type=${type}`, null, token);
    if (res.code === 0) {
      console.log(`✅ 已删除\n`);
    } else {
      console.warn(`❌ 失败：code=${res.code} ${res.msg || ''}\n`);
    }
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
