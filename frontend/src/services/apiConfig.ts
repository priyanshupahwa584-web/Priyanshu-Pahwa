const productionApiUrl = 'https://priyanshu-pahwa.onrender.com';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export const API_BASE_URL = trimTrailingSlash(import.meta.env.VITE_API_URL || productionApiUrl);

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/api')
    ? path
    : `/api${path.startsWith('/') ? path : `/${path}`}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export const PRINT_AGENT_URL = trimTrailingSlash(import.meta.env.VITE_PRINT_AGENT_URL || 'http://127.0.0.1:5055');
