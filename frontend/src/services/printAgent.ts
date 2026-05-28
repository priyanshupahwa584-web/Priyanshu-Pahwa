import { PRINT_AGENT_URL } from './apiConfig';

const agentBase = PRINT_AGENT_URL;
const tokenKey = 'broadreach_print_agent_token';
const printerKey = 'broadreach_default_printer';

export type PrinterInfo = {
  Name: string;
  DriverName?: string;
  PortName?: string;
  PrinterStatus?: string | number;
};

export function getAgentToken() {
  return localStorage.getItem(tokenKey) || '';
}

export function setAgentToken(token: string) {
  localStorage.setItem(tokenKey, token.trim());
}

export function getDefaultPrinter() {
  return localStorage.getItem(printerKey) || '';
}

export function setDefaultPrinter(printerName: string) {
  localStorage.setItem(printerKey, printerName);
}

async function agentFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAgentToken();
  const response = await fetch(`${agentBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-agent-token': token,
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || 'Local print agent request failed.');
  }
  return response.json() as Promise<T>;
}

export async function checkAgent() {
  const response = await fetch(`${agentBase}/health`);
  if (!response.ok) throw new Error('Broadreach Print Agent is offline.');
  return response.json();
}

export async function getPrinters() {
  return agentFetch<{ printers: PrinterInfo[]; defaultPrinter: string }>('/printers');
}

export async function saveAgentPrinter(defaultPrinter: string) {
  setDefaultPrinter(defaultPrinter);
  return agentFetch<{ ok: boolean; defaultPrinter: string }>('/settings', {
    method: 'POST',
    body: JSON.stringify({ defaultPrinter })
  });
}

export async function sendPrintJob(job: any) {
  const printerName = job.printerName || getDefaultPrinter();
  return agentFetch<{ ok: boolean; status: string; printerName: string; trackingNumber: string }>('/print', {
    method: 'POST',
    body: JSON.stringify({ ...job, printerName })
  });
}
