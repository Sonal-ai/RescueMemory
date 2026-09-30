import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  Activity,
  ChevronDown,
  CircleHelp,
  Cloud,
  CloudOff,
  Database,
  Menu,
  Moon,
  Radio,
  Settings2,
  ShieldCheck,
  Sun,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { api, saveSetting, setting, isOnlineMode, setOnlineMode, onOnlineModeChange } from './api';
import { useNodeStatus } from './hooks/useNodeStatus';
export { useNodeStatus };

export function SettingsPanel({ onClose }) {
  const [values, setValues] = useState({
    adminKey: setting('adminKey'),
    responderKey: setting('responderKey'),
    groupId: setting('groupId'),
    groupToken: setting('groupToken'),
    peerUrl: setting('peerUrl'),
    reporterId: setting('reporterId') || 'survivor-1',
  });

  const save = () => {
    Object.entries(values).forEach(([key, value]) => saveSetting(key, value));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="settings-dialog w-full max-w-xl bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-700/80 rounded-3xl p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-500/20">
              <Settings2 size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Node Configuration</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Local device & peer mesh parameters</p>
            </div>
          </div>
          <button
            aria-label="Close settings"
            onClick={onClose}
            className="icon-btn text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-xs text-slate-700 dark:text-slate-300 mb-6 bg-[#f0f5fa] dark:bg-slate-900/60 p-3 rounded-xl border border-[#dbe6f0] dark:border-slate-800 font-medium">
          🔒 Private credentials stay isolated in your local session. They are never published or leaked across nodes.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          {[
            ['reporterId', 'Survivor / Device Name', 'e.g. survivor-alpha'],
            ['peerUrl', 'Nearby Node Hotspot URL', 'http://192.168.43.12:8001'],
            ['groupId', 'Private Team Group ID', 'Optional team identifier'],
            ['groupToken', 'Private Group Token', 'Shared mesh passphrase'],
            ['adminKey', 'Node Admin Secret', 'For sync & verification'],
            ['responderKey', 'Medic / Responder Key', 'Unlocks responder scope'],
          ].map(([name, label, placeholder]) => (
            <label key={name} className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {label}
              <input
                className="field mt-1.5"
                type={name.toLowerCase().includes('key') || name === 'groupToken' ? 'password' : 'text'}
                placeholder={placeholder}
                value={values[name]}
                onChange={(event) => setValues({ ...values, [name]: event.target.value })}
              />
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-7 pt-4 border-t border-[#dbe6f0] dark:border-slate-800">
          <button
            type="button"
            className="text-xs font-mono text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
            onClick={() => {
              setValues({
                reporterId: 'survivor-1',
                peerUrl: 'http://127.0.0.1:8000',
                groupId: 'camp-alpha',
                groupToken: 'demo-mesh-shared-key',
                adminKey: 'demo-node-admin-key',
                responderKey: 'demo-responder-shared-key'
              });
            }}
          >
            ⚡ Fill Demo Keys (Prototype)
          </button>
          <div className="flex items-center gap-3">
            <button className="btn-secondary text-sm" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary text-sm px-6" onClick={save}>
              Save Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function QuietTelemetryPill({ health, sync, error }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-300 dark:border-emerald-500/30 bg-emerald-100/90 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-300 hover:bg-emerald-200/80 dark:hover:bg-emerald-950/60 text-xs font-bold transition-all active:scale-95 shadow-xs"
        title="Offline system status & peer telemetry"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-500"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600"></span>
        </span>
        <span className="hidden sm:inline font-bold">Offline Ready</span>
        <ChevronDown size={13} className={`opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-[#0b1626] border border-[#d8e3ec] dark:border-slate-700/80 rounded-2xl p-4 shadow-xl z-50 animate-in fade-in slide-in-from-top-2 text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-[#e2e8f0] dark:border-slate-800 mb-3">
            <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <ShieldCheck size={15} className="text-emerald-600 dark:text-emerald-400" />
              <span>Offline System Status</span>
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs font-bold p-1"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2 text-slate-700 dark:text-slate-300 font-mono text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Vector Engine:</span>
              <strong className="text-emerald-700 dark:text-emerald-400">{health?.engine || 'Local In-Memory Vector Engine'}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Node ID:</span>
              <span className="text-slate-800 dark:text-slate-200">{health?.node_id || 'survivor-1'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Indexed Protocols:</span>
              <span className="text-cyan-700 dark:text-cyan-300">{health?.guides || 420} survival records</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Mesh Auto-Discovery:</span>
              <span className="text-emerald-700 dark:text-emerald-300">Active (Wi-Fi Direct / BLE)</span>
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800 flex items-center justify-between text-[11px]">
            <Link
              to="/about"
              onClick={() => setOpen(false)}
              className="text-cyan-400 hover:underline font-bold"
            >
              System Architecture →
            </Link>
            {health?.role === 'central' && (
              <Link
                to="/command"
                onClick={() => setOpen(false)}
                className="text-amber-400 hover:underline font-bold"
              >
                Command HQ →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Shell({ title, subtitle, children }) {
  const { health, sync, error } = useNodeStatus();
  const last = sync?.last_sync || sync?.last_uplink;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('rescue.theme') || localStorage.getItem('theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [online, setOnline] = useState(() => isOnlineMode());

  useEffect(() => {
    return onOnlineModeChange(setOnline);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
    localStorage.setItem('rescue.theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <div className="app-shell min-h-screen bg-[#f0f5fa] dark:bg-[#080d19] text-slate-900 dark:text-slate-100 flex flex-col pb-16 sm:pb-0">
      {/* Top Tactical Navigation Header */}
      <header className="app-header border-b border-[#dbe6f0] dark:border-cyan-500/15 bg-white/95 dark:bg-[#0b1528]/95 sticky top-0 z-40 backdrop-blur-xl shadow-xs">
        <div className="h-0.5 w-full bg-gradient-to-r from-red-500 via-cyan-400 to-emerald-400 opacity-90" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          
          {/* Logo & Tactical Identity */}
          <Link to="/" className="flex items-center gap-2 font-black tracking-tight text-base sm:text-lg group shrink min-w-0">
            <span className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl bg-gradient-to-br from-red-500 via-rose-500 to-red-600 flex items-center justify-center text-white shadow-md shadow-red-500/25 group-hover:scale-105 transition-transform shrink-0">
              <Activity size={18} />
            </span>
            <span className="font-extrabold text-base sm:text-lg tracking-tight text-slate-900 dark:text-white truncate">
              RescueMemory
            </span>
          </Link>

          {/* Right Action Bar */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Quiet Status Pill */}
            <QuietTelemetryPill health={health} sync={sync} error={error} />

            {/* Simulated Internet / Cloud Sync Switch */}
            <button
              type="button"
              title={online ? 'Internet Connected (Cloud AI Gemini & Sync ON). Tap to switch to Disconnected Offline Mode' : 'Offline Disaster Mode (Local Edge Memory Only). Tap to enable Internet & Cloud AI'}
              aria-label={online ? 'Disconnect Internet (Enter Offline Mode)' : 'Connect Internet (Enable Cloud AI)'}
              aria-pressed={online}
              className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-all active:scale-95 ${
                online
                  ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30 hover:bg-emerald-200/60 dark:hover:bg-emerald-500/20'
                  : 'bg-amber-100 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 border-amber-300 dark:border-amber-500/30 hover:bg-amber-200/60 dark:hover:bg-amber-500/20'
              }`}
              onClick={() => setOnlineMode(!online)}
            >
              {online ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600"></span>
                  </span>
                  <Wifi size={13} className="text-emerald-600 dark:text-emerald-500" />
                  <span className="hidden md:inline">Online</span>
                </>
              ) : (
                <>
                  <span className="inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  <WifiOff size={13} className="text-amber-600 dark:text-amber-500" />
                  <span className="hidden md:inline">Offline</span>
                </>
              )}
            </button>

            {/* Dark / Light Mode Switch */}
            <button
              type="button"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-pressed={theme === 'light'}
              className="theme-toggle-btn flex items-center justify-center p-1.5 sm:px-3 sm:py-1.5 rounded-xl border border-[#cbdbe9] dark:border-slate-700 bg-[#e6f0f7] dark:bg-slate-800 text-xs font-bold cursor-pointer transition-all active:scale-95 text-slate-800 dark:text-slate-200"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? (
                <>
                  <Sun size={15} className="text-amber-400" />
                  <span className="hidden md:inline text-slate-200">Light</span>
                </>
              ) : (
                <>
                  <Moon size={15} className="text-indigo-600" />
                  <span className="hidden md:inline text-slate-800">Dark</span>
                </>
              )}
            </button>

            {/* Node Settings Button */}
            <button
              title="Device & Mesh Settings"
              aria-label="Device & Mesh Settings"
              className="icon-btn p-1.5 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:white"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={17} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Screen Canvas */}
      <main className="w-full max-w-7xl mx-auto px-2.5 sm:px-6 py-2.5 sm:py-6 flex-1 overflow-x-hidden">
        {/* Minimal Reassuring Header */}
        {(title || subtitle || last) && (
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 sm:mb-4">
            {(title || subtitle) && (
              <div>
                {title && (
                  <h1 className="text-lg sm:text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <p className="hidden sm:block text-slate-600 dark:text-slate-400 text-xs sm:text-sm mt-0.5 leading-relaxed font-medium">
                    {subtitle}
                  </p>
                )}
              </div>
            )}

            {last && (
              <div className="text-[11px] sm:text-xs text-slate-700 dark:text-slate-400 bg-[#e6f0f7] dark:bg-slate-900/90 border border-[#cce0ef] dark:border-slate-800/80 rounded-xl px-2.5 py-1 flex items-center gap-1.5 shadow-xs font-mono font-medium">
                <Cloud size={12} className="text-cyan-600 dark:text-cyan-400" />
                <span>Synced {new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}
          </div>
        )}

        {/* Global Node Warning */}
        {error && (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-red-300 dark:border-red-800/80 bg-red-50 dark:bg-red-950/50 p-4 text-red-800 dark:text-red-200 text-sm flex items-center justify-between gap-3 shadow-sm"
          >
            <div className="flex items-center gap-2.5">
              <CloudOff size={18} className="text-red-500 dark:text-red-400 shrink-0" />
              <span>Edge node is currently unreachable: {error}. Start the backend or connect to its Wi-Fi hotspot.</span>
            </div>
          </div>
        )}

        {children}
      </main>

      {/* Settings Modal */}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export function Card({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`app-card bg-white dark:bg-[#0b1626] border border-[#e2e8f0] dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs transition-all ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-4 border-b border-[#eef2f6] dark:border-slate-800 pb-3">
          <div>
            {title && (
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
                <span className="w-1.5 h-4 rounded-full bg-cyan-600 dark:bg-cyan-400 inline-block shrink-0"></span>
                <span className="text-slate-900 dark:text-slate-100 font-extrabold">{title}</span>
              </h2>
            )}
            {subtitle && <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ icon: Icon, children }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-800 text-slate-400 text-xs sm:text-sm p-6 text-center flex flex-col items-center justify-center gap-2 bg-slate-900/30">
      {Icon && <Icon size={24} className="text-slate-500 opacity-70" />}
      <span>{children}</span>
    </div>
  );
}
