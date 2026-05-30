import { PRINT_AGENT_URL } from './apiConfig';

const agentBase = PRINT_AGENT_URL;
const tokenKey = 'broadreach_print_agent_token';
const printerKey = 'broadreach_default_printer';
const labelSizeKey = 'broadreach_label_size';
const printModeKey = 'broadreach_print_mode';
const agentTimeoutMs = 1200;

export type LabelSize = '4x2' | '4x6';
export type PrintMode = 'Browser Preview' | 'Local Print Agent';

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

export function getLabelSize(): LabelSize {
  const value = localStorage.getItem(labelSizeKey);
  return value === '4x6' ? '4x6' : '4x2';
}

export function setLabelSize(labelSize: LabelSize) {
  localStorage.setItem(labelSizeKey, labelSize);
}

export function getPrintMode(): PrintMode {
  const value = localStorage.getItem(printModeKey);
  return value === 'Browser Preview' ? 'Browser Preview' : 'Local Print Agent';
}

export function setPrintMode(printMode: PrintMode) {
  localStorage.setItem(printModeKey, printMode);
}

function timeoutSignal(timeoutMs = agentTimeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timer };
}

async function agentFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAgentToken();
  const { controller, timer } = timeoutSignal(5000);
  const response = await fetch(`${agentBase}${path}`, {
    ...options,
    signal: options.signal || controller.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-agent-token': token,
      ...(options.headers || {})
    }
  }).finally(() => window.clearTimeout(timer));
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || 'Print service request failed.');
  }
  return response.json() as Promise<T>;
}

export type AgentStatus = {
  status: 'Online' | 'Offline' | 'Not Installed';
  message: string;
  url: string;
  health?: any;
};

export async function checkAgentStatus(): Promise<AgentStatus> {
  const { controller, timer } = timeoutSignal();
  try {
    const response = await fetch(`${agentBase}/health`, { signal: controller.signal });
    if (!response.ok) {
      return { status: 'Offline', message: 'Install and run BROPS Print Agent on this PC.', url: agentBase };
    }
    const health = await response.json().catch(() => ({}));
    return { status: 'Online', message: 'BROPS Print Agent is online.', url: agentBase, health };
  } catch (error: any) {
    const offline = error?.name === 'AbortError';
    return {
      status: offline ? 'Offline' : 'Not Installed',
      message: 'Install and run BROPS Print Agent on this PC.',
      url: agentBase
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function checkAgent() {
  const status = await checkAgentStatus();
  if (status.status !== 'Online') throw new Error(status.message);
  return status.health;
}

export async function getPrinters() {
  return agentFetch<{ printers: PrinterInfo[]; defaultPrinter: string }>('/printers');
}

export async function saveAgentPrinter(defaultPrinter: string) {
  return saveAgentSettings({ defaultPrinter });
}

export async function saveAgentSettings(settings: { defaultPrinter: string; labelSize?: LabelSize; printMode?: PrintMode }) {
  setDefaultPrinter(settings.defaultPrinter);
  if (settings.labelSize) setLabelSize(settings.labelSize);
  if (settings.printMode) setPrintMode(settings.printMode);
  return agentFetch<{ ok: boolean; defaultPrinter: string }>('/settings', {
    method: 'POST',
    body: JSON.stringify(settings)
  });
}

export async function sendPrintJob(job: any) {
  const printerName = job.printerName || getDefaultPrinter();
  return agentFetch<{ ok: boolean; status: string; printerName: string; trackingNumber: string }>('/print', {
    method: 'POST',
    body: JSON.stringify({ ...job, printerName })
  });
}
