import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  ChevronDown,
  CircleHelp,
  Cloud,
  CloudOff,
  Database,
  Globe,
  HeartPulse,
  Menu,
  Moon,
  Radio,
  Settings2,
  ShieldCheck,
  Sun,
  Users,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { api, saveSetting, setting, isOnlineMode, setOnlineMode, onOnlineModeChange } from './api';
import { useNodeStatus } from './hooks/useNodeStatus';
export { useNodeStatus };

const NAV_LINKS = [
  { path: '/', label: 'Survivor HUD', icon: HeartPulse, desc: 'Chat, Radar & SOS', badge: 'Survivor' },
  { path: '/volunteer', label: 'Responders', icon: Users, desc: 'Medic Field Board', badge: 'Medic' },
  { path: '/safeplace', label: 'Safe Evacuation', icon: ShieldCheck, desc: 'Negative Vector Routing', badge: 'Route' },
  { path: '/hq', label: 'Command HQ', icon: Radio, desc: 'Incident Ledger Relay', badge: 'Central' },
  { path: '/command', label: 'Inspector', icon: Activity, desc: 'Qdrant Cloud & Proofs', badge: 'Dev' },
  { path: '/about', label: 'Overview', icon: Globe, desc: 'Landing Page & System Specs', badge: 'Landing' },
];

export function SettingsPanel({ onClose }) {
  const [values, setValues] = useState({
    backendUrl: setting('backendUrl'),
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
            ['backendUrl', 'Central Server URL', 'https://rescuememory-backend.onrender.com'],
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500 font-medium">Quick Presets:</span>
            <button
              type="button"
              className="text-[11px] font-mono py-1 px-2 rounded-lg bg-cyan-50 dark:bg-slate-800 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-slate-700 hover:bg-cyan-100 cursor-pointer"
              onClick={() => setValues(v => ({ ...v, backendUrl: 'http://10.0.2.2:8000' }))}
            >
              📱 Emulator (10.0.2.2)
            </button>
            <button
              type="button"
              className="text-[11px] font-mono py-1 px-2 rounded-lg bg-emerald-50 dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-slate-700 hover:bg-emerald-100 cursor-pointer"
              onClick={() => setValues(v => ({ ...v, backendUrl: 'http://10.122.244.213:8000' }))}
            >
              📶 Wi-Fi PC (10.122.244.213)
            </button>
            <button
              type="button"
              className="text-[11px] font-mono py-1 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-slate-200 cursor-pointer"
              onClick={() => {
                setValues({
                  backendUrl: 'http://10.0.2.2:8000',
                  reporterId: 'survivor-1',
                  peerUrl: 'http://10.0.2.2:8000',
                  groupId: 'camp-alpha',
                  groupToken: 'demo-mesh-shared-key',
                  adminKey: 'rescue-admin-key-2026',
                  responderKey: 'rescue-responder-shared-key-2026'
                });
              }}
            >
              ⚡ Fill Demo Keys
            </button>
          </div>
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
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-emerald-300 dark:border-emerald-500/30 bg-emerald-100/90 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-300 hover:bg-emerald-200/80 dark:hover:bg-emerald-950/60 text-[11px] font-bold transition-all active:scale-95 shadow-xs"
        title="Offline system status & peer telemetry"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-500"></span>
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-600"></span>
        </span>
        <span className="hidden sm:inline font-bold">Offline Ready</span>
        <ChevronDown size={11} className={`opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
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
              <span className="text-cyan-700 dark:text-cyan-300">{health?.guides ?? (health ? 0 : 419)} survival records</span>
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
              Project Overview & Specs →
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
  const location = useLocation();
  const { health, sync, error } = useNodeStatus();
  const last = sync?.last_sync || sync?.last_uplink;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
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

  const isSurvivorActive = location.pathname === '/' || ['/chat', '/compass', '/find', '/map', '/radar', '/report', '/beacon'].includes(location.pathname);

  return (
    <div className="app-shell min-h-screen bg-[#f0f5fa] dark:bg-[#080d19] text-slate-900 dark:text-slate-100 flex flex-col pb-16 sm:pb-0">
      {/* Top Tactical Navigation Header */}
      <header className="app-header border-b border-[#dbe6f0] dark:border-cyan-500/15 bg-white/95 dark:bg-[#0b1528]/95 sticky top-0 z-40 backdrop-blur-xl shadow-xs">
        <div className="h-0.5 w-full bg-gradient-to-r from-red-500 via-cyan-400 to-emerald-400 opacity-90" />
        <div className="max-w-7xl mx-auto px-2 sm:px-6 py-1.5 sm:py-2 flex items-center justify-between gap-1.5 sm:gap-3">
          
          {/* Logo & Tactical Identity */}
          <Link to="/" className="flex items-center gap-1.5 sm:gap-2 font-black tracking-tight text-sm sm:text-base group shrink-0">
            <span className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-gradient-to-br from-red-500 via-rose-500 to-red-600 flex items-center justify-center text-white shadow-sm shadow-red-500/25 group-hover:scale-105 transition-transform shrink-0">
              <Activity size={15} />
            </span>
            <span className="font-extrabold text-sm sm:text-base tracking-tight text-slate-900 dark:text-white">
              RescueMemory
            </span>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center gap-1 bg-[#e2ecf5] dark:bg-slate-900/80 p-1 rounded-xl border border-[#cbdbe9] dark:border-slate-800 text-xs font-semibold">
            {NAV_LINKS.map(({ path, label, icon: Icon }) => {
              const isActive = path === '/' ? isSurvivorActive : location.pathname === path;
              return (
                <Link
                  key={path}
                  to={path}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    isActive
                      ? 'bg-cyan-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <Icon size={13} className={isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400'} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right Action Bar */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {/* Mobile / Tablet Views Menu Trigger */}
            <button
              type="button"
              title="Open Tactical Views Menu"
              aria-label="Open Tactical Views Menu"
              className="lg:hidden flex items-center gap-1 px-2 py-1 rounded-lg border border-[#cbdbe9] dark:border-slate-700 bg-[#e6f0f7] dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all active:scale-95"
              onClick={() => setNavDrawerOpen(true)}
            >
              <Menu size={13} />
              <span className="text-[11px]">Views</span>
            </button>

            {/* Quiet Status Pill */}
            <QuietTelemetryPill health={health} sync={sync} error={error} />

            {/* Simulated Internet / Cloud Sync Switch */}
            <button
              type="button"
              title={online ? 'Internet Connected (Cloud AI Gemini & Sync ON). Tap to switch to Disconnected Offline Mode' : 'Offline Disaster Mode (Local Edge Memory Only). Tap to enable Internet & Cloud AI'}
              aria-label={online ? 'Disconnect Internet (Enter Offline Mode)' : 'Connect Internet (Enable Cloud AI)'}
              aria-pressed={online}
              className={`flex items-center gap-1 px-1.5 sm:px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer transition-all active:scale-95 ${
                online
                  ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30 hover:bg-emerald-200/60 dark:hover:bg-emerald-500/20'
                  : 'bg-amber-100 dark:bg-amber-500/10 text-amber-800 dark:text-amber-400 border-amber-300 dark:border-amber-500/30 hover:bg-amber-200/60 dark:hover:bg-amber-500/20'
              }`}
              onClick={() => setOnlineMode(!online)}
            >
              {online ? (
                <>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-600"></span>
                  </span>
                  <Wifi size={12} className="text-emerald-600 dark:text-emerald-500" />
                  <span className="hidden md:inline">Online</span>
                </>
              ) : (
                <>
                  <span className="inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                  <WifiOff size={12} className="text-amber-600 dark:text-amber-500" />
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
              className="theme-toggle-btn flex items-center justify-center p-1 sm:px-2.5 sm:py-1 rounded-lg border border-[#cbdbe9] dark:border-slate-700 bg-[#e6f0f7] dark:bg-slate-800 text-[11px] font-bold cursor-pointer transition-all active:scale-95 text-slate-800 dark:text-slate-200"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? (
                <>
                  <Sun size={13} className="text-amber-400" />
                  <span className="hidden md:inline text-slate-200 ml-1">Light</span>
                </>
              ) : (
                <>
                  <Moon size={13} className="text-indigo-600" />
                  <span className="hidden md:inline text-slate-800 ml-1">Dark</span>
                </>
              )}
            </button>

            {/* Node Settings Button */}
            <button
              title="Device & Mesh Settings"
              aria-label="Device & Mesh Settings"
              className="p-1 rounded-lg border border-[#cbdbe9] dark:border-slate-700 bg-[#e6f0f7] dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Tactical Views Slide-out Drawer */}
      {navDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex justify-start animate-in fade-in duration-150">
          <div className="w-[85vw] max-w-sm h-full bg-white dark:bg-[#0b1626] border-r border-[#dbe6f0] dark:border-slate-800 p-4 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#e2e8f0] dark:border-slate-800">
              <div className="flex items-center gap-2 font-black text-sm">
                <span className="h-7 w-7 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center text-white shadow-xs">
                  <Activity size={16} />
                </span>
                <span className="text-slate-900 dark:text-white font-extrabold text-sm">Tactical Operations</span>
              </div>
              <button
                onClick={() => setNavDrawerOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>

            <div className="py-2.5 text-[10.5px] font-bold text-slate-400 uppercase tracking-widest font-mono">
              Operational Stations
            </div>

            <nav className="flex-1 space-y-2 overflow-y-auto pr-1">
              {NAV_LINKS.map(({ path, label, icon: Icon, desc, badge }) => {
                const isActive = path === '/' ? isSurvivorActive : location.pathname === path;
                return (
                  <Link
                    key={path}
                    to={path}
                    onClick={() => setNavDrawerOpen(false)}
                    className={`flex items-start gap-3 p-2.5 rounded-xl border transition-all ${
                      isActive
                        ? 'bg-cyan-50 dark:bg-cyan-500/10 border-cyan-400 dark:border-cyan-500/50 text-cyan-900 dark:text-cyan-300 font-bold shadow-xs'
                        : 'border-[#e2e8f0] dark:border-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-900/60 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${isActive ? 'bg-cyan-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'} shrink-0 mt-0.5`}>
                      <Icon size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs">{label}</span>
                        <span className="text-[9.5px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{badge}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-normal leading-tight mt-0.5">{desc}</p>
                    </div>
                  </Link>
                );
              })}
            </nav>

            <div className="pt-3 border-t border-[#e2e8f0] dark:border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={() => { setNavDrawerOpen(false); setSettingsOpen(true); }}
                className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-cyan-500 font-semibold"
              >
                <Settings2 size={13} /> Node Settings
              </button>
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-cyan-500 font-semibold"
              >
                {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />} {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Quick-Access Dock */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#0b1626]/95 border-t border-[#dbe6f0] dark:border-slate-800 backdrop-blur-xl px-2 py-1 flex items-center justify-around shadow-lg">
        {[
          { path: '/', label: 'Survivor', icon: HeartPulse, isMatch: isSurvivorActive },
          { path: '/volunteer', label: 'Responders', icon: Users, isMatch: location.pathname === '/volunteer' },
          { path: '/safeplace', label: 'Evac Route', icon: ShieldCheck, isMatch: location.pathname === '/safeplace' },
          { path: '/hq', label: 'Command HQ', icon: Radio, isMatch: location.pathname === '/hq' },
        ].map(({ path, label, icon: Icon, isMatch }) => (
          <Link
            key={path}
            to={path}
            className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
              isMatch ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Icon size={16} className={isMatch ? 'text-cyan-600 dark:text-cyan-400' : ''} />
            <span>{label}</span>
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setNavDrawerOpen(true)}
          className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
        >
          <Menu size={16} />
          <span>More</span>
        </button>
      </div>

      {/* Main Screen Canvas */}
      <main className="w-full max-w-7xl mx-auto px-1.5 sm:px-4 py-1.5 sm:py-4 flex-1 overflow-x-hidden">
        {/* Minimal Reassuring Header */}
        {(title || subtitle || last) && (
          <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2 sm:mb-3">
            {(title || subtitle) && (
              <div>
                {title && (
                  <h1 className="text-base sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <p className="hidden sm:block text-slate-600 dark:text-slate-400 text-xs mt-0.5 leading-relaxed font-medium">
                    {subtitle}
                  </p>
                )}
              </div>
            )}

            {last && (
              <div className="text-[10px] sm:text-xs text-slate-700 dark:text-slate-400 bg-[#e6f0f7] dark:bg-slate-900/90 border border-[#cce0ef] dark:border-slate-800/80 rounded-lg px-2 py-0.5 flex items-center gap-1 shadow-xs font-mono font-medium">
                <Cloud size={11} className="text-cyan-600 dark:text-cyan-400" />
                <span>Synced {new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}
          </div>
        )}

        {/* Global Node Warning */}
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-300 dark:border-red-800/80 bg-red-50 dark:bg-red-950/50 p-3 text-red-800 dark:text-red-200 text-xs flex items-center justify-between gap-2 shadow-sm"
          >
            <div className="flex items-center gap-2">
              <CloudOff size={16} className="text-red-500 dark:text-red-400 shrink-0" />
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
    <section className={`app-card bg-white dark:bg-[#0b1626] border border-[#e2e8f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 md:p-5 shadow-xs transition-all ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-2.5 border-b border-[#eef2f6] dark:border-slate-800 pb-2">
          <div>
            {title && (
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-1.5">
                <span className="w-1 h-3.5 rounded-full bg-cyan-600 dark:bg-cyan-400 inline-block shrink-0"></span>
                <span className="text-slate-900 dark:text-slate-100 font-bold">{title}</span>
              </h2>
            )}
            {subtitle && <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">{subtitle}</p>}
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
