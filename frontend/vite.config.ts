import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));
const productionApiUrl = 'https://priyanshu-pahwa.onrender.com';

function isLocalApiUrl(value?: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, frontendRoot, 'VITE_');
  const configuredApiUrl = process.env.VITE_API_URL || env.VITE_API_URL || '';
  const safeApiUrl = mode === 'production' && isLocalApiUrl(configuredApiUrl)
    ? productionApiUrl
    : configuredApiUrl || productionApiUrl;

  return {
    root: frontendRoot,
    base: '/',
    envDir: frontendRoot,
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(safeApiUrl)
    },
    plugins: [react()],
    server: {
      port: 5173
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true
    }
  };
});
