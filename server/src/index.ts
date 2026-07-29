import './db/schema.js';
import { initSupabase } from './services/replicate.js';
import { initServerSync, startPeriodicSync } from './services/server-sync.js';
import app from './app.js';

if (!process.env.JWT_SECRET) {
  console.error('错误：JWT_SECRET 环境变量未设置。请检查 .env 文件。');
  process.exit(1);
}

process.title = '题库服务器';

const PORT = process.env.PORT || 3001;

initSupabase();
if (initServerSync()) {
  startPeriodicSync();
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器运行在 http://0.0.0.0:${PORT}`);
});
