import { apiUrl } from './apiConfig';

export type ApiError = Error & { status?: number; details?: unknown };

const jsonHeaders = { 'Content-Type': 'application/json' };
const requestTimeoutMs = 25000;

function clearLocalAuthState() {
  try {
    sessionStorage.removeItem('broadreach_auth_notice');
  } catch {
    // Ignore storage access restrictions in private/mobile browser modes.
  }
}

function notifyUnauthorized(path: string) {
  if (typeof window === 'undefined') return;
  if (path.includes('/auth/login')) return;
  clearLocalAuthState();
  window.dispatchEvent(new CustomEvent('broadreach:unauthorized', {
    detail: { message: 'Session expired. Please sign in again.' }
  }));
}

function timeoutError() {
  const error = new Error('Starting secure server...') as ApiError;
  error.status = 408;
  return error;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(apiUrl(path), {
      ...options,
      credentials: 'include',
      headers: options.body instanceof FormData ? options.headers : { ...jsonHeaders, ...(options.headers || {}) },
      signal: options.signal || controller.signal
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) notifyUnauthorized(path);
      const message = response.status >= 500 ? 'Server unavailable, please try again later.' : payload.message || 'Request failed.';
      const error = new Error(message) as ApiError;
      error.status = response.status;
      error.details = payload.details || payload.errors;
      throw error;
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  } catch (error: any) {
    if (error.status) throw error;
    if (error.name === 'AbortError') throw timeoutError();
    throw new Error('Server unavailable, please try again later.');
  } finally {
    window.clearTimeout(timeout);
  }
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function putJson<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

export async function downloadExport(format: 'csv' | 'xlsx' | 'pdf', filters: Record<string, string>) {
  const response = await fetch(apiUrl('/exports'), {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ format, filters })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(response.status >= 500 ? 'Server unavailable, please try again later.' : payload.message || 'Export failed.');
  }
  const blob = await response.blob();
  const fileName = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || `broadreach-export.${format}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadFromApi(path: string, fallbackFileName: string) {
  const response = await fetch(apiUrl(path), { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(response.status >= 500 ? 'Server unavailable, please try again later.' : payload.message || 'Download failed.');
  }
  const blob = await response.blob();
  const fileName = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || fallbackFileName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
