import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Activity, CircleHelp, Cloud, CloudOff, Database, Menu, Settings2, X } from 'lucide-react';
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
        if (active) { setHealth(nextHealth); setSync(nextSync); setError(''); }
      } catch (err) {
        if (active) { setHealth(null); setError(err.message); }
      }
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return { health, sync, error };
}

export function SettingsPanel({ onClose }) {
  const [values, setValues] = useState({
    adminKey: setting('adminKey'), responderKey: setting('responderKey'),
    groupId: setting('groupId'), groupToken: setting('groupToken'),
    peerUrl: setting('peerUrl'), reporterId: setting('reporterId') || 'survivor-1',
  });
  const save = () => { Object.entries(values).forEach(([key, value]) => saveSetting(key, value)); onClose(); };
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-[#101a2a] border border-slate-700 rounded-2xl p-5 sm:p-7 shadow-2xl max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-center mb-2"><h2 className="text-xl font-bold">Node settings</h2><button aria-label="Close settings" onClick={onClose}><X /></button></div>
        <p className="text-sm text-slate-400 mb-5">Keys stay in this browser tab session. They are never bundled into the app.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            ['reporterId', 'Your local name'], ['peerUrl', 'Nearby node URL'],
            ['groupId', 'Group ID'], ['groupToken', 'Group token'],
            ['adminKey', 'Node admin key'], ['responderKey', 'Responder key'],
          ].map(([name, label]) => (
            <label key={name} className="text-sm text-slate-300">{label}
              <input className="field mt-1" type={name.toLowerCase().includes('key') || name === 'groupToken' ? 'password' : 'text'}
                placeholder={name === 'peerUrl' ? 'http://192.168.1.12:8001' : ''}
                value={values[name]} onChange={(event) => setValues({ ...values, [name]: event.target.value })} />
            </label>
          ))}
        </div>
        <div className="flex justify-end mt-6"><button className="btn-primary" onClick={save}>Save settings</button></div>
      </div>
    </div>
  );
}

export function Shell({ title, subtitle, children }) {
  const { health, sync, error } = useNodeStatus();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = [
    ['/', 'Home'], ['/crisis', 'Survivor'], ['/volunteer', 'Volunteer'], ['/command', 'Command'],
  ];
  const exchanges = sync?.last_exchanges || [];
  const last = exchanges.map((item) => item.synced_at).filter(Boolean).sort().at(-1);
  return (
    <div className="min-h-screen bg-[#08111d] text-slate-100">
      <header className="border-b border-slate-800 bg-[#0b1625]/95 sticky top-0 z-30 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-tight text-lg"><span className="h-8 w-8 rounded-lg bg-red-500 flex items-center justify-center"><Activity size={20} /></span> RescueMemory</Link>
          <nav className={`${menuOpen ? 'flex' : 'hidden'} sm:flex w-full sm:w-auto sm:ml-8 order-3 sm:order-none gap-1 flex-wrap`}>
            {nav.map(([path, label]) => <NavLink key={path} to={path} onClick={() => setMenuOpen(false)} className={({ isActive }) => `px-3 py-2 rounded-lg text-sm ${isActive ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>{label}</NavLink>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${health ? 'text-emerald-300 border-emerald-800 bg-emerald-950' : 'text-red-300 border-red-800 bg-red-950'}`}>
              {health ? <Database size={13} /> : <CloudOff size={13} />}{health ? `${health.node_id} · Edge active` : 'Node unavailable'}
            </span>
            <button title="Node settings" aria-label="Node settings" className="icon-btn" onClick={() => setSettingsOpen(true)}><Settings2 size={19} /></button>
            <button aria-label="Menu" className="icon-btn sm:hidden" onClick={() => setMenuOpen(!menuOpen)}><Menu size={19} /></button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-9">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-7">
          <div><p className="text-xs uppercase tracking-[.25em] text-cyan-400 mb-2">Local memory / live status</p><h1 className="text-3xl sm:text-4xl font-bold">{title}</h1><p className="text-slate-400 mt-2 max-w-2xl">{subtitle}</p></div>
          <div className="text-xs text-slate-400 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 flex items-center gap-2">{last ? <Cloud size={15} className="text-cyan-400" /> : <CircleHelp size={15} />}{last ? `Last exchange ${new Date(last).toLocaleTimeString()}` : 'No exchange recorded'}</div>
        </div>
        {error && <div role="alert" className="mb-5 rounded-xl border border-red-800 bg-red-950/50 p-4 text-red-200">Local node is unavailable: {error}. Connect to its hotspot or start its API.</div>}
        {children}
      </main>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export function Card({ title, children, className = '' }) {
  return <section className={`bg-[#101d2d] border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-lg shadow-black/10 ${className}`}>{title && <h2 className="text-lg font-semibold mb-4">{title}</h2>}{children}</section>;
}

export function Empty({ children }) {
  return <div className="rounded-xl border border-dashed border-slate-700 text-slate-400 text-sm p-5 text-center">{children}</div>;
}
