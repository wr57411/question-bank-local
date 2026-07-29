import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.TEST_SERVER_URL || 'http://localhost:3001';
  const isDev = mode === 'development';

  return {
    root: 'src',
    publicDir: resolve(__dirname, 'public'),
    build: {
      outDir: resolve(__dirname, 'dist'),
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    define: {
      __TEST_PHONE__: JSON.stringify(isDev ? (env.TEST_PHONE || '') : ''),
      __TEST_PASSWORD__: JSON.stringify(isDev ? (env.TEST_PASSWORD || '') : ''),
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/uploads': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/pdf-previews': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 3000,
    },
  };
});
