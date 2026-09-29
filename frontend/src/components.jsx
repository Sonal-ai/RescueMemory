import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  Activity,
  CircleHelp,
  Cloud,
  CloudOff,
  Database,
  Menu,
  Moon,
  Radio,
  Settings2,
  Sun,
  Wifi,
  X
} from 'lucide-react';
import { api, saveSetting, setting } from './api';

export function useNodeStatus() {
  const [health, setHealth] = useState(null);
  const [sync, setSync] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [nextHealth, nextSync] = await Promise.all([api('/health'), api('/api/sync/status')]);
        if (active) {
          setHealth(nextHealth);
          setSync(nextSync);
          setError('');
        }
      } catch (err) {
        if (active) {
          setHealth(null);
          setError(err.message);
        }
      }
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return { health, sync, error };
}

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
      <div className="settings-dialog w-full max-w-xl bg-[#0b1626] border border-slate-700/80 rounded-3xl p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Settings2 size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100">Node Configuration</h2>
              <p className="text-xs text-slate-400">Local device & peer mesh parameters</p>
            </div>
          </div>
          <button
            aria-label="Close settings"
            onClick={onClose}
            className="icon-btn text-slate-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-xs text-slate-400 mb-6 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
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
            <label key={name} className="text-xs font-semibold text-slate-300">
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

        <div className="flex items-center justify-end gap-3 mt-7 pt-4 border-t border-slate-800">
          <button className="btn-secondary text-sm" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary text-sm px-6" onClick={save}>
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}

export function Shell({ title, subtitle, children }) {
  const { health, sync, error } = useNodeStatus();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('rescue.theme') === 'light' ? 'light' : 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('rescue.theme', theme);
  }, [theme]);

  const nav = [
    ['/', 'Emergency Chatbot'],
    ['/compass', 'Survivor Compass'],
    ['/map', 'Tactical Map'],
    ['/radar', 'Survival Radar'],
  ];
  if (health?.role === 'volunteer' || health?.role === 'central') nav.push(['/volunteer', 'Field Board']);
  if (health?.role === 'central') nav.push(['/command', 'Command HQ']);
  nav.push(['/about', 'About Mesh']);

  const exchanges = sync?.last_exchanges || [];
  const last = exchanges.map((item) => item.synced_at).filter(Boolean).sort().at(-1);

  return (
    <div className="app-shell min-h-screen bg-[#060b13] text-slate-100 flex flex-col pb-16 sm:pb-0">
      {/* Top Tactical Navigation Header */}
      <header className="app-header border-b border-slate-800/80 bg-[#091322]/95 sticky top-0 z-40 backdrop-blur-md shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          
          {/* Logo & Tactical Identity */}
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2.5 font-black tracking-tight text-lg group">
              <span className="h-9 w-9 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center text-white shadow-md shadow-red-500/20 group-hover:scale-105 transition-transform">
                <Activity size={20} />
              </span>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 leading-none">
                  <span className="font-extrabold text-base sm:text-lg tracking-tight">RescueMemory</span>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/50">
                    EDGE
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono tracking-wider">OFFLINE SURVIVAL MESH</span>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-1 ml-6">
              {nav.map(([path, label]) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) =>
                    `px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      isActive
                        ? 'bg-slate-800 text-white shadow-sm border border-slate-700/60'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Right Action Bar */}
          <div className="flex items-center gap-2">
            {/* Live Edge Node Status Pill */}
            <span
              className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5 font-semibold transition-all ${
                health
                  ? 'text-emerald-300 border-emerald-800/80 bg-emerald-950/60 shadow-sm shadow-emerald-950/20'
                  : 'text-red-300 border-red-800/80 bg-red-950/60 shadow-sm shadow-red-950/20'
              }`}
            >
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${health ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${health ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
              </span>
              <span className="hidden sm:inline font-mono">
                {health ? `${health.node_id}` : 'Node offline'}
              </span>
              <span className="sm:hidden font-mono">
                {health ? 'Live' : 'Off'}
              </span>
            </span>

            {/* Dark / Light Mode Switch */}
            <button
              type="button"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-pressed={theme === 'light'}
              className="theme-toggle-btn flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-all active:scale-95"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? (
                <>
                  <Sun size={14} className="text-amber-400" />
                  <span className="hidden sm:inline text-slate-200">Light</span>
                </>
              ) : (
                <>
                  <Moon size={14} className="text-indigo-600" />
                  <span className="hidden sm:inline text-slate-800">Dark</span>
                </>
              )}
            </button>

            {/* Node Settings Button */}
            <button
              title="Device & Mesh Settings"
              aria-label="Device & Mesh Settings"
              className="icon-btn rounded-xl"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={18} />
            </button>

            {/* Mobile Menu Toggle */}
            <button
              aria-label="Menu"
              className="icon-btn md:hidden rounded-xl"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Dropdown */}
        {menuOpen && (
          <div className="md:hidden border-t border-slate-800 bg-[#07111e] px-4 py-3 space-y-1.5">
            {nav.map(([path, label]) => (
              <NavLink
                key={path}
                to={path}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `block px-3.5 py-2.5 rounded-xl text-sm font-bold ${
                    isActive ? 'bg-red-500 text-white' : 'text-slate-300 hover:bg-slate-800'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </div>
        )}
      </header>

      {/* Main Screen Canvas */}
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-5 sm:py-8 flex-1">
        {/* Title Bar & Last Sync Header */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
              <p className="text-[11px] uppercase tracking-[.25em] text-cyan-400 font-bold">
                Qdrant Edge In-Process Engine
              </p>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-slate-100">
              {title}
            </h1>
            {subtitle && (
              <p className="text-slate-400 text-xs sm:text-sm mt-1.5 max-w-2xl leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>

          <div className="text-xs text-slate-400 bg-slate-900/90 border border-slate-800/80 rounded-xl px-3 py-2 flex items-center gap-2 shadow-sm font-mono">
            {last ? (
              <Cloud size={14} className="text-cyan-400" />
            ) : (
              <CircleHelp size={14} className="text-slate-500" />
            )}
            <span>
              {last ? `Mesh sync: ${new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No cloud sync recorded'}
            </span>
          </div>
        </div>

        {/* Global Node Warning */}
        {error && (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-red-800/80 bg-red-950/50 p-4 text-red-200 text-sm flex items-center justify-between gap-3 shadow-md shadow-red-950/20"
          >
            <div className="flex items-center gap-2.5">
              <CloudOff size={18} className="text-red-400 shrink-0" />
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
    <section className={`app-card bg-[#0b1626] border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xl shadow-black/20 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-4 border-b border-slate-800/60 pb-3">
          <div>
            {title && <h2 className="text-base sm:text-lg font-bold text-slate-100 tracking-tight">{title}</h2>}
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
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
