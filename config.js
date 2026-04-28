// 统一凭证管理：从 .env 文件读取敏感配置
// 复制 .env.example 为 .env 并填入真实密钥

const fs = require('fs');
const path = require('path');

// 简单 .env 解析（不依赖 dotenv）
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.trim().split('=');
    if (key && !key.startsWith('#') && rest.length) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  });
}

module.exports = {
  FEISHU_APP_ID:     process.env.FEISHU_APP_ID     || '',
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET  || '',
  SILICONFLOW_KEY:   process.env.SILICONFLOW_KEY    || '',
  PRICING_API_URL:   (process.env.PRICING_API_URL   || 'http://localhost:3000').replace(/\/$/, ''),
  PRICING_API_KEY:   process.env.PRICING_API_KEY    || '',

  // Dify 工作流凭据（不要硬编码）
  DIFY_HOST:         process.env.DIFY_HOST         || '43.160.192.41',
  DIFY_PORT:         parseInt(process.env.DIFY_PORT || '9090', 10),
  DIFY_UNIFIED_KEY:  process.env.DIFY_UNIFIED_KEY  || '',  // 开发团队维护的统一工作流（推荐）
  DIFY_IMAGE_KEY:    process.env.DIFY_IMAGE_KEY    || '',  // legacy: dev_huang_图像生成
  DIFY_VIDEO_KEY:    process.env.DIFY_VIDEO_KEY    || '',  // legacy: dev_huang_视频生成
  DIFY_TEXT_KEY:     process.env.DIFY_TEXT_KEY     || '',  // legacy: dev_huang_文本生成
};
