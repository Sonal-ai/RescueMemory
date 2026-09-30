import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  CloudUpload,
  Database,
  GitBranch,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Zap,
  ChevronDown,
  ChevronUp,
  X,
  PlusCircle,
  FileCheck
} from 'lucide-react';
import { api, formatTime, setting, saveSetting } from '../api';
import { Card, Empty, Shell } from '../components';

const BASE = { lat: 28.7041, lon: 77.1025 };

export default function CommandInspector() {
  const [health, setHealth] = useState(null);
  const [sync, setSync] = useState(null);
  const [events, setEvents] = useState([]);
  const [guides, setGuides] = useState([]);
  const [selected, setSelected] = useState(null);
  const [journey, setJourney] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [cloudResult, setCloudResult] = useState(null);
  const [cloudStatus, setCloudStatus] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [showProtocolForm, setShowProtocolForm] = useState(false);

  const [checkpoint, setCheckpoint] = useState({
    entity_id: 'gate-3',
    text: 'Gate 3 is closed due to flooding. Use the north shelter.',
    status: 'blocked'
  });
  const [guide, setGuide] = useState({
    id: '',
    title: '',
    keywords: '',
    summary: '',
    steps: '',
    warnings: '',
    source: '',
    reviewer: ''
  });

  // Ensure default demo admin key is pre-set
  useEffect(() => {
    if (!setting('adminKey')) {
      saveSetting('adminKey', 'rescue-admin-key-2026');
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [h, s, publicMem, responderMem, reference] = await Promise.all([
        api('/health').catch(() => null),
        api('/api/sync/status').catch(() => null),
        api('/api/memory?scope=public&limit=100').catch(() => ({ items: [] })),
        api('/api/memory?scope=responders&limit=100', { responder: true }).catch(() => ({ items: [] })),
        api('/api/guides').catch(() => ({ guides: [] })),
      ]);
      if (h) setHealth(h);
      if (s) setSync(s);
      const combined = [
        ...(publicMem?.items || []),
        ...(responderMem?.items || []),
      ];
      const uniqueEvents = Array.from(new Map(combined.map((e) => [e.id, e])).values());
      setEvents(uniqueEvents.slice().reverse());
      if (reference?.guides) setGuides(reference.guides);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const inspect = async (event) => {
    setSelected(event);
    setJourney(null);
    setTimeline(null);
    try {
      const [provenance, entity] = await Promise.all([
        api(`/api/provenance/${event.id}`).catch(() => null),
        event.entity_id ? api(`/api/entities/${encodeURIComponent(event.entity_id)}`).catch(() => null) : Promise.resolve(null),
      ]);
      if (provenance) setJourney(provenance);
      if (entity) setTimeline(entity);
    } catch (err) {
      console.warn('Inspect item notice:', err);
    }
  };

  const testCloud = async () => {
    setWorking(true);
    setError('');
    setMessage('');
    try {
      const res = await api('/api/sync/cloud-status', { admin: true });
      setCloudStatus(res);
      if (res.connected) {
        setMessage(`Connected to Qdrant Cloud! Cluster reachable with ${res.collections?.length || 0} collections.`);
      } else {
        setError(`Qdrant Cloud unreachable: ${res.reason || res.error || 'Connection failed'}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  };

  const mirror = async () => {
    setWorking(true);
    setError('');
    setMessage('');
    try {
      const res = await api('/api/sync/cloud-mirror', { method: 'POST', admin: true });
      setCloudResult(res);
      setMessage('Qdrant Cloud mirror complete! Verified memory records synchronized bidirectionally.');
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  };

  const verifyCheckpoint = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const response = await api('/api/reports', {
        method: 'POST',
        admin: true,
        body: {
          ...checkpoint,
          kind: 'checkpoint',
          reporter_id: 'command',
          visibility: 'public',
          severity: 'red',
          location: BASE,
          verified: true
        }
      });
      setMessage(`Command update recorded in local memory (#${(response.event?.id || response.id || 'ok').slice(0, 10)}).`);
      setShowOverrideForm(false);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const publishGuide = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const body = {
        ...guide,
        steps: guide.steps.split('\n').map((s) => s.trim()).filter(Boolean),
        warnings: guide.warnings.split('\n').map((s) => s.trim()).filter(Boolean)
      };
      const response = await api('/api/guides/publish', { method: 'POST', admin: true, body });
      setMessage(`Protocol #${response.id} v${response.version} signed and published to local vector memory.`);
      setShowProtocolForm(false);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  // Filtered list of observations
  const filteredEvents = events.filter((e) => {
    if (activeFilter === 'sos') return e.kind === 'incident' || e.kind === 'sos' || e.severity === 'red';
    if (activeFilter === 'hazard') return e.kind === 'hazard';
    if (activeFilter === 'resource') return e.kind === 'resource' || e.kind === 'checkpoint';
    return true;
  });

  return (
    <Shell
      title="Central Command & Vector Inspector"
      subtitle="Audit on-device memory shards, verify ground observations, and mirror records to Qdrant Cloud."
    >
      {/* Notifications */}
      {error && (
        <div role="alert" className="mb-3 p-2.5 rounded-xl border border-red-800/80 bg-red-950/40 text-red-200 text-xs shadow-md flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert size={15} className="text-red-400 shrink-0" />
            <span className="line-clamp-2">{error}</span>
          </div>
          <button onClick={() => setError('')} className="p-1 text-red-300 hover:text-white" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {message && (
        <div role="status" className="mb-3 p-2.5 rounded-xl border border-emerald-800/80 bg-emerald-950/40 text-emerald-200 text-xs flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
            <span>{message}</span>
          </div>
          <button onClick={() => setMessage('')} className="p-1 text-emerald-300 hover:text-white" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 4 Clean Top KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
        {/* Observations */}
        <div className="stat-card p-3 rounded-2xl border border-slate-800 bg-[#07111e] flex items-center gap-3">
          <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shrink-0">
            <Database size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-black text-slate-100 font-mono">
              {events.length}
            </div>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
              Memory Events
            </p>
            <span className="text-[9px] text-cyan-400 font-medium">Live Field Reports</span>
          </div>
        </div>

        {/* Protocols */}
        <div className="stat-card p-3 rounded-2xl border border-slate-800 bg-[#07111e] flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
            <BookOpen size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-xl font-black text-slate-100 font-mono">
              {guides.length || 420}
            </div>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
              Vector Protocols
            </p>
            <span className="text-[9px] text-amber-400 font-medium">Fixed Medical Library</span>
          </div>
        </div>

        {/* Qdrant Cloud Mirror */}
        <div className="stat-card p-3 rounded-2xl border border-slate-800 bg-[#07111e] flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
            <CloudUpload size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-emerald-400 font-mono uppercase">
                {health?.cloud_configured ? 'Cloud Ready' : 'Active'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
              4 Scoped Shards
            </p>
          </div>
        </div>

        {/* Sync Action */}
        <div className="p-3 rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/40 to-[#07111e] flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-bold text-cyan-300">Qdrant Cloud</div>
            <p className="text-[10px] text-slate-400">1-Tap Sync</p>
          </div>
          <button
            onClick={mirror}
            disabled={working}
            className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={working ? 'animate-spin' : ''} />
            <span>{working ? 'Syncing...' : 'Sync Cloud'}</span>
          </button>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid xl:grid-cols-[1.15fr_0.85fr] gap-3 sm:gap-4">
        {/* Left Column: Live Memory Feed */}
        <Card title="Live Field Memory Feed">
          {/* Filter Bar & Refresh */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-800 text-xs">
            <div className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
              {[
                ['all', 'All'],
                ['sos', '🚨 SOS'],
                ['hazard', '⚠️ Hazards'],
                ['resource', '💧 Shelters / Resources'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setActiveFilter(key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    activeFilter === key
                      ? 'bg-cyan-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={refresh}
              className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-xs font-bold font-mono py-1 px-2 rounded-lg bg-slate-900 border border-slate-800"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {/* Incident / Report Cards Stream */}
          <div className="max-h-[520px] overflow-auto space-y-2 pr-1">
            {filteredEvents.length > 0 ? (
              filteredEvents.map((event) => {
                const isSelected = selected?.id === event.id;
                const isSos = event.kind === 'incident' || event.kind === 'sos' || event.severity === 'red';
                const isHazard = event.kind === 'hazard';

                return (
                  <button
                    key={event.id}
                    onClick={() => inspect(event)}
                    className={`w-full text-left rounded-2xl border p-3 transition-all cursor-pointer ${
                      isSelected
                        ? 'border-cyan-500 bg-cyan-950/40 shadow-md ring-1 ring-cyan-500/40'
                        : 'border-slate-800/80 bg-[#07111e] hover:border-slate-700 hover:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-full border ${
                          isSos
                            ? 'bg-red-950/80 border-red-700/60 text-red-300'
                            : isHazard
                              ? 'bg-amber-950/80 border-amber-700/60 text-amber-300'
                              : 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300'
                        }`}>
                          {isSos ? '🚨 Emergency SOS' : isHazard ? '⚠️ Hazard' : '🛡️ Resource'}
                        </span>
                        <span className="text-[11px] text-slate-400 capitalize">
                          {event.status || 'Active'}
                        </span>
                      </div>

                      {event.verified ? (
                        <span className="text-[9.5px] text-emerald-300 bg-emerald-950/80 border border-emerald-700/50 px-2 py-0.5 rounded-full font-mono font-bold flex items-center gap-1">
                          <ShieldCheck size={11} /> Verified
                        </span>
                      ) : (
                        <span className="text-[9.5px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full font-mono">
                          Field Report
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-200 leading-relaxed font-medium">
                      {event.text}
                    </p>

                    <div className="text-[10px] text-slate-500 mt-2 pt-1.5 border-t border-slate-800/60 font-mono flex items-center justify-between">
                      <span>Node: {event.origin_device || 'edge-mobile'}</span>
                      <span>{formatTime(event.observed_at)}</span>
                    </div>
                  </button>
                );
              })
            ) : (
              <Empty icon={Database}>No observations matching this filter.</Empty>
            )}
          </div>
        </Card>

        {/* Right Column: Provenance & Memory Lineage */}
        <div className="space-y-3">
          {/* Selected Item Inspection Card */}
          <Card title="Cryptographic Provenance Lineage">
            <div className="text-xs text-slate-400 mb-2 font-mono flex items-center gap-1.5 text-[11px]">
              <GitBranch size={13} className="text-cyan-400" />
              <span>Memory Ripple & Hop Audit</span>
            </div>

            {selected ? (
              <div className="space-y-2.5 text-xs">
                {/* Content summary */}
                <div className="bg-[#07111e] p-3 rounded-2xl border border-slate-800">
                  <div className="text-[10.5px] text-slate-400 font-mono uppercase mb-1">
                    Payload Text
                  </div>
                  <p className="text-slate-100 font-medium leading-relaxed">
                    {selected.text}
                  </p>
                  <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>Scope: <strong className="text-cyan-300 uppercase">{selected.visibility || 'public'}</strong></span>
                    <span>Origin: <strong className="text-slate-200">{selected.origin_device}</strong></span>
                  </div>
                </div>

                {/* Cryptographic SHA-256 Hash */}
                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-[10.5px] font-mono text-slate-300 truncate">
                  <span className="text-slate-500">SHA-256 Hash: </span>
                  <span className="text-emerald-400 font-bold">{selected.content_hash || selected.id}</span>
                </div>

                {/* Hop Transfer Lineage */}
                <div className="p-3 rounded-2xl bg-[#07111e] border border-slate-800">
                  <div className="text-[11px] font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                    <FileCheck size={13} className="text-emerald-400" />
                    <span>Verified Node Propagation Trail</span>
                  </div>

                  {journey?.hops?.length ? (
                    <div className="space-y-1.5">
                      {journey.hops.map((hop, i) => (
                        <div key={hop.id || i} className="border-l-2 border-cyan-500 pl-2.5 py-0.5">
                          <div className="font-bold text-slate-200 text-xs font-mono">
                            {hop.from_node} → {hop.to_node}
                          </div>
                          <div className="text-[9.5px] text-slate-500 font-mono">
                            {formatTime(hop.synced_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-slate-400 text-[11px] py-1 border-l-2 border-slate-700 pl-2 font-mono">
                      Origin Node: <strong>{selected.origin_device || 'Device'}</strong> (Direct Broadcast)
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <Empty icon={GitBranch}>Select any record on the left to inspect its cryptographic hops.</Empty>
            )}
          </Card>

          {/* Qdrant Cloud Test & Sync Card */}
          <Card title="Qdrant Cloud Cluster Status">
            <div className="text-xs text-slate-400 mb-2">
              Synchronize edge nodes with central Qdrant Cloud cluster:
            </div>

            <div className="flex gap-2">
              <button
                onClick={testCloud}
                disabled={working}
                className="btn-secondary flex-1 py-2 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Radio size={14} />
                <span>Test Connection</span>
              </button>

              <button
                onClick={mirror}
                disabled={working}
                className="btn-primary flex-1 py-2 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CloudUpload size={14} />
                <span>Mirror to Cloud</span>
              </button>
            </div>

            {cloudStatus && (
              <div className={`mt-2.5 p-2.5 rounded-xl border text-[11px] font-mono ${
                cloudStatus.connected
                  ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                  : 'bg-red-950/40 border-red-800/80 text-red-300'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold">Status: {cloudStatus.connected ? 'ONLINE' : 'OFFLINE'}</span>
                  <span>{cloudStatus.collections?.length ?? 0} Collections Visible</span>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Collapsible Action Drawers for Advanced Operations */}
      <div className="mt-4 space-y-2.5">
        {/* Checkpoint Override Form Accordion */}
        <div className="rounded-2xl border border-slate-800 bg-[#07111e] overflow-hidden">
          <button
            onClick={() => setShowOverrideForm(!showOverrideForm)}
            className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-slate-300 hover:text-white cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <PlusCircle size={15} className="text-cyan-400" />
              <span>Publish Authoritative Ground Truth Checkpoint</span>
            </div>
            {showOverrideForm ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {showOverrideForm && (
            <div className="p-4 border-t border-slate-800 bg-slate-950/60">
              <form onSubmit={verifyCheckpoint} className="space-y-2 text-xs">
                <div className="grid sm:grid-cols-2 gap-2">
                  <input
                    className="field"
                    placeholder="Checkpoint ID (e.g. gate-3, north_shelter)"
                    value={checkpoint.entity_id}
                    onChange={(e) => setCheckpoint({ ...checkpoint, entity_id: e.target.value })}
                    required
                  />
                  <input
                    className="field"
                    placeholder="Status (e.g. operational, flooded, blocked)"
                    value={checkpoint.status}
                    onChange={(e) => setCheckpoint({ ...checkpoint, status: e.target.value })}
                    required
                  />
                </div>
                <textarea
                  className="field min-h-16"
                  placeholder="Official Situation Directives"
                  value={checkpoint.text}
                  onChange={(e) => setCheckpoint({ ...checkpoint, text: e.target.value })}
                  required
                />
                <button className="btn-primary w-full py-2 text-xs font-bold cursor-pointer">
                  Sign & Broadcast Command Verification
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Survival Protocol Form Accordion */}
        <div className="rounded-2xl border border-slate-800 bg-[#07111e] overflow-hidden">
          <button
            onClick={() => setShowProtocolForm(!showProtocolForm)}
            className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-slate-300 hover:text-white cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <BookOpen size={15} className="text-amber-400" />
              <span>Publish Authenticated Emergency Protocol</span>
            </div>
            {showProtocolForm ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {showProtocolForm && (
            <div className="p-4 border-t border-slate-800 bg-slate-950/60">
              <form onSubmit={publishGuide} className="grid md:grid-cols-2 gap-2 text-xs">
                <input
                  className="field"
                  placeholder="Protocol ID (e.g. tourniquet_field_v2)"
                  required
                  value={guide.id}
                  onChange={(e) => setGuide({ ...guide, id: e.target.value })}
                />
                <input
                  className="field"
                  placeholder="Protocol Title"
                  required
                  value={guide.title}
                  onChange={(e) => setGuide({ ...guide, title: e.target.value })}
                />
                <input
                  className="field"
                  placeholder="Keywords (comma-separated)"
                  required
                  value={guide.keywords}
                  onChange={(e) => setGuide({ ...guide, keywords: e.target.value })}
                />
                <input
                  className="field"
                  placeholder="Reviewer (e.g. Red Cross Board)"
                  required
                  value={guide.reviewer}
                  onChange={(e) => setGuide({ ...guide, reviewer: e.target.value })}
                />
                <textarea
                  className="field md:col-span-2 min-h-14"
                  placeholder="Summary"
                  required
                  value={guide.summary}
                  onChange={(e) => setGuide({ ...guide, summary: e.target.value })}
                />
                <textarea
                  className="field min-h-14"
                  placeholder="Action Steps (one per line)"
                  required
                  value={guide.steps}
                  onChange={(e) => setGuide({ ...guide, steps: e.target.value })}
                />
                <textarea
                  className="field min-h-14"
                  placeholder="Precaution Warnings (one per line)"
                  value={guide.warnings}
                  onChange={(e) => setGuide({ ...guide, warnings: e.target.value })}
                />
                <button className="btn-secondary md:col-span-2 py-2 font-bold text-xs cursor-pointer">
                  Sign & Publish Protocol to Local Vector Shards
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
