const path = require('path');
module.exports = {
  apps: [{
    name: 'question-bank-server',
    script: path.join(__dirname, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    args: 'src/index.ts',
    cwd: __dirname,
    env: {
      PORT: 3001,
      DB_PATH: './data.db',
      PRIMARY_SERVER_URL: '',
      SYNC_PHONE: '',
      SYNC_PASSWORD: '',
      SERVER_SYNC_INTERVAL: '300000'
    },
    autorestart: true,
    max_restarts: 10,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './server-error.log',
    out_file: './server.log',
  }]
};
