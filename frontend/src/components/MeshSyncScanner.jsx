import { useCallback, useEffect, useRef, useState } from 'react';
import { Battery, Bluetooth, Info, ChevronDown, ChevronUp, Cloud, RefreshCw,
  Search, X, Download, Upload, MapPin, Bug } from 'lucide-react';
import MeshRadar from './MeshRadar.jsx';
import { cachedMeshLocation, peerRadarPosition, radarDistance } from '../brain/meshRadar.js';
import { getDiscoveredPeers, syncDiscoveredPeer, triggerAutoSync, getDeviceId, isOnlineMode,
  onOnlineModeChange, onSyncStateChange, watchNativeOrWebLocation } from '../api';
import { isNativeBle, startBleReceiver, scanForNearbyPhones, getPhoneBattery,
  onBlePeersChange, publishMeshLocation, getBleDiagnostics, copyBleDiagnostics } from '../brain/bleMesh.js';
import { transferSummary, meshTrace } from '../brain/meshDiagnostics.js';
import { getAllLocalReports, getMeshHistory } from '../brain/offlineStorage.js';
import { wireReport, mergePeers } from '../brain/meshProtocol.js';

const panel = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1626] p-3 shadow-sm';
const button = 'rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-700 dark:text-cyan-300 disabled:opacity-40';
const time = value => value ? new Date(value).toLocaleString() : 'Not yet';
const ago = value => !value ? 'Not measured' : `${Math.max(0, Math.round((Date.now() - value) / 1000))}s ago`;

function BatteryLabel({ value, charging, measured }) {
  return <span className="inline-flex items-center gap-1 text-xs" title={`Measured ${time(measured)}`}>
    <Battery size={14} className={value != null && value <= 20 ? 'text-amber-500' : 'text-emerald-500'} />
    {value == null ? 'Battery pending' : `${value}%${charging ? ' · Charging' : ''}`}
  </span>;
}

export default function MeshSyncScanner({ initialPeers = [], onSyncComplete = null }) {
  const [peers, setPeers] = useState(initialPeers), [reports, setReports] = useState([]);
  const [history, setHistory] = useState({ transfers: [], receipts: [] });
  const [battery, setBattery] = useState({}), [location, setLocation] = useState(cachedMeshLocation);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [auto, setAuto] = useState(() => isNativeBle() && localStorage.getItem('rescue.mesh_auto') !== 'false');
  const [online, setOnline] = useState(isOnlineMode() && navigator.onLine !== false);
  const [filter, setFilter] = useState('all'), [kind, setKind] = useState('all'), [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(null), [selectedPhone, setSelectedPhone] = useState(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null), [copied, setCopied] = useState(false);
  const mounted = useRef(true), busyRef = useRef(false), autoRef = useRef(auto), retries = useRef(new Map());
  const callback = useRef(onSyncComplete);
  const notifiedTransfers = useRef(new Set());
  useEffect(() => { callback.current = onSyncComplete; }, [onSyncComplete]);

  const refreshData = useCallback(async () => {
    const [nextReports, nextHistory] = await Promise.all([getAllLocalReports(), getMeshHistory()]);
    if (mounted.current) { setReports(nextReports); setHistory(nextHistory); }
  }, []);
  const refreshPhones = useCallback(async () => {
    const result = await getDiscoveredPeers();
    if (mounted.current) setPeers(result.peers || []);
  }, []);
  const refreshLocal = useCallback(async () => {
    const nextBattery = await getPhoneBattery();
    if (mounted.current) { setBattery(nextBattery); setLocation(cachedMeshLocation()); }
  }, []);

  const exchangePhone = useCallback(async (peer, manual = false) => {
    if (mounted.current) { setBusy(peer.node_id); setError(''); }
    try {
      const result = await syncDiscoveredPeer(peer);
      retries.current.delete(peer.node_id);
      if (mounted.current) setError('');
      // Automatic transfers announce through the shared receipt event once.
      if (mounted.current && manual && !result.sent && !result.received)
        setMessage(`${peer.name}: ${transferSummary(result)}`);
      await refreshData(); callback.current?.();
    } catch (err) {
      const retry = retries.current.get(peer.node_id) || { failures: 0 };
      retry.failures++; retry.next = Date.now() + Math.min(120000, 30000 * 2 ** (retry.failures - 1));
      retries.current.set(peer.node_id, retry);
      if (mounted.current) setError(`${peer.name}: ${err.message}`);
    }
  }, [refreshData]);

  const runCycle = useCallback(async (manual = false, selected = null) => {
    if (busyRef.current || document.hidden || !mounted.current) return;
    busyRef.current = true; setError(''); setBusy(selected?.node_id || 'scan');
    try {
      let found = [];
      if (isNativeBle()) {
        const started = await startBleReceiver(); if (mounted.current) setReady(started);
        found = selected ? [selected] : await scanForNearbyPhones();
        const self = getDeviceId();
        for (const peer of found) {
          if (!mounted.current || document.hidden || (!manual && !autoRef.current)) break;
          if (!peer?.node_id || (!peer.sync_ready && !peer.node_id.startsWith('unresolved_')) || (!manual && self.localeCompare(peer.node_id) > 0)) continue;
          if (!manual && (retries.current.get(peer.node_id)?.next || 0) > Date.now()) continue;
          await exchangePhone(peer, manual);
        }
      }
      if (mounted.current && !document.hidden) { await refreshPhones(); await refreshLocal(); await refreshData(); }
      if (manual && !selected && mounted.current && !found.length) setMessage('No nearby phones found. Start RescueMemory on both phones and allow Nearby devices.');
    } catch (err) { if (mounted.current) { setError(err.message); setReady(false); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(''); }
  }, [exchangePhone, refreshData, refreshLocal, refreshPhones]);

  useEffect(() => {
    mounted.current = true;
    const changed = () => refreshData().catch(err => mounted.current && setError(`Local storage: ${err.message}`));
    const received = event => {
      changed(); callback.current?.();
      const result = event.detail?.result;
      if (result?.status === 'complete') setError('');
      if (result?.id && (result.sent || result.received) && !notifiedTransfers.current.has(result.id)) {
        notifiedTransfers.current.add(result.id);
        if (notifiedTransfers.current.size > 100) notifiedTransfers.current.delete(notifiedTransfers.current.values().next().value);
        setMessage(`Bluetooth: ${transferSummary(result)}`);
      }
    };
    const unsubscribeSync = onSyncStateChange(state => {
      if (mounted.current && (state.uploadedCount || state.receivedCount)) {
        setMessage(`Online channel: ${[state.uploadedCount > 0 ? `uploaded ${state.uploadedCount}` : '', state.receivedCount > 0 ? `received ${state.receivedCount}` : ''].filter(Boolean).join(' · ')}`);
        changed();
      }
    });
    const updateConnectivity = () => setOnline(isOnlineMode() && navigator.onLine !== false);
    const updateBle = event => { if (mounted.current) setReady(event.detail.ready); };
    const meshError = event => { if (mounted.current) setError(event.detail.error); };
    const unsubscribeOnline = onOnlineModeChange(updateConnectivity);
    const unsubscribePeers = onBlePeersChange(list => {
      if (mounted.current) setPeers(current => mergePeers([current.filter(p => p.source !== 'native_ble'), list], getDeviceId()));
    });
    window.addEventListener('rescue:reports-changed', changed);
    window.addEventListener('rescue:transfers-changed', changed);
    window.addEventListener('rescue:ble-received', received);
    window.addEventListener('rescue:ble-state', updateBle);
    window.addEventListener('rescue:mesh-error', meshError);
    window.addEventListener('online', updateConnectivity); window.addEventListener('offline', updateConnectivity);
    changed(); refreshLocal().catch(err => meshTrace('telemetry.refresh', 'FAILED', err.message));
    const start = async () => {
      if (isNativeBle()) { const started = await startBleReceiver(); if (mounted.current) setReady(started); }
      if (mounted.current) await refreshPhones();
    };
    start().catch(err => mounted.current && setError(err.message));
    const refreshFailure = err => { meshTrace('ui.refresh', 'FAILED', err.message); if (mounted.current) setError(err.message); };
    const interval = setInterval(() => { if (!document.hidden) { refreshLocal().catch(refreshFailure); refreshPhones().catch(refreshFailure); } }, 10000);
    const visible = () => { if (!document.hidden) { refreshPhones().catch(err => meshTrace('peers.refresh', 'FAILED', err.message)); refreshLocal().catch(err => meshTrace('telemetry.refresh', 'FAILED', err.message)); } };
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false; clearInterval(interval); unsubscribeOnline(); unsubscribePeers(); unsubscribeSync();
      window.removeEventListener('rescue:reports-changed', changed); window.removeEventListener('rescue:transfers-changed', changed);
      window.removeEventListener('rescue:ble-received', received); window.removeEventListener('online', updateConnectivity); window.removeEventListener('offline', updateConnectivity);
      window.removeEventListener('rescue:ble-state', updateBle);
      window.removeEventListener('rescue:mesh-error', meshError);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refreshData, refreshLocal, refreshPhones]);

  useEffect(() => {
    if (!isNativeBle()) return;
    let cancelled = false, stop;
    watchNativeOrWebLocation(fix => {
      if (cancelled) return;
      publishMeshLocation(fix).then(value => { if (!cancelled && value) setLocation(value); }).catch(err => meshTrace('gps.publish', 'FAILED', err.message));
    }).then(unsubscribe => { if (cancelled) unsubscribe?.(); else stop = unsubscribe; }).catch(err => meshTrace('gps.watch', 'UNAVAILABLE', err.message));
    return () => { cancelled = true; stop?.(); };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 20000);
    return () => clearTimeout(timer);
  }, [message]);

  const nearby = peers.filter(p => p.source === 'native_ble');
  const receivedReports = reports.filter(report => report.imported && report.received_from)
    .sort((a, b) => Date.parse(b.imported_at || 0) - Date.parse(a.imported_at || 0));
  const onlinePeers = peers.filter(p => p.source !== 'native_ble');
  const visibleReports = reports;
  const sentIds = new Set(history.receipts.filter(r => r.direction === 'sent' || r.direction === 'confirmed').map(r => r.report_id));
  const filtered = visibleReports.filter(r => (filter !== 'received' || r.imported) &&
    (filter !== 'pending' || !sentIds.has(r.id)) && (kind === 'all' || (kind === 'sos' ? ['sos', 'incident'].includes(r.kind) : r.kind === kind)) &&
    `${r.text} ${r.kind} ${r.reporter_id || ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.imported_at || b.created_at || b.observed_at || '').localeCompare(a.imported_at || a.created_at || a.observed_at || ''));
  const syncCloud = async () => {
    if (busyRef.current) return; busyRef.current = true; setBusy('cloud'); setError('');
    try {
      const result = await triggerAutoSync(); await refreshData();
      if (result.synced > 0 || result.imported > 0) setMessage(`Online channel: ${[result.synced > 0 ? `uploaded ${result.synced}` : '', result.imported > 0 ? `received ${result.imported}` : ''].filter(Boolean).join(' · ')}`);
      else setMessage(result.status === 'offline' ? 'Online channel unavailable; reports remain on this phone.' : 'Online check finished; no new reports were uploaded or received.');
      callback.current?.();
    } catch (err) { setError(err.message); } finally { busyRef.current = false; if (mounted.current) setBusy(''); }
  };
  const refreshDiagnostics = useCallback(async () => {
    try { const value = await getBleDiagnostics(); if (mounted.current) setDiagnostics(value); }
    catch (err) { if (mounted.current) setError(`[diagnostics] ${err.message}`); }
  }, []);
  useEffect(() => {
    if (!debugOpen) return;
    const first = setTimeout(refreshDiagnostics, 0);
    const timer = setInterval(refreshDiagnostics, 3000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [debugOpen, refreshDiagnostics]);
  const copyDiagnostics = async () => {
    try { await copyBleDiagnostics(); setCopied(true); }
    catch (err) { setError(`[diagnostics.copy] ${err.message}`); }
  };

  return <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 pb-4 text-slate-900 dark:text-slate-100">
    <section className={panel}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="flex items-center gap-2 text-base font-bold"><Bluetooth size={19} className="text-cyan-500" />Mesh Sync</h2>
          <p className="mt-1 text-xs text-slate-500">{ready ? 'Bluetooth ready' : 'Waiting for Bluetooth'} · Auto-shares SOS and reports</p></div>
        <button type="button" aria-label="Mesh Sync details and debugging" title="Sync details" onClick={() => setDebugOpen(true)} className="shrink-0 rounded-full border border-slate-300 p-2 text-cyan-700 dark:border-slate-700 dark:text-cyan-300"><Info size={18} /></button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs">
        <label htmlFor="mesh-auto-toggle" className="font-semibold">Auto-sync nearby phones</label>
        <input aria-label="Auto-sync nearby phones" type="checkbox" checked={auto} disabled={!isNativeBle()} className="h-5 w-5 accent-cyan-600"
          id="mesh-auto-toggle"
          onChange={e => { setAuto(e.target.checked); autoRef.current = e.target.checked; localStorage.setItem('rescue.mesh_auto', String(e.target.checked)); window.dispatchEvent(new CustomEvent('rescue:mesh-auto-changed')); }} />
      </div>
    </section>

    {error && <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"><span>Sync needs a retry. See Sync debugging for details.</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
    {message && <div role="status" className="flex items-start gap-2 rounded-xl bg-cyan-50 p-3 text-xs text-cyan-900 dark:bg-cyan-950 dark:text-cyan-100"><Info size={16} className="shrink-0" />{message}</div>}

    <section className={panel}>
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">Nearby phones ({nearby.filter(p => p.available).length})</h3>
        <button className={button} disabled={!!busy || !isNativeBle()} onClick={() => runCycle(true)}>
          <span className="flex items-center gap-1"><RefreshCw size={13} className={busy ? 'animate-spin' : ''} />{busy === 'scan' ? 'Scanning…' : 'Find & sync'}</span></button>
      </div>
      <MeshRadar peers={nearby} location={location} scanning={busy === 'scan'} onSelect={peer => setSelectedPhone(peer.node_id)} />
      <div className="space-y-2">{nearby.map(peer => {
        const latest = history.transfers.find(t => t.peer_id === peer.node_id && t.transport === 'bluetooth');
        const lastExchange = history.transfers.find(t => t.peer_id === peer.node_id && t.transport === 'bluetooth' && (t.sent > 0 || t.received > 0));
        const position = peerRadarPosition(location, peer);
        return <article key={peer.node_id} className={`rounded-xl border p-3 ${selectedPhone === peer.node_id ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-200 dark:border-slate-800'}`}>
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h4 className="break-words text-sm font-bold">{peer.available ? `${nearby.filter(p => p.available).findIndex(p => p.node_id === peer.node_id) + 1}. ` : ''}{peer.name}</h4>
            <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-500"><span>Phone {peer.node_id.slice(-6)}</span><span>Bluetooth{peer.transports?.some(t => t !== 'native_ble') ? ' + Online' : ''}</span>
              <span>{peer.sync_ready ? peer.available ? 'Identified' : `Last seen ${ago(peer.last_seen_epoch)}` : peer.node_id.startsWith('unresolved_') ? 'Beacon detected · identifying automatically' : 'Update required'}</span>
              </div></div>
            <button className={button} disabled={!!busy || !peer.available || (!peer.sync_ready && !peer.node_id.startsWith('unresolved_'))} onClick={() => runCycle(true, peer)}>{busy === peer.node_id ? 'Syncing…' : peer.error ? 'Retry' : 'Sync now'}</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500"><BatteryLabel value={peer.battery} charging={peer.charging} measured={peer.battery_measured_at} />
            <span>{radarDistance(position.distance_m)} · {position.source === 'gps' ? 'GPS' : 'signal estimate'}</span>
            {position.bearing_deg != null && <span>{Math.round(position.bearing_deg)}° from north</span>}
            </div>
          {lastExchange ? <p className="mt-2 text-xs text-slate-500">Last exchange: {transferSummary(lastExchange)} · {time(lastExchange.updated_at)}</p>
            : latest?.inventory_checked ? <p className="mt-2 text-xs text-slate-500">Reports up to date · {time(latest.updated_at)}</p> : null}
          {peer.error && !peer.available && <p className="mt-1 text-xs text-slate-500">Last seen {ago(peer.last_seen_epoch)} · retrying discovery</p>}
        </article>;
      })}</div>
      {!nearby.length && <p className="py-2 text-center text-xs text-slate-500">No nearby phones found yet. Turn on Bluetooth and allow Nearby devices and precise Location on both phones.</p>}
    </section>

    <section className={panel} aria-label="Received reports">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">Received reports</h3><span className="text-xs text-slate-500">{receivedReports.length} unique</span></div>
      {receivedReports.length ? <div className="mt-2 space-y-2">{receivedReports.slice(0, 8).map(report =>
        <article key={report.id} className="min-w-0 border-t border-slate-200 pt-2 dark:border-slate-800">
          <p className="text-xs font-bold uppercase text-cyan-700 dark:text-cyan-300">{report.kind === 'checkpoint' ? 'Shelter' : report.kind || 'Report'} · Phone {String(report.received_from).slice(-6)}</p>
          <p className="mt-0.5 line-clamp-2 break-words text-sm">{report.text}</p>
        </article>)}</div> : <p className="mt-2 text-xs text-slate-500">New reports from nearby phones will stay here after sync.</p>}
    </section>

    {debugOpen && <div className="native-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-3" role="dialog" aria-modal="true" aria-label="Mesh Sync details">
      <section className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 text-slate-900 shadow-2xl dark:bg-[#0b1626] dark:text-slate-100">
      <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-bold"><Bug size={17} />Sync details</h2><button type="button" aria-label="Close Sync details" onClick={() => setDebugOpen(false)} className="rounded-lg border border-slate-300 p-2 dark:border-slate-700"><X size={18} /></button></div>
      <p className="mt-1 text-xs text-slate-500">{online ? 'Internet online' : 'Internet offline'} · <BatteryLabel value={battery.battery} charging={battery.charging} measured={battery.battery_measured_at} /></p>
      <div className="mt-4 space-y-4">
    {error && <p className="break-words text-xs text-amber-600">{error}</p>}
    {nearby.filter(p => p.error).map(p => <p key={p.node_id} className="break-words text-xs text-amber-600">{p.name}: {p.error}</p>)}
    <details open className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <summary className="cursor-pointer text-sm font-bold">Bluetooth diagnostics</summary>
      <div className="mt-3 flex flex-wrap gap-2"><button className={button} onClick={refreshDiagnostics}>Refresh details</button><button className={button} onClick={copyDiagnostics}>{copied ? 'Copied details' : 'Copy error details'}</button></div>
      <p className="mt-2 text-xs text-slate-500">Share copied details from both phones. These contain the device/version, permissions, advertising/scanning states and exact failure stages.</p>
      {!diagnostics ? <p className="mt-2 text-xs text-slate-500">Reading actual radio state…</p> : <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-2 text-[10px] dark:bg-slate-900">{JSON.stringify(diagnostics, null, 2)}</pre>}
    </details>
    <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <summary className="cursor-pointer text-sm font-bold">Your data ({visibleReports.length})</summary>
      <div className="mt-3 flex gap-1">{[['all', 'All'], ['received', 'Received'], ['pending', 'Awaiting transfer']].map(([value, label]) =>
        <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`rounded-lg px-3 py-2 text-xs font-semibold ${filter === value ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300'}`}>{label}</button>)}</div>
      <div className="mt-3 flex gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700"><Search size={14} className="text-slate-400" /><input aria-label="Search reports" placeholder="Search reports…" className="w-full bg-transparent py-2 text-xs outline-none" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <select aria-label="Report type" className="rounded-xl border border-slate-200 bg-transparent px-2 text-xs dark:border-slate-700 dark:bg-slate-900" value={kind} onChange={e => setKind(e.target.value)}><option value="all">All types</option><option value="sos">SOS</option><option value="hazard">Hazards</option><option value="observation">Observations</option><option value="resource">Resources</option></select></div>
      <div className="mt-3 space-y-2">{filtered.map(report => {
        const receipts = history.receipts.filter(r => r.report_id === report.id), open = expanded === report.id;
        const originalScope = wireReport(report).visibility;
        return <article key={report.id} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <button className="flex w-full items-start justify-between gap-3 p-3 text-left" aria-expanded={open} onClick={() => setExpanded(open ? null : report.id)}>
            <div className="min-w-0"><div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase"><span className={report.severity === 'red' ? 'text-rose-600' : 'text-cyan-600'}>{report.kind} · {report.severity || 'Unspecified'}</span><span className="text-slate-500">{sentIds.has(report.id) ? 'Peer receipt confirmed' : 'Eligible for nearby sharing'}</span></div>
              <p className="mt-1 line-clamp-2 break-words text-sm">{report.text || 'No description'}</p>
              <p className="mt-1 text-[10px] text-slate-500">{report.imported ? `Received from ${report.received_from || report.reporter_id || 'online channel'}` : 'Created on this phone'} · {sentIds.has(report.id) ? 'Known on another phone' : 'Awaiting transfer'}{report.synced ? report.imported ? ' · Received via online channel' : ' · Uploaded' : ''}</p></div>
            {open ? <ChevronUp size={16} className="shrink-0" /> : <ChevronDown size={16} className="shrink-0" />}
          </button>
          {open && <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
            <p className="whitespace-pre-wrap break-words">{report.text}</p>
            <p>Original online scope: {originalScope} · Bluetooth: shared with all nearby app phones</p>
            <p>Status: {report.status || 'Unspecified'} · Source: {report.origin_device || report.reporter_id || 'This phone'}</p>
            <p>Observed: {time(report.observed_at || report.created_at)}</p><p>Received: {time(report.imported_at)}</p>
            <p className="flex items-center gap-1"><MapPin size={12} />{report.location ? `${report.location.lat}, ${report.location.lon}` : 'Location unavailable'}</p>
            <p className="break-all text-[10px] text-slate-500">Report ID: {report.id}</p>
            {receipts.map(receipt => <p key={receipt.id} className="flex items-start gap-1 text-[11px] text-slate-500">{receipt.direction === 'received' ? <Download size={12} /> : <Upload size={12} />}{receipt.direction === 'sent' ? 'Copied to' : receipt.direction === 'confirmed' ? 'Confirmed present on' : 'Received from'} {receipt.peer_id} via {receipt.transport} · {time(receipt.at)}</p>)}
          </div>}
        </article>;
      })}</div>
      {!filtered.length && <p className="py-6 text-center text-xs text-slate-500">{visibleReports.length ? 'No reports match these filters.' : 'No stored reports yet. Create a report or receive one from another phone.'}</p>}
    </details>

    <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><summary className="cursor-pointer text-sm font-bold">Online channel</summary><div className="mt-3 flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-xs"><Cloud size={16} />Online transfers</span><button className={button} onClick={syncCloud} disabled={!online || !!busy}>{busy === 'cloud' ? 'Syncing…' : 'Sync online'}</button></div>
      <p className="mt-2 text-xs text-slate-500">{onlinePeers.length} online node(s). Online presence does not mean a phone is nearby.</p>
      {onlinePeers.map(peer => <p key={peer.node_id} className="mt-2 text-xs">{peer.name || peer.node_id} <span className="text-slate-500">· Online only</span></p>)}
    </details>
    <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><summary className="cursor-pointer text-sm font-bold">Recent activity</summary><div className="mt-2 space-y-2">{history.transfers.slice(0, 10).map(item => <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900"><p className="font-semibold">{item.transport} · {item.status} · {item.peer_id}</p><p className="mt-1 text-slate-500">{transferSummary(item)}</p>{item.error && <p className="mt-1 text-amber-600">{item.error}</p>}<p className="mt-1 text-[10px] text-slate-400">{time(item.updated_at)}</p></div>)}</div>{!history.transfers.length && <p className="mt-2 text-xs text-slate-500">Completed and partial exchanges will appear here.</p>}</details>
      </div>
      </section>
    </div>}

  </div>;
}
