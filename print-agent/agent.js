import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import express from 'express';
import cors from 'cors';

const port = Number(process.env.BROADREACH_PRINT_AGENT_PORT || 5055);
const host = '127.0.0.1';
const configDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'BroadreachPrintAgent');
const configPath = path.join(configDir, 'agent-config.json');
const tempDir = path.join(configDir, 'jobs');

fs.mkdirSync(tempDir, { recursive: true });

function readConfig() {
  fs.mkdirSync(configDir, { recursive: true });
  if (!fs.existsSync(configPath)) {
    const created = {
      token: process.env.BROADREACH_PRINT_AGENT_TOKEN || crypto.randomBytes(24).toString('hex'),
      defaultPrinter: '',
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(configPath, JSON.stringify(created, null, 2));
    return created;
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function saveConfig(next) {
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
}

let agentConfig = readConfig();

function runPowerShell(args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { windowsHide: true, timeout }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function requireToken(req, res, next) {
  const token = req.get('x-agent-token') || req.query.token || '';
  if (token && token === agentConfig.token) return next();
  return res.status(401).json({ message: 'Local print agent token is missing or invalid.' });
}

function validatePrintPayload(body) {
  const type = String(body.type || 'zpl').toLowerCase();
  if (!['zpl', 'pdf'].includes(type)) throw new Error('Print type must be zpl or pdf.');
  const printerName = String(body.printerName || agentConfig.defaultPrinter || '').trim();
  if (!printerName) throw new Error('Select a Windows printer before printing.');
  const trackingNumber = String(body.trackingNumber || body.barcodeValue || 'TEST-0001').trim();
  if (!trackingNumber) throw new Error('Tracking number is required.');
  return { ...body, type, printerName, trackingNumber };
}

async function listPrinters() {
  const script = 'Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus | ConvertTo-Json -Depth 3';
  const stdout = await runPowerShell(['-Command', script]);
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function rawPrintScript(filePath, printerName) {
  return `
$signature = @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
  public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "Broadreach 4x2 Label";
    di.pDataType = "RAW";
    if (!OpenPrinter(printerName.Normalize(), out hPrinter, IntPtr.Zero)) return false;
    if (!StartDocPrinter(hPrinter, 1, di)) { ClosePrinter(hPrinter); return false; }
    if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); ClosePrinter(hPrinter); return false; }
    IntPtr unmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);
    int written;
    bool success = WritePrinter(hPrinter, unmanagedBytes, bytes.Length, out written);
    Marshal.FreeCoTaskMem(unmanagedBytes);
    EndPagePrinter(hPrinter);
    EndDocPrinter(hPrinter);
    ClosePrinter(hPrinter);
    return success && written == bytes.Length;
  }
}
"@
Add-Type -TypeDefinition $signature
$bytes = [System.IO.File]::ReadAllBytes('${filePath.replace(/'/g, "''")}')
$ok = [RawPrinterHelper]::SendBytesToPrinter('${printerName.replace(/'/g, "''")}', $bytes)
if (-not $ok) { throw "Windows spooler rejected the raw print job." }
`;
}

async function printZpl(job) {
  const filePath = path.join(tempDir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.zpl`);
  fs.writeFileSync(filePath, String(job.zpl || ''), 'utf8');
  try {
    await runPowerShell(['-Command', rawPrintScript(filePath, job.printerName)], 30000);
  } finally {
    fs.rm(filePath, { force: true }, () => {});
  }
}

async function printPdf(job) {
  if (!job.pdfBase64) throw new Error('PDF label payload was missing.');
  const filePath = path.join(tempDir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pdf`);
  fs.writeFileSync(filePath, Buffer.from(job.pdfBase64, 'base64'));
  const printer = String(job.printerName).replace(/'/g, "''");
  const file = filePath.replace(/'/g, "''");
  const script = `Start-Process -FilePath '${file}' -Verb PrintTo -ArgumentList '"${printer}"' -WindowStyle Hidden -Wait`;
  try {
    await runPowerShell(['-Command', script], 30000);
  } finally {
    fs.rm(filePath, { force: true }, () => {});
  }
}

const app = express();
app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by the local print agent.'));
  }
}));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'Broadreach Print Agent', version: '1.0.0', defaultPrinter: agentConfig.defaultPrinter || '', tokenConfigured: Boolean(agentConfig.token) });
});

app.get('/settings', requireToken, (_req, res) => {
  res.json({ defaultPrinter: agentConfig.defaultPrinter || '', tokenPath: configPath });
});

app.post('/settings', requireToken, (req, res) => {
  agentConfig = { ...agentConfig, defaultPrinter: String(req.body?.defaultPrinter || '').trim(), updatedAt: new Date().toISOString() };
  saveConfig(agentConfig);
  res.json({ ok: true, defaultPrinter: agentConfig.defaultPrinter });
});

app.get('/printers', requireToken, async (_req, res) => {
  try {
    res.json({ printers: await listPrinters(), defaultPrinter: agentConfig.defaultPrinter || '' });
  } catch (error) {
    res.status(500).json({ message: 'Could not read Windows printers.', details: error.stderr || error.message });
  }
});

app.post('/print', requireToken, async (req, res) => {
  try {
    const job = validatePrintPayload(req.body || {});
    if (job.type === 'pdf') await printPdf(job);
    else await printZpl(job);
    res.json({ ok: true, status: 'Printed', printerName: job.printerName, trackingNumber: job.trackingNumber, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Print failed.' });
  }
});

app.listen(port, host, () => {
  console.log(`Broadreach Print Agent listening at http://${host}:${port}`);
  console.log(`Token/config file: ${configPath}`);
});
