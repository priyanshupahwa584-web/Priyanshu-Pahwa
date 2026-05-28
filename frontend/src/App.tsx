import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, downloadExport, downloadFromApi, postJson, putJson } from './services/api';
import { checkAgent, getAgentToken, getDefaultPrinter, getPrinters, saveAgentPrinter, sendPrintJob, setAgentToken } from './services/printAgent';
import type { FulfilmentReport, MetroLabelRow, Notice, NoticeType, OperationRow, SectionKey, User } from './types';

const idleTimeoutMs = 30 * 60 * 1000;
const appVersion = 'v1.0.0';

type IconName = 'grid' | 'data' | 'label' | 'report' | 'import' | 'export' | 'users' | 'activity' | 'printer' | 'settings';
type NavItem = { key: SectionKey; label: string; path: string; icon: IconName; sidebar?: boolean };

const navItems: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: 'grid' },
  { key: 'data', label: 'Operations Data', path: '/data', icon: 'data' },
  { key: 'metro-labeling', label: 'Metro Labeling', path: '/metro-labeling', icon: 'label' },
  { key: 'fulfilment', label: 'Fulfilment Reports', path: '/fulfilment-reports', icon: 'report' },
  { key: 'exports', label: 'Files & Reports', path: '/exports', icon: 'report' },
  { key: 'imports', label: 'Files & Reports', path: '/imports', icon: 'report', sidebar: false },
  { key: 'users', label: 'Users', path: '/users', icon: 'users' },
  { key: 'activity', label: 'Activity Logs', path: '/activity', icon: 'activity' },
  { key: 'printer-setup', label: 'Printer Setup', path: '/printer-setup', icon: 'printer' },
  { key: 'settings', label: 'Settings', path: '/settings', icon: 'settings' }
];

const pageSubtitles: Partial<Record<SectionKey, string>> = {
  dashboard: 'Live overview of operations, labeling, reports, and activity.',
  data: 'View and manage daily operations records.',
  'metro-labeling': 'Upload, search, preview, and print Metro labels.',
  fulfilment: 'Generate and export completion reports.',
  imports: 'Upload and review operational files.',
  exports: 'Create and download report files.',
  users: 'Manage team access and roles.',
  activity: 'Review system activity and print history.',
  'printer-setup': 'Choose and test the label printer for this workstation.',
  settings: 'Manage platform preferences and system setup.'
};

const sectionLabels: Partial<Record<SectionKey, string>> = {
  dashboard: 'Dashboard',
  data: 'Operations Data',
  'metro-labeling': 'Metro Labeling',
  fulfilment: 'Fulfilment Reports',
  imports: 'File Imports',
  exports: 'File Exports',
  users: 'Users',
  activity: 'Activity Logs',
  'printer-setup': 'Printer Setup',
  settings: 'Settings'
};

function canAccess(user: User, section: SectionKey) {
  return user.role === 'Admin' || user.permissions.includes(section);
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api<{ user: User }>('/auth/me')
      .then((response) => active && setUser(response.user))
      .catch(() => null)
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const showNotice = (type: NoticeType, text: string) => {
    setNotice({ type, text });
    window.setTimeout(() => setNotice((current) => (current?.text === text ? null : current)), 4000);
  };

  if (loading) return <Splash />;
  if (!user) return <LoginScreen onLogin={setUser} notice={notice} showNotice={showNotice} />;

  return (
    <Shell user={user} setUser={setUser} notice={notice} showNotice={showNotice}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Guard user={user} section="dashboard"><DashboardPage showNotice={showNotice} /></Guard>} />
        <Route path="/data" element={<Guard user={user} section="data"><DataPage showNotice={showNotice} /></Guard>} />
        <Route path="/metro-labeling" element={<Guard user={user} section="metro-labeling"><MetroLabelingPage showNotice={showNotice} /></Guard>} />
        <Route path="/fulfilment-reports" element={<Guard user={user} section="fulfilment"><FulfilmentReportsPage showNotice={showNotice} /></Guard>} />
        <Route path="/imports" element={<Guard user={user} section="imports"><ImportsPage showNotice={showNotice} /></Guard>} />
        <Route path="/exports" element={<Guard user={user} section="exports"><ExportsPage showNotice={showNotice} /></Guard>} />
        <Route path="/users" element={<Guard user={user} section="users"><UsersPage showNotice={showNotice} /></Guard>} />
        <Route path="/activity" element={<Guard user={user} section="activity"><ActivityPage /></Guard>} />
        <Route path="/printer-setup" element={<Guard user={user} section="printer-setup"><PrinterSetupPage showNotice={showNotice} /></Guard>} />
        <Route path="/settings" element={<Guard user={user} section="settings"><SettingsPage user={user} showNotice={showNotice} /></Guard>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Shell>
  );
}

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-broad-navy text-white">
      <div className="text-center">
        <img src="/icons/app-logo.png" className="mx-auto mb-6 w-72" alt="Broad Reach" />
        <div className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-100">Loading secure workspace</div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin, notice, showNotice }: { onLogin: (user: User) => void; notice: Notice; showNotice: (type: NoticeType, text: string) => void }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [rememberDevice, setRememberDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const secureRememberAvailable = window.location.protocol === 'https:';

  const submit = async () => {
    if (busy) return;
    if (!form.username.trim() || !form.password) {
      showNotice('error', 'Enter your username and password.');
      return;
    }
    setBusy(true);
    try {
      const response = await postJson<{ user: User }>('/auth/login', {
        ...form,
        rememberDevice: secureRememberAvailable && rememberDevice
      });
      onLogin(response.user);
    } catch (error: any) {
      showNotice('error', error.status === 401 ? 'Invalid username or password.' : error.message);
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    if (!form.username.trim()) {
      showNotice('error', 'Enter your username first.');
      return;
    }
    setResetBusy(true);
    try {
      const response = await postJson<{ message: string }>('/auth/forgot-password', { username: form.username });
      showNotice('info', response.message);
    } catch (error: any) {
      showNotice('error', error.message);
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <AuthFrame notice={notice}>
      <FormGrid cols="grid-cols-1">
        <TextInput label="Username" value={form.username} onChange={(username) => setForm({ ...form, username })} onEnter={submit} />
        <TextInput label="Password" type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} onEnter={submit} />
      </FormGrid>
      {secureRememberAvailable && (
        <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-600">
          <input checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} type="checkbox" />
          Remember this device
        </label>
      )}
      <button className="button button-primary mt-6 w-full py-3" disabled={busy || !form.username.trim() || !form.password} onClick={submit}>
        {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
        {busy ? 'Authenticating...' : 'Sign In'}
      </button>
      <button className="mt-4 w-full text-center text-sm font-bold text-broad-teal transition hover:text-broad-cyan" disabled={resetBusy} onClick={forgotPassword}>
        {resetBusy ? 'Preparing reset request...' : 'Forgot password? Start secure reset'}
      </button>
      <p className="mt-5 text-center text-xs font-semibold text-slate-500">Need access? Contact admin</p>
    </AuthFrame>
  );
}

function AuthFrame({ notice, children }: { notice: Notice; children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-broad-navy p-4 sm:p-6">
      <div className="absolute inset-0 bg-cover bg-center opacity-75" style={{ backgroundImage: "url('/icons/brand-hero.png')" }} />
      <div className="auth-pattern absolute inset-0" />
      <div className="auth-orb absolute left-[12%] top-[22%] h-72 w-72 rounded-full bg-broad-cyan/20 blur-3xl" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_42%,rgba(20,184,184,0.18),transparent_34%),linear-gradient(90deg,rgba(4,12,20,0.94),rgba(4,12,20,0.56),rgba(4,12,20,0.94))]" />
      <div className="relative mx-auto grid min-h-[calc(100vh-48px)] max-w-6xl place-items-center">
        <div className="grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-3xl border border-white/15 bg-white/95 shadow-[0_32px_120px_rgba(0,0,0,0.42)] backdrop-blur-xl lg:grid-cols-[1fr_0.95fr]">
          <div className="relative overflow-hidden bg-slate-950 p-8 text-white sm:p-10 lg:p-12">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_35%,rgba(20,184,184,0.3),transparent_34%)]" />
            <div className="relative">
              <img src="/icons/app-logo.png" alt="Broad Reach" className="mb-10 w-64 max-w-full drop-shadow-[0_0_22px_rgba(20,184,184,0.34)] sm:w-72" />
              <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-200">Secure Operations Access</p>
              <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Broadreach Operations Platform</h1>
              <p className="mt-4 max-w-md text-base leading-7 text-slate-200 sm:text-lg sm:leading-8">Sign in to access operations dashboards, Metro labeling, reports, and team tools.</p>
              <div className="mt-8 grid gap-3 text-sm text-slate-200">
                <p className="rounded-xl border border-white/10 bg-white/5 p-4">Username and password only. No default password is shipped.</p>
                <p className="rounded-xl border border-white/10 bg-white/5 p-4">Secure access keeps the operations workspace protected.</p>
              </div>
            </div>
          </div>
          <div className="grid content-center p-6 sm:p-10">
            {notice && <NoticeBanner notice={notice} />}
            {children}
          </div>
        </div>
        <footer className="auth-footer mt-5 flex w-full max-w-5xl flex-col items-center justify-between gap-2 text-xs font-semibold text-slate-300 sm:flex-row">
          <span>© Broadreach Operations Platform | Internal Use Only</span>
          <span>&copy; Broadreach Operations Platform | Internal Use Only</span>
          <span>{appVersion}</span>
        </footer>
      </div>
    </div>
  );
}

function Shell({ user, setUser, notice, showNotice, children }: { user: User; setUser: (user: User | null) => void; notice: Notice; showNotice: (type: NoticeType, text: string) => void; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = navItems.find((item) => location.pathname.startsWith(item.path)) || navItems[0];
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const visibleItems = navItems
    .filter((item) => item.sidebar !== false)
    .filter((item) => item.key === 'exports' ? canAccess(user, 'exports') || canAccess(user, 'imports') : canAccess(user, item.key))
    .map((item) => item.key === 'exports' && !canAccess(user, 'exports') ? { ...item, path: '/imports' } : item);
  const subtitle = pageSubtitles[current.key] || 'Work safely and keep operations moving.';
  const showSidebarLabels = !sidebarCollapsed || mobileSidebarOpen;

  const logout = async (message?: string) => {
    await postJson('/auth/logout', {}).catch(() => null);
    setUser(null);
    navigate('/');
    if (message) showNotice('info', message);
  };

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    let timer = window.setTimeout(() => logout('Session timed out after inactivity. Please sign in again.'), idleTimeoutMs);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => logout('Session timed out after inactivity. Please sign in again.'), idleTimeoutMs);
    };
    events.forEach((eventName) => window.addEventListener(eventName, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((eventName) => window.removeEventListener(eventName, reset));
    };
  }, [user.id]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className={`app-shell min-h-screen bg-broad-soft ${sidebarCollapsed ? 'app-shell-collapsed' : ''}`}>
      {mobileSidebarOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-slate-950/45 lg:hidden" onClick={() => setMobileSidebarOpen(false)} />}
      <aside className={`sidebar fixed inset-y-0 left-0 z-40 flex w-[292px] -translate-x-full flex-col bg-broad-navy px-5 py-5 text-white shadow-2xl transition duration-200 lg:sticky lg:top-0 lg:min-h-screen lg:translate-x-0 lg:shadow-none ${mobileSidebarOpen ? 'translate-x-0' : ''} ${sidebarCollapsed ? 'lg:w-[88px] lg:px-4' : ''}`}>
        <div className={`mb-6 flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
          <img src={showSidebarLabels ? '/icons/app-logo.png' : '/icons/app-icon.png'} alt="Broad Reach" className={showSidebarLabels ? 'w-56 max-w-[190px]' : 'h-11 w-11 rounded-xl object-contain'} />
          <button aria-label="Close navigation" className="sidebar-icon-button lg:hidden" onClick={() => setMobileSidebarOpen(false)}>
            <CloseIcon />
          </button>
        </div>
        <nav className="grid gap-1">
          {visibleItems.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              title={!showSidebarLabels ? item.label : undefined}
              className={({ isActive }) => {
                const filesActive = item.key === 'exports' && (location.pathname.startsWith('/exports') || location.pathname.startsWith('/imports'));
                return `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${!showSidebarLabels ? 'justify-center px-2' : ''} ${isActive || filesActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-950/30' : 'text-slate-200 hover:bg-white/10'}`;
              }}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10"><NavIcon name={item.icon} /></span>
              {showSidebarLabels && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>
        <button aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} className={`sidebar-collapse-button mt-auto hidden lg:flex ${sidebarCollapsed ? 'justify-center px-2' : ''}`} onClick={() => setSidebarCollapsed((value) => !value)}>
          <ChevronIcon collapsed={sidebarCollapsed} />
          {!sidebarCollapsed && <span>{sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>}
        </button>
      </aside>
      <main className="min-w-0">
        <header className="sticky top-0 z-20 flex flex-col gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:flex-row md:items-center md:justify-between lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button aria-label="Open navigation" className="sidebar-icon-button border-slate-200 bg-white text-slate-800 lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
              <MenuIcon />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-slate-950 sm:text-2xl">{current.label}</h1>
              <p className="truncate text-sm text-slate-500">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 md:justify-end">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-broad-navy font-bold text-white">{user.displayName?.[0] || user.username[0]}</div>
            <div className="min-w-0">
              <div className="text-sm font-bold">{user.displayName}</div>
              <div className="text-xs text-slate-500">{user.role}</div>
            </div>
            <button className="button" onClick={() => logout()}>Logout</button>
          </div>
        </header>
        {notice && <div className="fixed right-6 top-24 z-50 w-96 max-w-[calc(100vw-48px)]"><NoticeBanner notice={notice} /></div>}
        <div className="p-5 lg:p-7">{children}</div>
      </main>
    </div>
  );
}

function Guard({ user, section, children }: { user: User; section: SectionKey; children: ReactNode }) {
  return canAccess(user, section) ? <>{children}</> : <Navigate to="/dashboard" replace />;
}

function DashboardPage({ showNotice }: { showNotice: (type: NoticeType, text: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState('Day');
  const load = async () => {
    setBusy(true);
    try {
      setData(await api('/dashboard'));
    } catch (error: any) {
      showNotice('error', error.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); }, []);
  return (
    <PageStack>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusPill text={`${number(data?.rowCount)} records`} />
        <button className="button button-primary" onClick={load} disabled={busy}>{busy ? 'Refreshing...' : 'Refresh Data'}</button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Total Pieces" value={number(data?.kpis?.totalPieces)} icon="data" tone="teal" />
        <Kpi label="Throughput" value={number(data?.kpis?.throughput)} icon="activity" helper="Average pace" />
        <Kpi label="Metro Printed" value={number(data?.kpis?.printed)} icon="label" helper="Labels completed" />
        <Kpi label="Pending Labels" value={number(data?.kpis?.pending)} icon="report" tone="amber" />
        <Kpi label="Label Errors" value={number(data?.kpis?.errors)} icon="activity" tone="red" />
      </div>
      <div className="card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-black uppercase tracking-[0.08em] text-slate-950">Output Trend</h2>
            <p className="text-sm text-slate-500">Actual, previous, and moving average.</p>
          </div>
          <Segmented value={range} options={['Day', 'Week', 'Month', 'Year']} onChange={setRange} />
        </div>
        <div className="mt-5 h-[390px]">
          {data?.trend?.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trend} margin={{ top: 18, right: 28, bottom: 12, left: 0 }}>
                <CartesianGrid stroke="#dce4ef" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#334155', fontSize: 13, fontWeight: 700 }} />
                <YAxis tick={{ fill: '#334155', fontSize: 13, fontWeight: 700 }} />
                <Tooltip />
                <Legend />
                <Line name="Actual" type="monotone" dataKey="pieces" stroke="#0f62fe" strokeWidth={2.4} dot={{ r: 4 }} />
                <Line name="Previous" type="monotone" dataKey="pieces" stroke="#64748b" strokeDasharray="6 6" strokeWidth={1.8} dot={false} />
                <Line name="Moving Average" type="monotone" dataKey="pieces" stroke="#00a36c" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyState text="No records yet." />}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <MiniStatus label="Metro Labels Uploaded" value={number(data?.kpis?.uploaded)} />
        <MiniStatus label="Last Printed Label" value={data?.recentLabelActivity?.lastPrintedLabel?.trackingNumber || 'No prints yet'} />
        <MiniStatus label="Fulfilment Completion" value={data?.kpis?.fulfilmentCompletion || 'No labels'} />
      </div>
    </PageStack>
  );
}

function MetroLabelingPage({ showNotice }: { showNotice: (type: NoticeType, text: string) => void }) {
  const [rows, setRows] = useState<MetroLabelRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<MetroLabelRow | null>(null);
  const [busy, setBusy] = useState(false);
  const printerName = getDefaultPrinter();
  const query = useMemo(() => new URLSearchParams(Object.entries({ search, status }).filter(([, value]) => value)).toString(), [search, status]);

  const load = async () => {
    const response = await api<{ rows: MetroLabelRow[] }>(`/labels?${query}`);
    setRows(response.rows);
    setPreview((current) => current || response.rows[0] || null);
  };

  useEffect(() => { load().catch((error) => showNotice('error', error.message)); }, []);

  const upload = async () => {
    if (!file) return showNotice('error', 'Choose a Metro label CSV, XLSX, XLSM, or JSON file first.');
    const form = new FormData();
    form.append('file', file);
    setBusy(true);
    try {
      const response = await api<{ importedRows: number }>('/labels/upload', { method: 'POST', body: form });
      showNotice('success', `${response.importedRows} Metro label rows imported.`);
      setSelected([]);
      await load();
    } catch (error: any) {
      showNotice('error', error.message);
    } finally {
      setBusy(false);
    }
  };

  const printRow = async (row: MetroLabelRow, action: 'print' | 'reprint' = 'print') => {
    if (!printerName) {
      showNotice('error', 'Select a default printer in Printer Setup first.');
      return;
    }
    setBusy(true);
    try {
      await checkAgent();
      const prepared = await postJson<any>('/labels/print', { id: row.id, printerName, type: 'zpl', action, prepareOnly: true });
      await sendPrintJob(prepared.localAgentJob);
      await postJson('/labels/print/confirm', { id: row.id, printerName, type: 'zpl', action });
      showNotice('success', `${row.trackingNumber} sent to ${printerName}.`);
      await load();
    } catch (error: any) {
      await postJson('/labels/print/confirm', { id: row.id, printerName, type: 'zpl', action, errorMessage: error.message }).catch(() => null);
      showNotice('error', error.message);
      await load().catch(() => null);
    } finally {
      setBusy(false);
    }
  };

  const bulkPrint = async () => {
    const queue = rows.filter((row) => selected.includes(row.id));
    if (!queue.length) return showNotice('error', 'Select at least one label to print.');
    for (const row of queue) {
      await printRow(row, row.status === 'Printed' || row.status === 'Reprinted' ? 'reprint' : 'print');
    }
    setSelected([]);
  };

  return (
    <PageStack>
      <PageHeader
        title="Metro Labeling"
        subtitle="Upload, search, preview, and print Metro labels."
        action={<button className="button" onClick={() => load().catch((error) => showNotice('error', error.message))}>Refresh</button>}
      />
      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="card p-5">
          <h3 className="mb-4 font-black text-slate-950">Label File Import</h3>
          <div className="flex flex-col gap-3 md:flex-row">
            <input className="input" type="file" accept=".csv,.xlsx,.xlsm,.json" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            <button className="button button-primary whitespace-nowrap" disabled={busy} onClick={upload}>{busy ? 'Working...' : 'Upload Label File'}</button>
          </div>
          <p className="mt-3 text-sm text-slate-500">Use a Metro label file with tracking, driver, route, address, city, and postal code columns.</p>
        </div>
        <LabelPreview row={preview} />
      </div>
      <div className="card p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_auto_auto]">
          <TextInput label="Search Tracking / Barcode" value={search} onChange={setSearch} />
          <SelectInput label="Status" value={status} options={['', 'Pending', 'Printed', 'Reprinted', 'Error']} onChange={setStatus} />
          <button className="button mt-6" onClick={() => load().catch((error) => showNotice('error', error.message))}>Apply</button>
          <button className="button button-primary mt-6" disabled={busy} onClick={bulkPrint}>Print Selected</button>
        </div>
      </div>
      <DataTable
        title="Metro Labels"
        rows={rows}
        columns={['trackingNumber', 'customerName', 'route', 'status', 'printedAt', 'errorMessage']}
        emptyText="Upload a file to begin."
        select={{ selected, onChange: setSelected }}
        onRowClick={(row) => setPreview(row)}
        actions={(row: MetroLabelRow) => (
          <div className="flex flex-wrap gap-2">
            <button className="button" onClick={() => setPreview(row)}>Preview</button>
            <button className="button button-primary" disabled={busy} onClick={() => printRow(row)}>Print</button>
            <button className="button" disabled={busy} onClick={() => printRow(row, 'reprint')}>Reprint</button>
          </div>
        )}
      />
    </PageStack>
  );
}

function FulfilmentReportsPage({ showNotice }: { showNotice: (type: NoticeType, text: string) => void }) {
  const [rows, setRows] = useState<FulfilmentReport[]>([]);
  const [form, setForm] = useState({ reportDate: new Date().toISOString().slice(0, 10), client: 'Metro', service: '', route: '' });
  const load = async () => setRows((await api<{ rows: FulfilmentReport[] }>('/fulfilment/report')).rows);
  useEffect(() => { load().catch((error) => showNotice('error', error.message)); }, []);
  const generate = async () => {
    try {
      await postJson('/fulfilment/report/generate', form);
      showNotice('success', 'Fulfilment report generated.');
      await load();
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };
  const exportReport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    try {
      await downloadFromApi(`/fulfilment/report/export/${format}`, `fulfilment-reports.${format}`);
      showNotice('success', `${format.toUpperCase()} report exported.`);
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };
  return (
    <PageStack>
      <PageHeader title="Fulfilment Reports" subtitle="Generate and export completion reports." />
      <FormCard title="Generate Report">
        <FormGrid cols="grid-cols-1 md:grid-cols-4">
          <TextInput label="Report Date" value={form.reportDate} onChange={(reportDate) => setForm({ ...form, reportDate })} />
          <TextInput label="Client" value={form.client} onChange={(client) => setForm({ ...form, client })} />
          <TextInput label="Service" value={form.service} onChange={(service) => setForm({ ...form, service })} />
          <TextInput label="Route" value={form.route} onChange={(route) => setForm({ ...form, route })} />
        </FormGrid>
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="button button-primary" onClick={generate}>Generate From Labels</button>
          <button className="button" onClick={() => exportReport('csv')}>Export CSV</button>
          <button className="button" onClick={() => exportReport('xlsx')}>Export XLSX</button>
          <button className="button" onClick={() => exportReport('pdf')}>Export PDF</button>
        </div>
      </FormCard>
      <DataTable title="Fulfilment Reports" rows={rows} columns={['reportDate', 'client', 'service', 'route', 'totalUploaded', 'totalPrinted', 'pending', 'errors', 'completionPercent']} emptyText="No reports yet." />
    </PageStack>
  );
}

function PrinterSetupPage({ showNotice }: { showNotice: (type: NoticeType, text: string) => void }) {
  const [token, setToken] = useState(getAgentToken());
  const [printer, setPrinter] = useState(getDefaultPrinter());
  const [printers, setPrinters] = useState<any[]>([]);
  const [status, setStatus] = useState('Not checked');
  const [busy, setBusy] = useState(false);

  const detect = async () => {
    setBusy(true);
    try {
      setAgentToken(token);
      await checkAgent();
      const response = await getPrinters();
      setPrinters(response.printers || []);
      setPrinter(printer || response.defaultPrinter || response.printers?.[0]?.Name || '');
      setStatus('Online');
      showNotice('success', 'Print service is online.');
    } catch (error: any) {
      setStatus('Offline');
      showNotice('error', error.message);
    } finally {
      setBusy(false);
    }
  };

  const savePrinter = async () => {
    try {
      setAgentToken(token);
      await saveAgentPrinter(printer);
      showNotice('success', `Default label printer saved: ${printer}`);
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };

  const testPrint = async () => {
    if (!printer) return showNotice('error', 'Select a printer first.');
    setBusy(true);
    try {
      setAgentToken(token);
      const prepared = await postJson<any>('/labels/print/test', { printerName: printer, type: 'zpl' });
      await sendPrintJob(prepared.localAgentJob);
      showNotice('success', `Test label sent to ${printer}.`);
    } catch (error: any) {
      showNotice('error', error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageStack>
      <PageHeader title="Printer Setup" subtitle="Choose and test the label printer for this workstation." />
      <div className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
        <FormCard title="Printer Connection">
          <FormGrid cols="grid-cols-1">
            <TextInput label="Printer Access Token" value={token} onChange={setToken} />
            <SelectInput label="Default Label Printer" value={printer} options={['', ...printers.map((item) => item.Name)]} onChange={setPrinter} />
          </FormGrid>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="button button-primary" disabled={busy} onClick={detect}>{busy ? 'Checking...' : 'Find Printers'}</button>
            <button className="button" onClick={savePrinter}>Save Printer</button>
            <button className="button" disabled={busy} onClick={testPrint}>Test 4x2 Label</button>
          </div>
        </FormCard>
        <Panel title="Printer Status">
          <div className="grid gap-3 text-sm text-slate-700">
            <MiniStatus label="Status" value={status} />
            <MiniStatus label="Saved Printer" value={printer || 'Not selected'} />
          </div>
        </Panel>
      </div>
      <DataTable title="Available Printers" rows={printers} columns={['Name', 'PrinterStatus']} emptyText="No printers found." />
    </PageStack>
  );
}

function DataPage({ showNotice }: { showNotice: (type: NoticeType, text: string) => void }) {
  const empty = { date: '', facility: '', pieces: '', throughput: '', productivity: '', cycleTime: '', status: 'Active', notes: '' };
  const [rows, setRows] = useState<OperationRow[]>([]);
  const [facilities, setFacilities] = useState<string[]>([]);
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', facility: '', status: '', search: '' });
  const [form, setForm] = useState<any>(empty);
  const [editingId, setEditingId] = useState('');
  const load = async () => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    const response = await api<{ rows: OperationRow[]; facilities: string[] }>(`/data?${query}`);
    setRows(response.rows);
    setFacilities(response.facilities);
  };
  useEffect(() => { load().catch((error) => showNotice('error', error.message)); }, []);
  const save = async () => {
    try {
      if (editingId) await putJson(`/data/${editingId}`, form);
      else await postJson('/data', form);
      showNotice('success', editingId ? 'Data row updated.' : 'Data row added.');
      setForm(empty);
      setEditingId('');
      load();
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };
  const remove = async (id: string) => {
    await api(`/data/${id}`, { method: 'DELETE' });
    showNotice('success', 'Data row deleted.');
    load();
  };
  return (
    <PageStack>
      <PageHeader title="Operations Data" subtitle="View and manage daily operations records." action={<button className="button" onClick={load}>Apply Filters</button>} />
      <div className="card p-5">
        <FormGrid cols="grid-cols-1 md:grid-cols-5">
          <TextInput label="Date From" value={filters.dateFrom} onChange={(dateFrom) => setFilters({ ...filters, dateFrom })} />
          <TextInput label="Date To" value={filters.dateTo} onChange={(dateTo) => setFilters({ ...filters, dateTo })} />
          <SelectInput label="Facility" value={filters.facility} options={['', ...facilities]} onChange={(facility) => setFilters({ ...filters, facility })} />
          <TextInput label="Status" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} />
          <TextInput label="Search" value={filters.search} onChange={(search) => setFilters({ ...filters, search })} />
        </FormGrid>
      </div>
      <FormCard title={editingId ? 'Edit Data Row' : 'Add Data Row'}>
        <FormGrid cols="grid-cols-1 md:grid-cols-4">
          {['date', 'facility', 'pieces', 'throughput', 'productivity', 'cycleTime', 'status', 'notes'].map((key) => (
            <TextInput key={key} label={human(key)} value={String(form[key] ?? '')} onChange={(value) => setForm({ ...form, [key]: value })} />
          ))}
        </FormGrid>
        <button className="button button-primary mt-4" onClick={save}>{editingId ? 'Save Changes' : 'Add Row'}</button>
      </FormCard>
      <DataTable title="Daily Records" rows={rows} columns={['date', 'facility', 'pieces', 'throughput', 'status']} emptyText="No records yet." actions={(row) => (
        <div className="flex gap-2">
          <button className="button" onClick={() => { setEditingId(row.id); setForm(row); }}>Edit</button>
          <button className="button" onClick={() => remove(row.id)}>Delete</button>
        </div>
      )} />
    </PageStack>
  );
}

function ImportsPage({ showNotice }: { showNotice: (type: NoticeType, text: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [errors, setErrors] = useState<any[]>([]);
  const load = async () => setLogs((await api<{ rows: any[] }>('/imports/logs')).rows);
  useEffect(() => { load().catch((error) => showNotice('error', error.message)); }, []);
  const upload = async () => {
    if (!file) return showNotice('error', 'Choose a CSV, XLSX, or JSON file first.');
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await api<any>('/imports', { method: 'POST', body: form });
      setErrors([]);
      showNotice('success', `Imported ${response.importedRows} rows.`);
      load();
    } catch (error: any) {
      setErrors(Array.isArray(error.details) ? error.details : []);
      showNotice('error', error.message);
    }
  };
  return (
    <PageStack>
      <PageHeader title="Files & Reports" subtitle="Upload and review operational files." />
      <div className="card p-5">
        <div className="mb-4 flex flex-wrap gap-2">
          <NavLink className="button button-primary" to="/imports">Imports</NavLink>
          <NavLink className="button" to="/exports">Exports</NavLink>
        </div>
        <div className="flex flex-col gap-3 md:flex-row">
          <input className="input" type="file" accept=".csv,.xlsx,.xlsm,.json" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          <button className="button button-primary" onClick={upload}>Validate & Import</button>
        </div>
        {errors.length > 0 && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errors.slice(0, 8).map((error) => <div key={`${error.row}-${error.message}`}>Row {error.row}: {error.message}</div>)}</div>}
      </div>
      <DataTable title="Import History" rows={logs} columns={['createdAt', 'fileName', 'status', 'message', 'uploadedBy']} emptyText="No import history yet." />
    </PageStack>
  );
}

function ExportsPage({ showNotice }: { showNotice: (type: NoticeType, text: string) => void }) {
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', facility: '', status: '' });
  const [logs, setLogs] = useState<any[]>([]);
  const load = async () => setLogs((await api<{ rows: any[] }>('/exports/logs')).rows);
  useEffect(() => { load().catch((error) => showNotice('error', error.message)); }, []);
  const runExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    try {
      await downloadExport(format, filters);
      showNotice('success', `${format.toUpperCase()} export created from table data.`);
      load();
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };
  return (
    <PageStack>
      <PageHeader title="Files & Reports" subtitle="Create and download report files." />
      <div className="card p-5">
        <div className="mb-4 flex flex-wrap gap-2">
          <NavLink className="button" to="/imports">Imports</NavLink>
          <NavLink className="button button-primary" to="/exports">Exports</NavLink>
        </div>
        <FormGrid cols="grid-cols-1 md:grid-cols-4">
          <TextInput label="Date From" value={filters.dateFrom} onChange={(dateFrom) => setFilters({ ...filters, dateFrom })} />
          <TextInput label="Date To" value={filters.dateTo} onChange={(dateTo) => setFilters({ ...filters, dateTo })} />
          <TextInput label="Facility" value={filters.facility} onChange={(facility) => setFilters({ ...filters, facility })} />
          <TextInput label="Status" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} />
        </FormGrid>
        <div className="mt-4 flex gap-3">
          <button className="button button-primary" onClick={() => runExport('csv')}>Export CSV</button>
          <button className="button button-primary" onClick={() => runExport('xlsx')}>Export XLSX</button>
          <button className="button button-primary" onClick={() => runExport('pdf')}>Export PDF</button>
        </div>
      </div>
      <DataTable title="Export History" rows={logs} columns={['createdAt', 'format', 'rowCount', 'fileName', 'requestedBy']} emptyText="No export history yet." />
    </PageStack>
  );
}

function UsersPage({ showNotice }: { showNotice: (type: NoticeType, text: string) => void }) {
  const [data, setData] = useState<any>({ users: [], roles: [], sections: [] });
  const [form, setForm] = useState<any>({ username: '', displayName: '', password: '', role: 'Scanner/User', active: true, permissions: ['dashboard'] });
  const load = async () => setData(await api('/users'));
  useEffect(() => { load().catch((error) => showNotice('error', error.message)); }, []);
  const create = async () => {
    try {
      await postJson('/users', form);
      showNotice('success', 'User created.');
      setForm({ username: '', displayName: '', password: '', role: 'Scanner/User', active: true, permissions: ['dashboard'] });
      load();
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };
  const save = async (user: any) => {
    await putJson(`/users/${user.id}`, user);
    showNotice('success', 'User updated.');
    load();
  };
  return (
    <PageStack>
      <PageHeader title="Users" subtitle="Manage team access and roles." />
      <FormCard title="Create User">
        <FormGrid cols="grid-cols-1 md:grid-cols-5">
          <TextInput label="Username" value={form.username} onChange={(username) => setForm({ ...form, username })} />
          <TextInput label="Display Name" value={form.displayName} onChange={(displayName) => setForm({ ...form, displayName })} />
          <TextInput label="Password" type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
          <SelectInput label="Role" value={form.role} options={data.roles} onChange={(role) => setForm({ ...form, role })} />
          <SelectInput label="Status" value={form.active ? 'Active' : 'Disabled'} options={['Active', 'Disabled']} onChange={(status) => setForm({ ...form, active: status === 'Active' })} />
        </FormGrid>
        <PermissionChecks sections={data.sections} value={form.permissions} onChange={(permissions) => setForm({ ...form, permissions })} disabled={form.role === 'Admin'} />
        <button className="button button-primary mt-4" onClick={create}>Create User</button>
      </FormCard>
      <div className="grid gap-4">
        {data.users.map((user: any) => <UserCard key={user.id} user={user} roles={data.roles} sections={data.sections} onSave={save} />)}
      </div>
    </PageStack>
  );
}

function UserCard({ user, roles, sections, onSave }: { user: any; roles: string[]; sections: string[]; onSave: (user: any) => void }) {
  const [draft, setDraft] = useState({ ...user, password: '' });
  return (
    <div className="card p-5">
      <FormGrid cols="grid-cols-1 md:grid-cols-5">
        <TextInput label="Username" value={draft.username} onChange={(username) => setDraft({ ...draft, username })} />
        <TextInput label="Display Name" value={draft.displayName} onChange={(displayName) => setDraft({ ...draft, displayName })} />
        <TextInput label="Reset Password" type="password" value={draft.password} onChange={(password) => setDraft({ ...draft, password })} />
        <SelectInput label="Role" value={draft.role} options={roles} onChange={(role) => setDraft({ ...draft, role })} />
        <SelectInput label="Status" value={draft.active ? 'Active' : 'Disabled'} options={['Active', 'Disabled']} onChange={(status) => setDraft({ ...draft, active: status === 'Active' })} />
      </FormGrid>
      <PermissionChecks sections={sections} value={draft.permissions || []} onChange={(permissions) => setDraft({ ...draft, permissions })} disabled={draft.role === 'Admin'} />
      <button className="button button-primary mt-4" onClick={() => onSave(draft)}>Save User</button>
    </div>
  );
}

function ActivityPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [uploads, setUploads] = useState<any[]>([]);
  const [exportsLog, setExportsLog] = useState<any[]>([]);
  const [printLogs, setPrintLogs] = useState<any[]>([]);
  useEffect(() => {
    api<{ rows: any[] }>('/logs/audit').then((res) => setLogs(res.rows));
    api<{ rows: any[] }>('/logs/uploads').then((res) => setUploads(res.rows));
    api<{ rows: any[] }>('/logs/exports').then((res) => setExportsLog(res.rows));
    api<{ rows: any[] }>('/labels/logs').then((res) => setPrintLogs(res.rows)).catch(() => null);
  }, []);
  return (
    <PageStack>
      <PageHeader title="Activity Logs" subtitle="Review system activity and print history." />
      <DataTable title="Team Activity" rows={logs} columns={['createdAt', 'actor', 'action', 'entity']} emptyText="No activity found." />
      <DataTable title="Print History" rows={printLogs} columns={['timestamp', 'trackingNumber', 'action', 'status', 'printerName', 'errorMessage']} emptyText="No print history yet." />
      <DataTable title="Import History" rows={uploads} columns={['createdAt', 'fileName', 'status', 'uploadedBy']} emptyText="No import history yet." />
      <DataTable title="Export History" rows={exportsLog} columns={['createdAt', 'format', 'rowCount', 'requestedBy']} emptyText="No export history yet." />
    </PageStack>
  );
}

function SettingsPage({ user, showNotice }: { user: User; showNotice: (type: NoticeType, text: string) => void }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const initialize = async () => {
    try {
      const response = await postJson<{ message: string }>('/health/initialize-google-tabs', {});
      showNotice('success', response.message);
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };
  return (
    <PageStack>
      <PageHeader title="Settings" subtitle="Manage platform preferences and system setup." />
      <Panel title="Platform Preferences">
        <div className="grid gap-3 md:grid-cols-3">
          <MiniStatus label="Theme" value="Enterprise light" />
          <MiniStatus label="Session" value="Protected" />
          <MiniStatus label="Access" value={user.role} />
        </div>
      </Panel>
      {user.role === 'Admin' && (
        <Panel title="Advanced setup">
          <button className="button" onClick={() => setAdvancedOpen((value) => !value)}>
            {advancedOpen ? 'Hide advanced setup' : 'Show advanced setup'}
          </button>
          {advancedOpen && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-black uppercase tracking-[0.14em] text-amber-700">System Setup</div>
              <p className="mt-2 text-sm font-semibold text-amber-800">Admin use only.</p>
              <p className="mt-2 text-sm text-amber-800">Use this only when the platform setup needs to be initialized or repaired.</p>
              <button className="button button-primary mt-4" onClick={initialize}>Initialize Required Setup</button>
            </div>
          )}
        </Panel>
      )}
    </PageStack>
  );
}

function LabelPreview({ row }: { row: MetroLabelRow | null }) {
  return (
    <div className="card p-5">
      <h3 className="mb-4 font-black text-slate-950">4x2 Label Preview</h3>
      {row ? (
        <div className="mx-auto aspect-[2/1] w-full max-w-[440px] overflow-hidden rounded-lg border-2 border-slate-900 bg-white text-slate-900 shadow-enterprise">
          <div className="grid grid-cols-[38%_62%] border-b-2 border-slate-900">
            <div className="p-2 text-lg font-black">Tracking No.</div>
            <div className="p-2 text-xl font-black">{row.trackingNumber}</div>
          </div>
          <div className="grid grid-cols-[38%_62%] border-b border-slate-400">
            <div className="p-2 text-lg font-black">Driver:</div>
            <div className="p-2 text-center text-xl font-black">{row.customerName || 'N/A'}</div>
          </div>
          <div className="grid grid-cols-[38%_62%] border-b border-slate-400">
            <div className="p-2 text-lg font-black">Routing Seq:</div>
            <div className="p-2 text-center text-2xl font-black">{row.route || 'N/A'}</div>
          </div>
          <div className="grid grid-cols-[38%_62%]">
            <div className="p-2 text-lg font-black">Address:</div>
            <div className="p-2 text-center text-base font-black">{row.service || row.customerName || 'N/A'}</div>
          </div>
        </div>
      ) : <EmptyState text="Select or import a label row to preview the 4x2 layout." />}
    </div>
  );
}

function TextInput({ label, value, onChange, type = 'text', onEnter }: { label: string; value: string; onChange: (value: string) => void; type?: string; onEnter?: () => void }) {
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const isPassword = type === 'password';
  const updateCapsLock = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isPassword) setCapsLock(event.getModifierState('CapsLock'));
  };
  return (
    <label className="label">
      {label}
      <span className="relative block">
        <input
          className={`input ${isPassword ? 'pr-12' : ''}`}
          type={isPassword && showPassword ? 'text' : type}
          value={value}
          autoComplete={isPassword ? 'current-password' : 'username'}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setCapsLock(false)}
          onKeyDown={(event) => {
            updateCapsLock(event);
            if (event.key === 'Enter' && onEnter) onEnter();
          }}
          onKeyUp={updateCapsLock}
        />
        {isPassword && (
          <button aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-broad-teal" type="button" onClick={() => setShowPassword((current) => !current)}>
            <EyeIcon crossed={!showPassword} />
          </button>
        )}
      </span>
      {capsLock && <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-bold normal-case tracking-normal text-amber-700">Caps Lock is on</span>}
    </label>
  );
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M2.75 12s3.4-6 9.25-6 9.25 6 9.25 6-3.4 6-9.25 6-9.25-6-9.25-6Z" />
      <path d="M12 9.25a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5Z" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  );
}

function SelectInput({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="label">{label}<select className="input" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option || 'All'}</option>)}</select></label>;
}

function PermissionChecks({ sections, value, onChange, disabled }: { sections: string[]; value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  const checked = disabled ? sections : value;
  return (
    <div className="mt-4 grid gap-2 md:grid-cols-4">
      {sections.map((section) => (
        <label key={section} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <input type="checkbox" disabled={disabled} checked={checked.includes(section)} onChange={(event) => onChange(event.target.checked ? [...value, section] : value.filter((item) => item !== section))} />
          {sectionLabels[section as SectionKey] || human(section)}
        </label>
      ))}
    </div>
  );
}

function PageStack({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid max-w-[1540px] gap-5">{children}</div>;
}

function PageHeader({ action }: { title: string; subtitle: string; action?: ReactNode }) {
  return action ? <div className="flex justify-end">{action}</div> : null;
}

function Kpi({ label, value, helper, tone = 'slate', icon }: { label: string; value: string; helper?: string; tone?: 'slate' | 'teal' | 'amber' | 'red'; icon?: IconName }) {
  const accent = tone === 'teal' ? 'bg-cyan-50 text-broad-teal' : tone === 'amber' ? 'bg-amber-50 text-amber-600' : tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-blue-600';
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
          <div className="mt-3 text-3xl font-black text-slate-950">{value}</div>
        </div>
        {icon && <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${accent}`}><NavIcon name={icon} /></div>}
      </div>
      {helper && <div className="mt-3 text-sm font-semibold text-slate-500">{helper}</div>}
    </div>
  );
}

function MiniStatus({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</div><div className="mt-1 text-sm font-bold text-slate-950">{value}</div></div>;
}

function StatusPill({ text }: { text: string }) {
  return <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700">{text}</span>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <div className="card p-5"><h3 className="mb-4 font-bold text-slate-950">{title}</h3>{children}</div>;
}

function FormCard({ title, children }: { title: string; children: ReactNode }) {
  return <div className="card p-5"><h3 className="mb-4 font-bold text-slate-950">{title}</h3>{children}</div>;
}

function FormGrid({ children, cols = 'grid-cols-3' }: { children: ReactNode; cols?: string }) {
  return <div className={`grid gap-4 ${cols}`}>{children}</div>;
}

function Segmented({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white">
      {options.map((option) => (
        <button key={option} className={`px-4 py-2 text-sm font-bold transition ${value === option ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`} onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}

function DataTable({ title, rows, columns, actions, select, onRowClick, emptyText = 'No records yet.' }: { title: string; rows: any[]; columns: string[]; actions?: (row: any) => ReactNode; select?: { selected: string[]; onChange: (ids: string[]) => void }; onRowClick?: (row: any) => void; emptyText?: string }) {
  const allIds = rows.map((row) => row.id).filter(Boolean);
  const allSelected = Boolean(allIds.length) && allIds.every((id) => select?.selected.includes(id));
  const toggleAll = () => {
    if (!select) return;
    select.onChange(allSelected ? select.selected.filter((id) => !allIds.includes(id)) : Array.from(new Set([...select.selected, ...allIds])));
  };
  const toggleOne = (idValue: string) => {
    if (!select) return;
    select.onChange(select.selected.includes(idValue) ? select.selected.filter((id) => id !== idValue) : [...select.selected, idValue]);
  };
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-4"><h3 className="font-bold text-slate-950">{title}</h3></div>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full">
          <thead className="table-head">
            <tr>
              {select && <th className="px-4 py-3"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>}
              {columns.map((column) => <th key={column} className="px-4 py-3">{human(column)}</th>)}
              {actions && <th className="px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {rows?.length ? rows.map((row, index) => (
              <tr key={row.id || index} className="hover:bg-slate-50">
                {select && <td className="px-4 py-3"><input type="checkbox" checked={select.selected.includes(row.id)} onChange={() => toggleOne(row.id)} /></td>}
                {columns.map((column) => <td key={column} className="max-w-sm cursor-default truncate px-4 py-3" onClick={() => onRowClick?.(row)}>{formatCell(row[column])}</td>)}
                {actions && <td className="px-4 py-3">{actions(row)}</td>}
              </tr>
            )) : <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={columns.length + (actions ? 1 : 0) + (select ? 1 : 0)}>{emptyText}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 p-4 md:hidden">
        {rows?.length ? rows.map((row, index) => (
          <div key={row.id || index} className="rounded-xl border border-slate-200 bg-slate-50 p-4" onClick={() => onRowClick?.(row)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-slate-950">{formatCell(row[columns[0]]) || `Record ${index + 1}`}</div>
                {columns.slice(1, 5).map((column) => (
                  <div key={column} className="mt-2 grid grid-cols-[110px_1fr] gap-2 text-xs">
                    <span className="font-bold uppercase tracking-[0.1em] text-slate-500">{human(column)}</span>
                    <span className="truncate font-semibold text-slate-800">{formatCell(row[column]) || '-'}</span>
                  </div>
                ))}
              </div>
              {select && row.id && <input type="checkbox" checked={select.selected.includes(row.id)} onChange={() => toggleOne(row.id)} onClick={(event) => event.stopPropagation()} />}
            </div>
            {actions && <div className="mt-3 flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>{actions(row)}</div>}
          </div>
        )) : <EmptyState text={emptyText} />}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="grid min-h-32 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">{text}</div>;
}

function NoticeBanner({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const tone = notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-blue-200 bg-blue-50 text-blue-800';
  return <div className={`mb-5 rounded-xl border px-4 py-3 text-sm font-semibold shadow-enterprise ${tone}`}>{notice.text}</div>;
}

function MenuIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      {collapsed ? <path d="m9 6 6 6-6 6" /> : <path d="m15 6-6 6 6 6" />}
    </svg>
  );
}

function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    grid: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></>,
    data: <><path d="M4 19V5m5 14V9m5 10V7m5 12V3" /><path d="M3 19h18" /></>,
    label: <><path d="M4 7a3 3 0 0 1 3-3h10l3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" /><path d="M8 9h8M8 13h6" /></>,
    report: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 12h6M9 16h6M9 8h2" /></>,
    import: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" /></>,
    export: <><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M4 3h16" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-8 0v2" /><circle cx="12" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    activity: <><path d="M3 12h4l3 8 4-16 3 8h4" /></>,
    printer: <><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /></>,
    settings: <><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" /><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.8 1.8 0 0 0 15 19.4a1.8 1.8 0 0 0-1 .6 1.8 1.8 0 0 0-.5 1.3V21a2 2 0 1 1-4 0v-.09A1.8 1.8 0 0 0 8 19.4a1.8 1.8 0 0 0-1.98.36l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-.6-1 1.8 1.8 0 0 0-1.3-.5H3a2 2 0 1 1 0-4h.09A1.8 1.8 0 0 0 4.6 8a1.8 1.8 0 0 0-.36-1.98l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.8 1.8 0 0 0 9 4.6a1.8 1.8 0 0 0 1-.6 1.8 1.8 0 0 0 .5-1.3V3a2 2 0 1 1 4 0v.09A1.8 1.8 0 0 0 16 4.6a1.8 1.8 0 0 0 1.98-.36l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.8 1.8 0 0 0 19.4 9c.2.38.5.7.9.9.4.2.8.3 1.2.3H21a2 2 0 1 1 0 4h-.09a1.8 1.8 0 0 0-1.51.8Z" /></>
  };
  return <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : '0';
}

function human(value: string) {
  return value.replace(/_/g, ' ').replace(/-/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatCell(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : '';
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
