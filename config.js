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
};
