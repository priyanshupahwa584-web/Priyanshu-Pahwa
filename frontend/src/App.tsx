import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, clearAccessToken, downloadExport, downloadFromApi, postJson, putJson, storeAccessToken } from './services/api';
import { checkAgent, getAgentToken, getDefaultPrinter, getPrinters, saveAgentPrinter, sendPrintJob, setAgentToken } from './services/printAgent';
import type { FacilityAnalytics, FulfilmentReport, MetroLabelRow, Notice, NoticeType, OperationRow, SectionKey, User } from './types';

const idleTimeoutMs = 30 * 60 * 1000;
const appVersion = 'v1.0.0';

type IconName = 'grid' | 'data' | 'label' | 'report' | 'import' | 'export' | 'users' | 'activity' | 'printer' | 'settings';
type NavItem = { key: SectionKey; label: string; path: string; icon: IconName; sidebar?: boolean; subtitle?: string };
type HeatmapSelection = { facility: string; date: string } | null;

const navItems: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: 'grid', subtitle: 'Live facility volume, trends, and performance movement.' },
  { key: 'data', label: 'Facility Operations', path: '/facility-operations', icon: 'data', subtitle: 'Live facility volume, trends, and performance movement.' },
  { key: 'activity', label: 'Executive Summary', path: '/executive-summary', icon: 'report', subtitle: 'Leadership view of performance, peaks, and facility movement.' },
  { key: 'metro-labeling', label: 'Metro Labeling', path: '/metro-labeling', icon: 'label', sidebar: false, subtitle: 'Upload, search, preview, and print Metro labels.' },
  { key: 'fulfilment', label: 'Fulfilment Reports', path: '/fulfilment-reports', icon: 'report', sidebar: false, subtitle: 'Generate and export completion reports.' },
  { key: 'users', label: 'Users', path: '/users', icon: 'users', subtitle: 'Manage team access and roles.' },
  { key: 'activity', label: 'Activity Logs', path: '/activity', icon: 'activity', sidebar: false, subtitle: 'Review system activity and print history.' },
  { key: 'security', label: 'My Security', path: '/security', icon: 'settings', subtitle: 'Manage password, two-factor authentication, and active sessions.' },
  { key: 'imports', label: 'Files & Reports', path: '/imports', icon: 'import', sidebar: false, subtitle: 'Upload and review operational files.' },
  { key: 'exports', label: 'Files & Reports', path: '/exports', icon: 'export', sidebar: false, subtitle: 'Create and download report files.' },
  { key: 'printer-setup', label: 'Printer Setup', path: '/printer-setup', icon: 'printer', sidebar: false, subtitle: 'Choose and test the label printer for this workstation.' },
  { key: 'settings', label: 'Settings', path: '/settings', icon: 'settings', subtitle: 'Manage platform preferences and system setup.' }
];

const pageSubtitles: Partial<Record<SectionKey, string>> = {
  dashboard: 'Live facility volume, trends, and performance movement.',
  data: 'Live facility volume, trends, and performance movement.',
  'metro-labeling': 'Metro Labeling',
  fulfilment: 'Fulfilment Reports',
  imports: 'File Imports',
  exports: 'File Exports',
  users: 'Manage team access and roles.',
  activity: 'Leadership view of performance, peaks, and facility movement.',
  'printer-setup': 'Printer Setup',
  settings: 'Manage platform preferences and system setup.',
  security: 'Manage password, two-factor authentication, and active sessions.'
};

const sectionLabels: Partial<Record<SectionKey, string>> = {
  dashboard: 'Dashboard',
  data: 'Facility Operations',
  'metro-labeling': 'Metro Labeling',
  fulfilment: 'Fulfilment Reports',
  imports: 'File Imports',
  exports: 'File Exports',
  users: 'Users',
  activity: 'Executive Summary',
  'printer-setup': 'Printer Setup',
  settings: 'Settings',
  security: 'My Security'
};

function canAccess(user: User, section: SectionKey) {
  if (section === 'security') return true;
  return user.role === 'Admin' || user.permissions.includes(section);
}

export default function App() {
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [startingServer, setStartingServer] = useState(false);
  const [bootstrapRetry, setBootstrapRetry] = useState(0);

  const showNotice = (type: NoticeType, text: string) => {
    setNotice({ type, text });
    window.setTimeout(() => setNotice((current) => (current?.text === text ? null : current)), 4000);
  };

  useEffect(() => {
    let active = true;
    const slowTimer = window.setTimeout(() => active && setStartingServer(true), 15000);
    setLoading(true);
    setStartingServer(false);
    api<{ user: User }>('/auth/me')
      .then((response) => {
        if (!active) return;
        setUser(response.user);
      })
      .catch((error: any) => {
        if (!active) return;
        setUser(null);
        const message = error.status === 401
          ? 'Session expired. Please sign in again.'
          : error.status === 408
            ? 'Starting secure server...'
            : '';
        if (message) setNotice({ type: 'info', text: message });
      })
      .finally(() => {
        if (!active) return;
        window.clearTimeout(slowTimer);
        setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(slowTimer);
    };
  }, [bootstrapRetry]);

  useEffect(() => {
    const expire = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message || 'Session expired. Please sign in again.';
      setUser(null);
      setLoading(false);
      showNotice('info', message);
    };
    window.addEventListener('broadreach:unauthorized', expire);
    return () => window.removeEventListener('broadreach:unauthorized', expire);
  }, []);

  if (loading) return <Splash startingServer={startingServer} onRetry={() => setBootstrapRetry((value) => value + 1)} />;
  if (!user) {
    const login = <LoginScreen onLogin={setUser} notice={notice} showNotice={showNotice} />;
    if (location.pathname !== '/login') return <><Navigate to="/login" replace />{login}</>;
    return login;
  }

  return (
    <Shell user={user} setUser={setUser} notice={notice} showNotice={showNotice}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Guard user={user} section="dashboard"><DashboardPage showNotice={showNotice} /></Guard>} />
        <Route path="/facility-operations" element={<Guard user={user} section="data"><FacilityAnalyticsPage showNotice={showNotice} /></Guard>} />
        <Route path="/facility-analytics" element={<Navigate to="/facility-operations" replace />} />
        <Route path="/executive-summary" element={<Guard user={user} section="activity"><ExecutiveSummaryPage showNotice={showNotice} /></Guard>} />
        <Route path="/data" element={<Navigate to="/facility-operations" replace />} />
        <Route path="/metro-labeling" element={<Guard user={user} section="metro-labeling"><MetroLabelingPage showNotice={showNotice} /></Guard>} />
        <Route path="/fulfilment-reports" element={<Guard user={user} section="fulfilment"><FulfilmentReportsPage showNotice={showNotice} /></Guard>} />
        <Route path="/imports" element={<Guard user={user} section="imports"><ImportsPage showNotice={showNotice} /></Guard>} />
        <Route path="/exports" element={<Guard user={user} section="exports"><ExportsPage showNotice={showNotice} /></Guard>} />
        <Route path="/users" element={<Guard user={user} section="users"><UsersPage currentUser={user} showNotice={showNotice} /></Guard>} />
        <Route path="/activity" element={<Guard user={user} section="activity"><ActivityPage /></Guard>} />
        <Route path="/printer-setup" element={<Guard user={user} section="printer-setup"><PrinterSetupPage showNotice={showNotice} /></Guard>} />
        <Route path="/security" element={<SecurityPage user={user} showNotice={showNotice} />} />
        <Route path="/settings" element={<Guard user={user} section="settings"><SettingsPage user={user} showNotice={showNotice} /></Guard>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Shell>
  );
}

function Splash({ startingServer = false, onRetry }: { startingServer?: boolean; onRetry?: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-broad-navy text-white">
      <div className="text-center">
        <img src="/icons/app-logo.png" className="mx-auto mb-6 w-72" alt="Broad Reach" />
        <div className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-100">{startingServer ? 'Starting secure server...' : 'Loading secure workspace'}</div>
        {startingServer && (
          <button className="button mt-6 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={onRetry}>
            Retry connection
          </button>
        )}
      </div>
    </div>
  );
}

function LoginScreen({ onLogin, notice, showNotice }: { onLogin: (user: User) => void; notice: Notice; showNotice: (type: NoticeType, text: string) => void }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [secondFactor, setSecondFactor] = useState('');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
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
    if (requiresTwoFactor && !secondFactor.trim()) {
      showNotice('error', useRecoveryCode ? 'Enter a recovery code.' : 'Enter your authenticator code.');
      return;
    }
    setBusy(true);
    try {
      const response = await postJson<{ user?: User; requiresTwoFactor?: boolean; message?: string; accessToken?: string; accessTokenExpiresAt?: string }>('/auth/login', {
        ...form,
        totpCode: useRecoveryCode ? '' : secondFactor,
        recoveryCode: useRecoveryCode ? secondFactor : '',
        rememberDevice: secureRememberAvailable && rememberDevice
      });
      if (response.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        showNotice('info', response.message || 'Enter your authenticator code.');
        return;
      }
      if (!response.user) throw new Error('Login response was incomplete.');
      if (response.accessToken && response.accessTokenExpiresAt) {
        storeAccessToken(response.accessToken, response.accessTokenExpiresAt);
      }
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
        {requiresTwoFactor && (
          <TextInput
            label={useRecoveryCode ? 'Recovery Code' : 'Authenticator Code'}
            value={secondFactor}
            onChange={setSecondFactor}
            onEnter={submit}
          />
        )}
      </FormGrid>
      {requiresTwoFactor && (
        <button className="mt-3 text-sm font-bold text-broad-teal transition hover:text-broad-cyan" type="button" onClick={() => setUseRecoveryCode((value) => !value)}>
          {useRecoveryCode ? 'Use authenticator code instead' : 'Use a recovery code'}
        </button>
      )}
      {secureRememberAvailable && (
        <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-600">
          <input checked={rememberDevice} onChange={(event) => setRememberDevice(event.target.checked)} type="checkbox" />
          Remember this device
        </label>
      )}
      <button className="button button-primary mt-6 w-full py-3.5 text-base" disabled={busy || !form.username.trim() || !form.password || (requiresTwoFactor && !secondFactor.trim())} onClick={submit}>
        {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
        {busy ? 'Signing in...' : 'Sign In'}
      </button>
      <button className="mt-4 w-full text-center text-sm font-bold text-broad-teal transition hover:text-broad-cyan" disabled={resetBusy} onClick={forgotPassword}>
        {resetBusy ? 'Preparing reset request...' : 'Forgot password?'}
      </button>
      <p className="mt-5 text-center text-xs font-semibold text-slate-500">Need access? Contact admin</p>
    </AuthFrame>
  );
}

function AuthFrame({ notice, children }: { notice: Notice; children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-broad-navy px-4 py-6 sm:px-6 lg:p-6">
      <div className="absolute inset-0 hidden bg-cover bg-center opacity-70 lg:block" style={{ backgroundImage: "url('/icons/brand-hero.png')" }} />
      <div className="auth-pattern absolute inset-0" />
      <div className="auth-orb absolute left-[8%] top-[20%] h-60 w-60 rounded-full bg-broad-cyan/20 blur-3xl lg:h-72 lg:w-72" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_34%_42%,rgba(20,184,184,0.18),transparent_34%),linear-gradient(90deg,rgba(4,12,20,0.97),rgba(4,12,20,0.72),rgba(4,12,20,0.97))]" />
      <div className="relative mx-auto grid min-h-[calc(100vh-48px)] w-full max-w-[1040px] place-items-center">
        <div className="auth-card grid w-full overflow-hidden rounded-[1.7rem] border border-white/15 bg-white/95 shadow-[0_32px_120px_rgba(0,0,0,0.42)] backdrop-blur-xl lg:grid-cols-[0.95fr_1fr]">
          <div className="relative hidden overflow-hidden bg-slate-950 p-10 text-white lg:block xl:p-12">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_35%,rgba(20,184,184,0.3),transparent_34%)]" />
            <div className="relative">
              <img src="/icons/app-logo.png" alt="Broad Reach" className="mb-10 w-56 max-w-full drop-shadow-[0_0_22px_rgba(20,184,184,0.34)] xl:w-64" />
              <h1 className="text-3xl font-black tracking-tight xl:text-4xl">Broadreach Operations</h1>
              <p className="mt-4 max-w-sm text-base leading-7 text-slate-200">Secure access to facility intelligence and operations tools.</p>
            </div>
          </div>
          <div className="auth-form-panel grid content-center p-5 sm:p-8 lg:min-h-[560px] lg:p-10">
            <div className="mb-7 text-center lg:hidden">
              <img src="/icons/app-logo.png" alt="Broad Reach" className="mx-auto mb-5 w-48 drop-shadow-[0_0_18px_rgba(20,184,184,0.28)] sm:w-56" />
              <h1 className="text-2xl font-black tracking-tight text-slate-950">Broadreach Operations</h1>
            </div>
            <div className="mb-6">
              <h2 className="text-2xl font-black tracking-tight text-slate-950">Sign in</h2>
            </div>
            {notice && <NoticeBanner notice={notice} />}
            {children}
          </div>
        </div>
        <footer className="auth-footer mt-5 hidden w-full max-w-[1040px] items-center justify-between gap-2 text-xs font-semibold text-slate-300 sm:flex">
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
    .filter((item) => canAccess(user, item.key));
  const subtitle = current.subtitle || pageSubtitles[current.key] || 'Work safely and keep operations moving.';
  const mobileTitle = current.key === 'data' ? 'Operations' : current.label;
  const showSidebarLabels = !sidebarCollapsed || mobileSidebarOpen;

  const logout = async (message?: string) => {
    await postJson('/auth/logout', {}).catch(() => null);
    clearAccessToken();
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
    <div className={`app-shell min-h-screen bg-[#f6f4ef] lg:h-screen lg:overflow-hidden ${sidebarCollapsed ? 'app-shell-collapsed' : ''}`}>
      {mobileSidebarOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-slate-950/45 lg:hidden" onClick={() => setMobileSidebarOpen(false)} />}
      <aside className={`sidebar fixed inset-y-0 left-0 z-40 flex w-[292px] -translate-x-full flex-col bg-broad-navy px-5 py-5 text-white shadow-2xl transition duration-200 lg:sticky lg:top-0 lg:min-h-screen lg:translate-x-0 lg:shadow-none ${mobileSidebarOpen ? 'translate-x-0' : ''} ${sidebarCollapsed ? 'lg:w-[88px] lg:px-4' : ''}`}>
        <div className={`mb-5 flex items-center gap-3 ${sidebarCollapsed ? 'flex-col justify-center' : 'justify-between'}`}>
          <img src={showSidebarLabels ? '/icons/app-logo.png' : '/icons/app-icon.png'} alt="Broad Reach" className={showSidebarLabels ? 'w-56 max-w-[190px]' : 'h-11 w-11 rounded-xl object-contain'} />
          <button
            aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            className="sidebar-collapse-icon hidden lg:inline-grid"
            title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            <ChevronIcon collapsed={sidebarCollapsed} />
          </button>
          <button aria-label="Close navigation" className="sidebar-icon-button lg:hidden" onClick={() => setMobileSidebarOpen(false)}>
            <CloseIcon />
          </button>
        </div>
        <nav className="grid gap-1">
          {visibleItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              title={!showSidebarLabels ? item.label : undefined}
              className={({ isActive }) => {
                return `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${!showSidebarLabels ? 'justify-center px-2' : ''} ${isActive ? 'bg-white/15 text-white shadow-lg shadow-slate-950/20 ring-1 ring-white/10' : 'text-slate-200 hover:bg-white/10'}`;
              }}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10"><NavIcon name={item.icon} /></span>
              {showSidebarLabels && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 lg:min-h-0 lg:overflow-y-auto">
        <header className="sticky top-0 z-20 flex flex-col gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur md:flex-row md:items-center md:justify-between lg:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button aria-label="Open navigation" className="sidebar-icon-button border-slate-200 bg-white text-slate-800 lg:hidden" onClick={() => setMobileSidebarOpen(true)}>
              <MenuIcon />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-slate-950 sm:text-2xl"><span className="sm:hidden">{mobileTitle}</span><span className="hidden sm:inline">{current.label}</span></h1>
              <p className="hidden truncate text-sm text-slate-500 sm:block">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 md:justify-end">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-broad-navy font-bold text-white">{user.displayName?.[0] || user.username[0]}</div>
            <div className="hidden min-w-0 sm:block">
              <div className="text-sm font-bold">{user.displayName}</div>
              <div className="text-xs text-slate-500">{user.role}</div>
            </div>
            <button className="button px-3 py-2 text-xs sm:px-4 sm:text-sm" onClick={() => logout()}>Logout</button>
          </div>
        </header>
        {notice && <div className="fixed right-6 top-24 z-50 w-96 max-w-[calc(100vw-48px)]"><NoticeBanner notice={notice} /></div>}
        <div className="p-3 sm:p-4 lg:p-5 xl:p-6">{children}</div>
      </main>
    </div>
  );
}

function Guard({ user, section, children }: { user: User; section: SectionKey; children: ReactNode }) {
  return canAccess(user, section) ? <>{children}</> : <Navigate to="/dashboard" replace />;
}

const durationOptions = ['Today', '7D', '30D', 'Month', 'Quarter', 'Year', 'All'];
const aggregationOptions = ['Daily', 'Weekly', 'Monthly'];
const chartTypeOptions = ['Line', 'Bar', 'Pie'];
const chartColors = ['#17324d', '#8a6f3d', '#47706a', '#6e5d86', '#a45f45', '#5b6f91', '#7a7f5a', '#9a6b7c', '#45515f'];

function useFacilityAnalytics(showNotice: (type: NoticeType, text: string) => void, defaults: { duration?: string; aggregation?: string } = {}) {
  const [data, setData] = useState<FacilityAnalytics | null>(null);
  const [duration, setDuration] = useState(defaults.duration || '30D');
  const [aggregation, setAggregation] = useState(defaults.aggregation || 'Daily');
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const facilitiesParam = selectedFacilities.join(',');

  const load = async () => {
    setBusy(true);
    try {
      const query = new URLSearchParams({ duration, aggregation });
      if (facilitiesParam) query.set('facilities', facilitiesParam);
      setData(await api<FacilityAnalytics>(`/facility-intelligence?${query.toString()}`));
    } catch (error: any) {
      if (error.status === 401) return;
      showNotice('error', friendlyOperationsError(error.message));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, [duration, aggregation, facilitiesParam]);

  return { data, busy, duration, setDuration, aggregation, setAggregation, selectedFacilities, setSelectedFacilities, load };
}

function DashboardPage({ showNotice }: { showNotice: (type: NoticeType, text: string) => void }) {
  const analytics = useFacilityAnalytics(showNotice, { duration: '30D' });
  const { data, busy, duration, setDuration, selectedFacilities, setSelectedFacilities, load } = analytics;
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const lineData = useChartWindow(data?.lineSeries || [], duration);
  return (
    <PageStack>
      <PhaseHeader
        title="Facility Operations"
        subtitle="Live facility volume, trends, and performance movement."
        meta={data?.source.latestDate ? `Latest date: ${formatShortDate(data.source.latestDate)}` : 'Preparing view'}
        action={<button className="button button-primary" onClick={load} disabled={busy}>{busy ? 'Refreshing...' : 'Refresh'}</button>}
      />
      <FacilityFilters data={data} duration={duration} setDuration={setDuration} selectedFacilities={selectedFacilities} setSelectedFacilities={setSelectedFacilities} compact />
      {busy && !data ? <DashboardSkeleton /> : data ? (
        <>
          <FacilityKpis data={data} />
          <FacilityLineChart title="Output Trend" data={lineData} facilities={selectedFacilities} allFacilities={data.facilities} onExpand={() => setFullscreenOpen(true)} />
          <FullscreenModal open={fullscreenOpen} title="Output Trend" onClose={() => setFullscreenOpen(false)}>
            <div className="grid h-full min-h-0 gap-3">
              <FacilityFilters data={data} duration={duration} setDuration={setDuration} selectedFacilities={selectedFacilities} setSelectedFacilities={setSelectedFacilities} compact />
              <FacilityLineChart title="Output Trend" data={lineData} facilities={selectedFacilities} allFacilities={data.facilities} fullscreen />
            </div>
          </FullscreenModal>
        </>
      ) : <EmptyState text="No facility data found. Check connection or adjust filters." actionLabel="Refresh" onAction={load} />}
    </PageStack>
  );
}

function FacilityAnalyticsPage({ showNotice }: { showNotice: (type: NoticeType, text: string) => void }) {
  const analytics = useFacilityAnalytics(showNotice, { duration: '30D', aggregation: 'Daily' });
  const { data, busy, duration, setDuration, aggregation, setAggregation, selectedFacilities, setSelectedFacilities, load } = analytics;
  const [chartType, setChartType] = useState('Line');
  const [heatmapSelection, setHeatmapSelection] = useState<HeatmapSelection>(null);
  const [fullscreenView, setFullscreenView] = useState<'chart' | 'heatmap' | null>(null);
  const chartSeries = useMemo(() => {
    if (!data?.lineSeries) return [];
    if (!heatmapSelection) return data.lineSeries;
    return data.lineSeries.filter((point) => String(point.date) === heatmapSelection.date);
  }, [data, heatmapSelection]);
  const chartFacilities = heatmapSelection ? [heatmapSelection.facility] : selectedFacilities;
  const focusedBarSeries = useMemo(() => {
    if (!data) return [];
    if (!heatmapSelection || !chartSeries[0]) return data.barSeries;
    return [{
      period: heatmapSelection.date,
      facility: heatmapSelection.facility,
      total: Number(chartSeries[0][heatmapSelection.facility] || 0)
    }];
  }, [data, heatmapSelection, chartSeries]);
  const focusedPieSeries = useMemo(() => {
    if (!data) return [];
    if (!heatmapSelection || !chartSeries[0]) return data.pieSeries;
    return [{
      facility: heatmapSelection.facility,
      total: Number(chartSeries[0][heatmapSelection.facility] || 0),
      percent: 100
    }];
  }, [data, heatmapSelection, chartSeries]);
  const setFacilities = (facilities: string[]) => {
    setHeatmapSelection(null);
    setSelectedFacilities(facilities);
  };
  const selectHeatmapCell = (selection: Exclude<HeatmapSelection, null>) => {
    setHeatmapSelection(selection);
    setSelectedFacilities([selection.facility]);
  };
  const lineData = useChartWindow(chartSeries, `${duration}-${heatmapSelection?.date || 'all'}`);
  const renderControls = () => data ? (
    <>
      <FacilityFilters
        data={data}
        duration={duration}
        setDuration={setDuration}
        aggregation={aggregation}
        setAggregation={setAggregation}
        selectedFacilities={selectedFacilities}
        setSelectedFacilities={setFacilities}
      />
      {heatmapSelection && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-sm font-bold text-slate-700">
            Focused on <span className="text-slate-950">{heatmapSelection.facility}</span> for <span className="text-slate-950">{formatShortDate(heatmapSelection.date)}</span>
          </div>
          <button className="button button-subtle" onClick={() => { setHeatmapSelection(null); setSelectedFacilities([]); }}>Clear focus</button>
        </div>
      )}
      <div className="card flex flex-col gap-3 p-3.5 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Chart view</div>
          <p className="mt-1 hidden text-sm font-semibold text-slate-500 sm:block">Switch between trend, facility ranking, and volume share.</p>
        </div>
        <Segmented value={chartType} options={chartTypeOptions} onChange={setChartType} />
      </div>
    </>
  ) : null;
  return (
    <PageStack>
      <PhaseHeader
        title="Facility Operations"
        subtitle="Live facility volume, trends, and performance movement."
        meta={data ? `${number(data.recordCount)} facility records` : 'Preparing analytics'}
        action={<button className="button button-primary" onClick={load} disabled={busy}>{busy ? 'Refreshing...' : 'Refresh'}</button>}
      />
      {busy && !data ? <DashboardSkeleton /> : data ? (
        <>
          <div className="facility-mobile-layout">
            <FacilityKpis data={data} />
            {renderControls()}
            <FacilityChartView
              chartType={chartType}
              lineData={lineData}
              facilities={chartFacilities}
              allFacilities={data.facilities}
              barSeries={focusedBarSeries}
              pieSeries={focusedPieSeries}
              onExpand={() => setFullscreenView('chart')}
            />
            <FacilityHeatmap data={data} selected={heatmapSelection} onSelect={selectHeatmapCell} onExpand={() => setFullscreenView('heatmap')} />
            <div className="max-h-[360px] overflow-auto rounded-xl">
              <DataTable
                title="Facility Ranking"
                rows={data.facilityTotals}
                columns={['facility', 'total']}
                emptyText="No facility totals yet."
              />
            </div>
          </div>
          <div className="facility-desktop-layout">
            <FacilityKpis data={data} />
            {renderControls()}
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.85fr)_minmax(360px,1fr)] 2xl:grid-cols-[minmax(0,2.1fr)_minmax(420px,1fr)]">
              <div className="min-w-0">
                <FacilityChartView
                  chartType={chartType}
                  lineData={lineData}
                  facilities={chartFacilities}
                  allFacilities={data.facilities}
                  barSeries={focusedBarSeries}
                  pieSeries={focusedPieSeries}
                  onExpand={() => setFullscreenView('chart')}
                />
              </div>
              <FacilityHeatmap data={data} selected={heatmapSelection} onSelect={selectHeatmapCell} onExpand={() => setFullscreenView('heatmap')} />
            </div>
            <div className="max-h-[330px] overflow-auto rounded-xl">
              <DataTable
                title="Facility Ranking"
                rows={data.facilityTotals}
                columns={['facility', 'total']}
                emptyText="No facility totals yet."
              />
            </div>
          </div>
          <FullscreenModal
            open={Boolean(fullscreenView)}
            title={fullscreenView === 'heatmap' ? 'Facility Heatmap' : `${chartType} Chart`}
            onClose={() => setFullscreenView(null)}
          >
            <div className="grid h-full min-h-0 gap-3">
              {renderControls()}
              {fullscreenView === 'heatmap' ? (
                <FacilityHeatmap data={data} selected={heatmapSelection} onSelect={selectHeatmapCell} fullscreen />
              ) : (
                <FacilityChartView
                  chartType={chartType}
                  lineData={lineData}
                  facilities={chartFacilities}
                  allFacilities={data.facilities}
                  barSeries={focusedBarSeries}
                  pieSeries={focusedPieSeries}
                  fullscreen
                />
              )}
            </div>
          </FullscreenModal>
        </>
      ) : <SessionAwareEmptyState text="No facility data found. Check connection or adjust filters." actionLabel="Refresh" onAction={load} />}
    </PageStack>
  );
}

function FacilityChartView({ chartType, lineData, facilities, allFacilities, barSeries, pieSeries, fullscreen = false, onExpand }: {
  chartType: string;
  lineData: ReturnType<typeof useChartWindow>;
  facilities: string[];
  allFacilities: string[];
  barSeries: FacilityAnalytics['barSeries'];
  pieSeries: FacilityAnalytics['pieSeries'];
  fullscreen?: boolean;
  onExpand?: () => void;
}) {
  return (
    <>
      {chartType === 'Line' && (
        <FacilityLineChart
          title="Facility Trend Comparison"
          data={lineData}
          facilities={facilities}
          allFacilities={allFacilities}
          compareMode
          fullscreen={fullscreen}
          onExpand={onExpand}
        />
      )}
      {chartType === 'Bar' && <FacilityBarChart data={barSeries} fullscreen={fullscreen} onExpand={onExpand} />}
      {chartType === 'Pie' && <FacilityPieChart data={pieSeries} fullscreen={fullscreen} onExpand={onExpand} />}
    </>
  );
}

function FullscreenModal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fullscreen-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="fullscreen-panel">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-base font-black text-slate-950">{title}</div>
            <div className="hidden text-xs font-bold uppercase tracking-[0.12em] text-slate-500 sm:block">Fullscreen operations view</div>
          </div>
          <button className="fullscreen-close" onClick={onClose} aria-label="Close fullscreen">Close</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function SessionAwareEmptyState({ text, actionLabel, onAction }: { text: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <EmptyState
      text={text}
      actionLabel={actionLabel}
      onAction={onAction}
    />
  );
}

function ExecutiveSummaryPage({ showNotice }: { showNotice: (type: NoticeType, text: string) => void }) {
  const { data, busy, duration, setDuration, load } = useFacilityAnalytics(showNotice, { duration: '30D' });
  const trendDirection = data ? data.kpis.delta > 0 ? 'Improving' : data.kpis.delta < 0 ? 'Softening' : 'Stable' : 'Pending';
  const riskText = data?.kpis.delta && data.kpis.delta < 0
    ? 'Volume is below the previous operating day.'
    : data?.kpis.worstFacility?.facility
      ? `${data.kpis.worstFacility.facility} needs routine attention.`
      : 'No material attention item found.';
  const suggestedAction = data?.kpis.delta && data.kpis.delta < 0
    ? 'Review staffing, sort flow, and facility exceptions before the next shift.'
    : 'Maintain current facility pace and monitor the lowest-volume stream.';
  return (
    <PageStack>
      <PhaseHeader
        title="Executive Summary"
        subtitle="Leadership view of performance, peaks, and facility movement."
        meta={data?.generatedAt ? `Updated ${formatShortDate(data.generatedAt)}` : 'Executive view'}
        action={<button className="button button-primary" onClick={load} disabled={busy}>{busy ? 'Refreshing...' : 'Refresh'}</button>}
      />
      <Segmented value={duration} options={durationOptions} onChange={setDuration} />
      {busy && !data ? <DashboardSkeleton /> : data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <InsightCard label="Strongest Facility" value={data.kpis.bestFacility?.facility || 'N/A'} detail={data.kpis.bestFacility ? `${number(data.kpis.bestFacility.total)} packages` : 'No leader yet'} />
            <InsightCard label="Lowest Facility" value={data.kpis.worstFacility?.facility || 'N/A'} detail={data.kpis.worstFacility ? `${number(data.kpis.worstFacility.total)} packages` : 'No low point yet'} tone="amber" />
            <InsightCard label="Highest Volume Day" value={data.kpis.peakDay ? formatShortDate(data.kpis.peakDay.date) : 'N/A'} detail={data.kpis.peakDay ? `${number(data.kpis.peakDay.total)} packages` : 'No peak day yet'} />
            <InsightCard label="Trend Direction" value={trendDirection} detail={`${signedNumber(data.kpis.delta)} latest movement`} tone={data.kpis.delta < 0 ? 'red' : 'teal'} />
            <InsightCard label="Attention Needed" value={data.kpis.delta < 0 ? 'Watch' : 'Normal'} detail={riskText} tone={data.kpis.delta < 0 ? 'red' : 'slate'} />
            <InsightCard label="Suggested Action" value="Next step" detail={suggestedAction} tone="slate" />
          </div>
          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel title="Leadership Notes">
              <div className="grid gap-3">
                {data.summary.map((item) => <div key={item} className="rounded-xl bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">{item}</div>)}
              </div>
            </Panel>
            <FacilityBarChart data={data.barSeries} />
          </div>
          <DataTable title="Peak Days" rows={data.peakDays} columns={['date', 'total']} emptyText="No peak days yet." />
        </>
      ) : <EmptyState text="No facility data found. Check connection or adjust filters." actionLabel="Refresh" onAction={load} />}
    </PageStack>
  );
}

function useChartWindow(points: Array<Record<string, string | number>>, duration: string) {
  const [windowSize, setWindowSize] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    setWindowSize(0);
    setOffset(0);
  }, [duration, points.length]);
  const visibleSize = windowSize || points.length;
  const maxOffset = Math.max(0, points.length - visibleSize);
  const safeOffset = Math.min(offset, maxOffset);
  const visible = points.slice(safeOffset, safeOffset + visibleSize);
  return {
    points: visible,
    total: points.length,
    zoomIn: () => setWindowSize((size) => Math.max(4, Math.floor((size || points.length) * 0.7))),
    zoomOut: () => setWindowSize((size) => Math.min(points.length, Math.ceil((size || points.length) * 1.35))),
    panLeft: () => setOffset((value) => Math.max(0, value - Math.max(1, Math.floor(visibleSize / 3)))),
    panRight: () => setOffset((value) => Math.min(maxOffset, value + Math.max(1, Math.floor(visibleSize / 3)))),
    reset: () => { setWindowSize(0); setOffset(0); },
    isWindowed: visibleSize < points.length || safeOffset > 0
  };
}

function PhaseHeader({ meta, action }: { title: string; subtitle: string; meta?: string; action?: ReactNode }) {
  if (!meta && !action) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-stone-200/80 bg-white/85 px-4 py-3 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        {meta && <StatusPill text={meta} />}
        {action}
      </div>
    </div>
  );
}

function FacilityKpis({ data }: { data: FacilityAnalytics }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      <Kpi label="Total Packages" value={number(data.kpis.totalPackages)} icon="data" tone="teal" />
      <Kpi label="Active Facilities" value={number(data.kpis.activeFacilities)} helper={`${number(data.facilities.length)} tracked`} icon="grid" />
      <Kpi label="Top Facility" value={data.kpis.bestFacility?.facility || 'N/A'} helper={data.kpis.bestFacility ? `${number(data.kpis.bestFacility.total)} packages` : undefined} icon="report" />
      <Kpi label="Lowest Facility" value={data.kpis.worstFacility?.facility || 'N/A'} helper={data.kpis.worstFacility ? `${number(data.kpis.worstFacility.total)} packages` : undefined} icon="activity" tone="amber" />
      <Kpi label="Peak Day" value={data.kpis.peakDay ? formatShortDate(data.kpis.peakDay.date) : 'N/A'} helper={data.kpis.peakDay ? `${number(data.kpis.peakDay.total)} packages` : undefined} icon="activity" />
      <Kpi label="30-Day Average" value={number(data.kpis.rollingAverage)} helper="Rolling pace" icon="data" tone="teal" />
    </div>
  );
}

function FacilityFilters({ data, duration, setDuration, aggregation, setAggregation, selectedFacilities, setSelectedFacilities, compact = false }: {
  data: FacilityAnalytics | null;
  duration: string;
  setDuration: (value: string) => void;
  aggregation?: string;
  setAggregation?: (value: string) => void;
  selectedFacilities: string[];
  setSelectedFacilities: (value: string[]) => void;
  compact?: boolean;
}) {
  const [facilitySearch, setFacilitySearch] = useState('');
  const [facilityMenuOpen, setFacilityMenuOpen] = useState(false);
  const facilities = data?.facilities || [];
  const filteredFacilities = facilities
    .filter((facility) => facility.toLowerCase().includes(facilitySearch.trim().toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  const selectedCount = selectedFacilities.length;
  const dropdownLabel = selectedCount ? `${selectedCount} selected` : 'All Facilities';
  const toggleFacility = (facility: string) => {
    setSelectedFacilities(selectedFacilities.includes(facility)
      ? selectedFacilities.filter((item) => item !== facility)
      : [...selectedFacilities, facility]);
  };
  return (
    <div className="card p-3.5 lg:p-4">
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-xs font-black uppercase tracking-[0.08em] text-slate-500 sm:tracking-[0.16em]">Range</span>
            <div className="overflow-x-auto pb-1">
              <Segmented value={duration} options={durationOptions} onChange={setDuration} />
            </div>
          </div>
          {aggregation && setAggregation && (
            <div className="flex min-w-0 flex-col gap-2 xl:items-end">
              <span className="text-xs font-black uppercase tracking-[0.08em] text-slate-500 sm:tracking-[0.16em]"><span className="sm:hidden">View</span><span className="hidden sm:inline">Aggregation</span></span>
              <div className="overflow-x-auto pb-1">
                <Segmented value={aggregation} options={aggregationOptions} onChange={setAggregation} />
              </div>
            </div>
          )}
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] lg:items-start">
          <div className="relative">
            <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.08em] text-slate-500 sm:tracking-[0.16em]"><span className="sm:hidden">Site</span><span className="hidden sm:inline">Facilities</span></span>
            <button
              className="facility-select-button"
              type="button"
              onClick={() => setFacilityMenuOpen((value) => !value)}
              disabled={!facilities.length}
            >
              <span>{dropdownLabel}</span>
              <span className="facility-count-badge">{selectedCount || facilities.length}</span>
            </button>
            {facilityMenuOpen && (
              <div className="facility-menu">
                <div className="flex items-center justify-between gap-2 border-b border-stone-200 p-3">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Choose facilities</div>
                  <button className="text-xs font-black text-slate-500 hover:text-slate-950" type="button" onClick={() => setFacilityMenuOpen(false)}>Close</button>
                </div>
                <div className="grid gap-2 p-3">
                  <input className="input" value={facilitySearch} onChange={(event) => setFacilitySearch(event.target.value)} placeholder="Search eBay, SLC/BUF, ASUK..." />
                  <div className="flex flex-wrap gap-2">
                    <button className="button button-subtle px-3 py-1.5 text-xs" type="button" onClick={() => setSelectedFacilities([])}>Select All</button>
                    <button className="button button-subtle px-3 py-1.5 text-xs" type="button" onClick={() => setSelectedFacilities([])}>Clear</button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto px-2 pb-2">
                  {filteredFacilities.map((facility) => (
                    <button key={facility} className="facility-option" type="button" onClick={() => toggleFacility(facility)}>
                      <input readOnly type="checkbox" checked={!selectedFacilities.length || selectedFacilities.includes(facility)} />
                      <span className="truncate">{facility}</span>
                    </button>
                  ))}
                  {!filteredFacilities.length && <div className="px-3 py-5 text-center text-sm font-semibold text-slate-500">No matching facilities.</div>}
                </div>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.08em] text-slate-500 sm:tracking-[0.16em]">Selected</span>
            <div className="selected-facility-row">
              {!selectedFacilities.length ? (
                <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-500">All facilities included</span>
              ) : selectedFacilities.map((facility) => (
                <button key={facility} className="selected-facility-chip" type="button" onClick={() => toggleFacility(facility)} title={`Remove ${facility}`}>
                  <span className="truncate">{facility}</span>
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FacilityLineChart({ title, data, facilities, allFacilities, compareMode = false, fullscreen = false, onExpand }: {
  title: string;
  data: ReturnType<typeof useChartWindow>;
  facilities: string[];
  allFacilities: string[];
  compareMode?: boolean;
  fullscreen?: boolean;
  onExpand?: () => void;
}) {
  const [dragStart, setDragStart] = useState<number | null>(null);
  const lineKeys = compareMode
    ? (facilities.length ? facilities : allFacilities.slice(0, 4))
    : ['total', 'rollingAverage'];
  const finishDrag = (clientX: number) => {
    if (dragStart === null) return;
    const distance = clientX - dragStart;
    if (Math.abs(distance) > 36) {
      if (distance > 0) data.panLeft();
      else data.panRight();
    }
    setDragStart(null);
  };
  return (
    <div className="card p-5 lg:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="font-black uppercase tracking-[0.12em] text-slate-950">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">Explore pace, movement, and rolling trend across the selected window.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onExpand && <button className="expand-button" onClick={onExpand} title="Expand chart">Expand</button>}
          <div className="chart-toolbar" aria-label="Chart controls">
            <button className="chart-toolbar-button" onClick={data.zoomIn} title="Zoom in">+</button>
            <button className="chart-toolbar-button" onClick={data.zoomOut} title="Zoom out">-</button>
            <button className="chart-toolbar-button" onClick={data.panLeft} title="Pan left">←</button>
            <button className="chart-toolbar-button" onClick={data.panRight} title="Pan right">→</button>
            <button className="chart-toolbar-button min-w-16 px-3" onClick={data.reset} title="Reset zoom">Reset</button>
          </div>
        </div>
      </div>
      <div
        className={`mt-4 cursor-grab select-none active:cursor-grabbing ${fullscreen ? 'h-[calc(100vh-265px)] min-h-[420px]' : 'h-[46vh] min-h-[300px] max-h-[560px] max-sm:h-[320px]'}`}
        onDoubleClick={data.reset}
        onMouseDown={(event) => setDragStart(event.clientX)}
        onMouseLeave={() => setDragStart(null)}
        onMouseUp={(event) => finishDrag(event.clientX)}
        onWheel={(event) => {
          if (!data.points.length) return;
          event.preventDefault();
          if (event.deltaY < 0) data.zoomIn();
          else data.zoomOut();
        }}
        title="Mouse wheel zooms. Drag left or right to pan. Double-click resets."
      >
        {data.points.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.points} margin={{ top: 20, right: 30, bottom: 14, left: 4 }}>
              <CartesianGrid stroke="#e9e3d8" strokeDasharray="4 6" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 12, fontWeight: 800 }} tickMargin={12} />
              <YAxis tick={{ fill: '#475569', fontSize: 12, fontWeight: 800 }} tickFormatter={(value) => compactNumber(value)} width={56} />
              <Tooltip content={<FacilityTooltip />} />
              <Legend />
              {lineKeys.map((key, index) => (
                <Line
                  key={key}
                  name={key === 'total' ? 'Total Packages' : key === 'rollingAverage' ? 'Rolling Average' : key}
                  type="monotone"
                  dataKey={key}
                  stroke={chartColors[index % chartColors.length]}
                  strokeWidth={key === 'rollingAverage' ? 2.2 : 2.8}
                  strokeDasharray={key === 'rollingAverage' ? '6 6' : undefined}
                  dot={data.points.length < 45 ? { r: 3 } : false}
                  activeDot={{ r: 5.5, strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : <EmptyState text="No facility data found. Check connection or adjust filters." />}
      </div>
    </div>
  );
}

function FacilityTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: unknown; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-stone-200 bg-white/95 p-3 text-sm shadow-[0_18px_55px_rgba(17,24,39,0.16)] backdrop-blur">
      <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">Date {label}</div>
      <div className="grid gap-1.5">
        {payload.map((item) => (
          <div key={`${item.name}-${item.value}`} className="flex items-center justify-between gap-6">
            <span className="flex min-w-0 items-center gap-2 font-bold text-slate-700">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color || '#17324d' }} />
              <span className="truncate">{human(String(item.name || 'Facility'))}</span>
            </span>
            <span className="font-black text-slate-950">{number(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FacilityBarChart({ data, fullscreen = false, onExpand }: { data: FacilityAnalytics['barSeries']; fullscreen?: boolean; onExpand?: () => void }) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-black uppercase tracking-[0.12em] text-slate-950">Facility Totals</h3>
          <p className="mt-1 text-sm text-slate-500">Sorted high to low for the selected period.</p>
        </div>
        {onExpand && <button className="expand-button" onClick={onExpand} title="Expand chart">Expand</button>}
      </div>
      <div className={`mt-5 ${fullscreen ? 'h-[calc(100vh-265px)] min-h-[420px]' : 'h-[42vh] min-h-[300px] max-h-[460px]'}`}>
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 18, right: 20, left: 0, bottom: 50 }}>
              <CartesianGrid stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="facility" interval={0} angle={-25} textAnchor="end" tick={{ fill: '#475569', fontSize: 11, fontWeight: 700 }} />
              <YAxis tick={{ fill: '#475569', fontSize: 12, fontWeight: 700 }} />
              <Tooltip formatter={(value) => [number(value), 'Packages']} />
              <Bar dataKey="total" radius={[10, 10, 0, 0]} fill="#17324d" />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState text="No facility totals yet." />}
      </div>
    </div>
  );
}

function FacilityPieChart({ data, fullscreen = false, onExpand }: { data: FacilityAnalytics['pieSeries']; fullscreen?: boolean; onExpand?: () => void }) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-black uppercase tracking-[0.12em] text-slate-950">Facility Share</h3>
          <p className="mt-1 text-sm text-slate-500">Share of total packages by facility.</p>
        </div>
        {onExpand && <button className="expand-button" onClick={onExpand} title="Expand chart">Expand</button>}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className={`mx-auto w-full max-w-[720px] ${fullscreen ? 'h-[calc(100vh-300px)] min-h-[420px]' : 'h-[42vh] min-h-[320px] max-h-[520px]'}`}>
          {data.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="total" nameKey="facility" innerRadius="52%" outerRadius="82%" paddingAngle={2}>
                  {data.map((entry, index) => <Cell key={entry.facility} fill={chartColors[index % chartColors.length]} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [number(value), String(name)]} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyState text="No share data yet." />}
        </div>
        <div className="grid content-center gap-2">
          {data.map((row, index) => (
            <div key={row.facility} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-bold text-slate-700"><span className="h-2.5 w-2.5 rounded-full" style={{ background: chartColors[index % chartColors.length] }} /> <span className="truncate">{row.facility}</span></span>
              <span className="shrink-0 font-black text-slate-950">{row.percent}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FacilityHeatmap({ data, selected, onSelect, fullscreen = false, onExpand }: { data: FacilityAnalytics; selected: HeatmapSelection; onSelect: (selection: Exclude<HeatmapSelection, null>) => void; fullscreen?: boolean; onExpand?: () => void }) {
  const facilities = data.facilities || [];
  const rows = (data.lineSeries || []).map((point) => {
    const values = facilities.map((facility) => ({ facility, count: Number(point[facility] || 0) }));
    return {
      date: String(point.date),
      total: values.reduce((sum, item) => sum + item.count, 0),
      values
    };
  });
  const facilityTotals = facilities.map((facility) => ({
    facility,
    total: rows.reduce((sum, row) => sum + Number(row.values.find((item) => item.facility === facility)?.count || 0), 0)
  }));
  const rankMap = new Map(
    [...facilityTotals]
      .sort((a, b) => b.total - a.total)
      .map((row, index) => [row.facility, index + 1])
  );
  const totalVolume = rows.reduce((sum, row) => sum + row.total, 0);
  const max = Math.max(...rows.flatMap((day) => day.values.map((item) => item.count)), 1);
  const gridTemplateColumns = `112px repeat(${Math.max(facilities.length, 1)}, minmax(86px, 1fr))`;
  return (
    <div className="card min-w-0 p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-black uppercase tracking-[0.12em] text-slate-950">Facility Heatmap</h3>
          <p className="mt-1 text-sm text-slate-500">Volume intensity by facility and day. Click a cell to focus the charts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="heatmap-legend" aria-label="Facility ranking color legend">
            <span>Lightest</span>
            <span className="heatmap-legend-ramp" />
            <span>Darkest</span>
          </div>
          {onExpand && <button className="expand-button" onClick={onExpand} title="Expand heatmap">Expand</button>}
        </div>
      </div>
      {rows.length && facilities.length ? (
        <div className={`heatmap-scroll mt-4 ${fullscreen ? 'heatmap-scroll-fullscreen' : ''}`}>
          <div className="heatmap-grid" style={{ gridTemplateColumns }}>
            <div className="heatmap-header heatmap-sticky-left">Date</div>
            {facilities.map((facility) => (
              <div key={facility} className="heatmap-header" title={facility}>{facility}</div>
            ))}
            {rows.map((day) => (
              <div key={day.date} className="contents">
                <div className="heatmap-date-cell heatmap-sticky-left">{formatShortDate(day.date)}</div>
                {day.values.map((item) => {
                  const opacity = item.count ? Math.min(0.92, 0.14 + (item.count / max) * 0.78) : 0.06;
                  const percentage = totalVolume ? (item.count / totalVolume) * 100 : 0;
                  const rank = rankMap.get(item.facility) || facilities.length;
                  const isSelected = selected?.facility === item.facility && selected.date === day.date;
                  return (
                    <button
                      key={`${day.date}-${item.facility}`}
                      className={`heatmap-cell ${isSelected ? 'heatmap-cell-active' : ''}`}
                      title={`Facility: ${item.facility}\nDate: ${formatShortDate(day.date)}\nPackage Count: ${number(item.count)}\nPercentage of total volume: ${formatPercent(percentage)}\nFacility rank: #${rank}`}
                      style={{ background: `rgba(23, 50, 77, ${opacity})`, color: opacity > 0.42 ? '#ffffff' : '#172033' }}
                      type="button"
                      onClick={() => onSelect({ facility: item.facility, date: day.date })}
                    >
                      {item.count ? compactNumber(item.count) : '-'}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="heatmap-total-label heatmap-sticky-left">Total</div>
            {facilityTotals.map((item) => (
              <div key={`total-${item.facility}`} className="heatmap-total-cell" title={`${item.facility} total: ${number(item.total)}`}>
                {compactNumber(item.total)}
              </div>
            ))}
          </div>
        </div>
      ) : <EmptyState text="No facility data found. Check connection or adjust filters." />}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => <div key={index} className="skeleton-card" />)}
      </div>
      <div className="skeleton-panel" />
    </div>
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

function UsersPage({ currentUser, showNotice }: { currentUser: User; showNotice: (type: NoticeType, text: string) => void }) {
  const [data, setData] = useState<any>({ users: [], roles: [], sections: [] });
  const [form, setForm] = useState<any>({ username: '', displayName: '', password: '', role: 'User', active: true, permissions: ['dashboard', 'security'] });
  const load = async () => setData(await api('/users'));
  useEffect(() => { load().catch((error) => showNotice('error', error.message)); }, []);
  const create = async () => {
    try {
      await postJson('/users', form);
      showNotice('success', 'User created.');
      setForm({ username: '', displayName: '', password: '', role: 'User', active: true, permissions: ['dashboard', 'security'] });
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
  const adminSecurityAction = async (path: string, message: string) => {
    try {
      await postJson(path, {});
      showNotice('success', message);
      load();
    } catch (error: any) {
      showNotice('error', error.message);
    }
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
      {currentUser.role === 'Admin' && (
        <DataTable
          title="Admin User Security"
          rows={data.users}
          columns={['username', 'role', 'twoFactorEnabled', 'failedLoginCount', 'lockedUntil', 'lastLogin']}
          emptyText="No users found."
          actions={(row) => (
            <div className="flex flex-wrap gap-2">
              <button className="button button-subtle" onClick={() => adminSecurityAction(`/users/${row.id}/unlock`, 'User unlocked.')}>Unlock</button>
              <button className="button button-subtle" onClick={() => adminSecurityAction(`/users/${row.id}/reset-2fa`, 'Two-factor setup reset.')}>Reset 2FA</button>
              <button className="button button-subtle" onClick={() => adminSecurityAction(`/users/${row.id}/revoke-sessions`, 'User sessions revoked.')}>Logout Devices</button>
            </div>
          )}
        />
      )}
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
  const navigate = useNavigate();
  const [logs, setLogs] = useState<any[]>([]);
  const [uploads, setUploads] = useState<any[]>([]);
  const [exportsLog, setExportsLog] = useState<any[]>([]);
  const [printLogs, setPrintLogs] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const audit = await api<{ rows: any[] }>('/logs/audit');
      const [uploadRows, exportRows, printRows] = await Promise.all([
        api<{ rows: any[] }>('/logs/uploads'),
        api<{ rows: any[] }>('/logs/exports'),
        api<{ rows: any[] }>('/labels/logs').catch(() => ({ rows: [] }))
      ]);
      setLogs(audit.rows || []);
      setUploads(uploadRows.rows || []);
      setExportsLog(exportRows.rows || []);
      setPrintLogs(printRows.rows || []);
    } catch (activityError: any) {
      if (activityError.status === 401) {
        setError('Please sign in again.');
      } else {
        setError(activityError.message || 'Activity could not be loaded.');
      }
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  if (busy) {
    return (
      <PageStack>
        <PageHeader title="Activity Logs" subtitle="Review system activity and print history." />
        <EmptyState text="Loading activity..." />
      </PageStack>
    );
  }

  if (error) {
    return (
      <PageStack>
        <PageHeader title="Activity Logs" subtitle="Review system activity and print history." />
        <EmptyState
          text={error}
          actionLabel={error === 'Please sign in again.' ? 'Go to login' : 'Refresh'}
          onAction={error === 'Please sign in again.' ? () => navigate('/login') : load}
        />
      </PageStack>
    );
  }

  return (
    <PageStack>
      <PageHeader title="Activity Logs" subtitle="Review system activity and print history." />
      <DataTable title="Team Activity" rows={logs} columns={['createdAt', 'actor', 'action', 'entity']} emptyText="No activity recorded yet." />
      <DataTable title="Print History" rows={printLogs} columns={['timestamp', 'trackingNumber', 'action', 'status', 'printerName', 'errorMessage']} emptyText="No print history yet." />
      <DataTable title="Import History" rows={uploads} columns={['createdAt', 'fileName', 'status', 'uploadedBy']} emptyText="No import history yet." />
      <DataTable title="Export History" rows={exportsLog} columns={['createdAt', 'format', 'rowCount', 'requestedBy']} emptyText="No export history yet." />
    </PageStack>
  );
}

function SecurityPage({ user, showNotice }: { user: User; showNotice: (type: NoticeType, text: string) => void }) {
  const [profile, setProfile] = useState<any>({ sessions: [] });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [setup, setSetup] = useState<any>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const load = async () => setProfile(await api('/auth/security'));
  useEffect(() => { load().catch((error) => showNotice('error', error.message)); }, []);

  const changePasswordAction = async () => {
    try {
      const response = await postJson<{ message: string }>('/auth/change-password', passwordForm);
      showNotice('success', response.message);
      setPasswordForm({ currentPassword: '', newPassword: '' });
      load();
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };

  const startSetup = async () => {
    try {
      setSetup(await postJson('/auth/2fa/setup', {}));
      setRecoveryCodes([]);
      showNotice('info', 'Add this account in your authenticator app, then verify the code.');
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };

  const enable = async () => {
    try {
      const response = await postJson<{ message: string; recoveryCodes: string[] }>('/auth/2fa/enable', { code: twoFactorCode });
      setRecoveryCodes(response.recoveryCodes || []);
      setSetup(null);
      setTwoFactorCode('');
      showNotice('success', response.message);
      load();
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };

  const disable = async () => {
    try {
      const response = await postJson<{ message: string }>('/auth/2fa/disable', { code: disableCode });
      setDisableCode('');
      setRecoveryCodes([]);
      showNotice('success', response.message);
      load();
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };

  const revokeSession = async (sessionId: string) => {
    try {
      await api(`/auth/sessions/${sessionId}`, { method: 'DELETE' });
      showNotice('success', 'Session revoked.');
      load();
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };

  const logoutAll = async () => {
    try {
      const response = await postJson<{ revoked: number }>('/auth/logout-all', {});
      showNotice('success', `${response.revoked} other session${response.revoked === 1 ? '' : 's'} signed out.`);
      load();
    } catch (error: any) {
      showNotice('error', error.message);
    }
  };

  return (
    <PageStack>
      <PageHeader title="My Security" subtitle="Manage password, two-factor authentication, and active sessions." />
      <div className="grid gap-4 md:grid-cols-3">
        <MiniStatus label="Role" value={user.role} />
        <MiniStatus label="Two-factor" value={profile.twoFactorEnabled ? 'Enabled' : 'Not enabled'} />
        <MiniStatus label="Recovery codes" value={`${profile.recoveryCodesRemaining || 0} remaining`} />
      </div>
      <FormCard title="Change Password">
        <FormGrid cols="grid-cols-1 md:grid-cols-2">
          <TextInput label="Current Password" type="password" value={passwordForm.currentPassword} onChange={(currentPassword) => setPasswordForm({ ...passwordForm, currentPassword })} />
          <TextInput label="New Password" type="password" value={passwordForm.newPassword} onChange={(newPassword) => setPasswordForm({ ...passwordForm, newPassword })} />
        </FormGrid>
        <button className="button button-primary mt-4" onClick={changePasswordAction} disabled={!passwordForm.currentPassword || passwordForm.newPassword.length < 8}>Change Password</button>
      </FormCard>
      <Panel title="Enable 2FA">
        <p className="text-sm font-semibold text-slate-600">Use an authenticator app to add a second verification step at login.</p>
        {!profile.twoFactorEnabled && !setup && <button className="button button-primary mt-4" onClick={startSetup}>Start 2FA Setup</button>}
        {setup && (
          <div className="mt-4 grid gap-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Manual setup key</div>
              <div className="mt-2 break-all font-mono text-sm font-bold text-slate-900">{setup.secret}</div>
              <div className="mt-3 text-xs font-semibold text-slate-500">Authenticator URI</div>
              <div className="mt-1 break-all font-mono text-xs text-slate-600">{setup.otpauthUrl}</div>
            </div>
            <FormGrid cols="grid-cols-1 md:grid-cols-[1fr_auto]">
              <TextInput label="Authenticator Code" value={twoFactorCode} onChange={setTwoFactorCode} />
              <button className="button button-primary self-end" onClick={enable} disabled={twoFactorCode.length < 6}>Enable 2FA</button>
            </FormGrid>
          </div>
        )}
        {profile.twoFactorEnabled && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="font-bold text-emerald-800">Two-factor authentication is enabled.</div>
            <FormGrid cols="mt-4 grid-cols-1 md:grid-cols-[1fr_auto]">
              <TextInput label="Authenticator Code" value={disableCode} onChange={setDisableCode} />
              <button className="button self-end" onClick={disable} disabled={disableCode.length < 6}>Disable 2FA</button>
            </FormGrid>
          </div>
        )}
        {recoveryCodes.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="font-black text-amber-900">Save these recovery codes now. They will not be shown again.</div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {recoveryCodes.map((code) => <div key={code} className="rounded-lg bg-white px-3 py-2 font-mono text-sm font-bold text-slate-900">{code}</div>)}
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Active Sessions">
        <div className="mb-4 flex justify-end">
          <button className="button" onClick={logoutAll}>Logout From All Other Devices</button>
        </div>
        <DataTable
          title="Devices"
          rows={profile.sessions || []}
          columns={['createdAt', 'lastSeenAt', 'ip', 'device']}
          emptyText="No active sessions found."
          actions={(row) => <button className="button button-subtle" disabled={row.id === profile.currentSessionId} onClick={() => revokeSession(row.id)}>{row.id === profile.currentSessionId ? 'Current' : 'Revoke'}</button>}
        />
      </Panel>
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
  return <div className="grid w-full min-w-0 gap-4 lg:gap-5">{children}</div>;
}

function PageHeader({ action }: { title: string; subtitle: string; action?: ReactNode }) {
  return action ? <div className="flex justify-end">{action}</div> : null;
}

function Kpi({ label, value, helper, tone = 'slate', icon }: { label: string; value: string; helper?: string; tone?: 'slate' | 'teal' | 'amber' | 'red'; icon?: IconName }) {
  const accent = tone === 'teal' ? 'bg-cyan-50 text-broad-teal' : tone === 'amber' ? 'bg-amber-50 text-amber-700' : tone === 'red' ? 'bg-red-50 text-red-700' : 'bg-stone-100 text-slate-700';
  return (
    <div className="card p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_55px_rgba(46,38,26,0.1)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
          <div className="mt-2 truncate text-2xl font-black text-slate-950 2xl:text-3xl">{value}</div>
        </div>
        {icon && <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${accent}`}><NavIcon name={icon} /></div>}
      </div>
      {helper && <div className="mt-2 text-sm font-semibold text-slate-500">{helper}</div>}
    </div>
  );
}

function InsightCard({ label, value, detail, tone = 'slate' }: { label: string; value: string; detail: string; tone?: 'slate' | 'teal' | 'amber' | 'red' }) {
  const accent = tone === 'teal' ? 'border-broad-teal/25 bg-cyan-50 text-broad-teal' : tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-800' : tone === 'red' ? 'border-red-200 bg-red-50 text-red-800' : 'border-stone-200 bg-stone-50 text-slate-800';
  return (
    <div className="card overflow-hidden">
      <div className={`border-b px-5 py-4 ${accent}`}>
        <div className="text-xs font-black uppercase tracking-[0.16em] opacity-75">{label}</div>
        <div className="mt-2 text-2xl font-black tracking-tight">{value}</div>
      </div>
      <div className="px-5 py-4 text-sm font-semibold leading-6 text-slate-600">{detail}</div>
    </div>
  );
}

function MiniStatus({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</div><div className="mt-1 text-sm font-bold text-slate-950">{value}</div></div>;
}

function StatusPill({ text }: { text: string }) {
  return <span className="inline-flex items-center rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm">{text}</span>;
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
    <div className="inline-flex w-max overflow-hidden rounded-xl border border-stone-300 bg-stone-50 p-1 shadow-sm">
      {options.map((option) => (
        <button key={option} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold transition ${value === option ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-700 hover:bg-white hover:text-slate-950'}`} onClick={() => onChange(option)}>
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

function EmptyState({ text, actionLabel, onAction }: { text: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="grid min-h-36 place-items-center rounded-xl border border-stone-200 bg-gradient-to-br from-white to-stone-50 p-6 text-center shadow-sm">
      <div>
        <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-stone-100 text-slate-600">
          <NavIcon name="data" />
        </div>
        <p className="text-sm font-bold text-slate-600">{text}</p>
        {actionLabel && onAction && <button className="button button-subtle mt-4" onClick={onAction}>{actionLabel}</button>}
      </div>
    </div>
  );
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

function compactNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(parsed) : '0';
}

function signedNumber(value: unknown) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed === 0) return '0';
  return `${parsed > 0 ? '+' : '-'}${Math.abs(parsed).toLocaleString()}`;
}

function formatPercent(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? `${parsed.toFixed(parsed >= 10 ? 1 : 2)}%` : '0%';
}

function formatShortDate(value: string) {
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value || 'N/A';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: value.length > 10 ? undefined : 'numeric' }).format(date);
}

function friendlyOperationsError(message: string) {
  if (/server unavailable/i.test(message || '')) return 'Facility data is not connected yet.';
  if (/google|credential|sheet|drive/i.test(message || '')) return 'Live operations source is not connected yet.';
  return message || 'Facility analytics could not be loaded.';
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
