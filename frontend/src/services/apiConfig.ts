const productionApiUrl = 'https://priyanshu-pahwa.onrender.com';
const rawApiUrl = import.meta.env.VITE_API_URL || '';

console.log('API URL:', import.meta.env.VITE_API_URL);

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function isLocalApiUrl(value: string) {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function isLocalBrowser() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(window.location.hostname);
}

function resolveApiBaseUrl() {
  const configuredUrl = trimTrailingSlash(rawApiUrl);
  if (!configuredUrl) return productionApiUrl;
  if (isLocalApiUrl(configuredUrl) && !isLocalBrowser()) return productionApiUrl;
  return configuredUrl;
}

export const API_BASE_URL = resolveApiBaseUrl();

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/api')
    ? path
    : `/api${path.startsWith('/') ? path : `/${path}`}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export const PRINT_AGENT_URL = trimTrailingSlash(import.meta.env.VITE_PRINT_AGENT_URL || 'http://127.0.0.1:5055');
