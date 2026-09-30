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
  Zap
} from 'lucide-react';
import { api, formatTime, setting } from '../api';
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

  const refresh = useCallback(async () => {
    try {
      const [h, s, memory, reference] = await Promise.all([
        api('/health'),
        api('/api/sync/status'),
        api('/api/memory?scope=public&limit=100'),
        api('/api/guides'),
      ]);
      setHealth(h);
      setSync(s);
      setEvents(memory.items.slice().reverse());
      setGuides(reference.guides);
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
        api(`/api/provenance/${event.id}`),
        event.entity_id ? api(`/api/entities/${encodeURIComponent(event.entity_id)}`) : Promise.resolve(null),
      ]);
      setJourney(provenance);
      setTimeline(entity);
    } catch (err) {
      setError(err.message);
    }
  };

  const testCloud = async () => {
    setWorking(true);
    setError('');
    setMessage('');
    try {
      if (!setting('adminKey')) throw new Error('Set the central node admin key in Node settings.');
      const res = await api('/api/sync/cloud-status', { admin: true });
      setCloudStatus(res);
      if (res.connected) {
        setMessage(`Connected to Qdrant Cloud! Cluster reachable with ${res.collections?.length || 0} collection(s).`);
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
      if (!setting('adminKey')) throw new Error('Set the central node admin key in Node settings.');
      setCloudResult(await api('/api/sync/cloud-mirror', { method: 'POST', admin: true }));
      setMessage('Cloud synchronization complete. Verified field records successfully mirrored to Qdrant Cloud.');
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
      if (!setting('adminKey')) throw new Error('Set the central node admin key in Node settings.');
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
      setMessage(`Command update recorded in local memory (#${response.event.id.slice(0, 10)}).`);
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
      if (!setting('adminKey')) throw new Error('Set the central node admin key in Node settings.');
      const body = {
        ...guide,
        steps: guide.steps.split('\n').map((s) => s.trim()).filter(Boolean),
        warnings: guide.warnings.split('\n').map((s) => s.trim()).filter(Boolean)
      };
      const response = await api('/api/guides/publish', { method: 'POST', admin: true, body });
      setMessage(`Protocol #${response.id} v${response.version} signed and published to local vector memory.`);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Shell
      title="Command HQ & Vector Inspector"
      subtitle="Inspect local memory state, sign authoritative corrections, and exchange approved records with Qdrant Cloud."
    >
      {error && (
        <div role="alert" className="mb-2.5 p-2.5 rounded-xl border border-red-800/80 bg-red-950/40 text-red-200 text-xs shadow-md">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="mb-2.5 p-2.5 rounded-xl border border-emerald-800/80 bg-emerald-950/40 text-emerald-200 text-xs flex items-center gap-2 shadow-md">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
          <span>{message}</span>
        </div>
      )}

      {!setting('adminKey') && (
        <div className="mb-2.5 p-2 rounded-xl border border-amber-500/30 bg-amber-950/30 text-amber-200 text-[11px] flex items-center justify-between shadow-xs">
          <span>Central Admin Key required for verified overrides & cloud sync.</span>
          <button
            type="button"
            onClick={() => {
              saveSetting('adminKey', 'demo-admin-key');
              refresh();
            }}
            className="font-bold underline text-amber-300 hover:text-white"
          >
            Use Demo Admin Key
          </button>
        </div>
      )}

      {/* Telemetry Stat Cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-2.5 sm:mb-3">
        <div className="stat-card">
          <div className="p-1.5 sm:p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shrink-0">
            <Database size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-xl font-black text-slate-100 font-mono">
              {sync?.local_event_count ?? '—'}
            </div>
            <p className="text-[9.5px] sm:text-[11px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              Observations
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-1.5 sm:p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
            <BookOpen size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-xl font-black text-slate-100 font-mono">
              {guides.length || '—'}
            </div>
            <p className="text-[9.5px] sm:text-[11px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              Protocols
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-1.5 sm:p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
            <CloudUpload size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-xl font-black text-slate-100 font-mono">
              {health?.cloud_configured ? 'Connected' : 'Standalone'}
            </div>
            <p className="text-[9.5px] sm:text-[11px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              Cloud Mirror
            </p>
          </div>
        </div>
      </div>

      <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-3 sm:gap-4">
        {/* Left Column: Public Memory Feed */}
        <Card title="Public Memory Feed">
          <div className="flex justify-between items-center gap-2 mb-2 text-xs text-slate-400 font-mono">
            <span className="text-[11px]">Authoritative and peer observations in memory</span>
            <button className="text-cyan-300 hover:underline flex items-center gap-1 font-bold font-sans text-xs" onClick={refresh}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          <div className="max-h-[480px] overflow-auto space-y-1.5 pr-1">
            {events.length ? (
              events.map((event) => (
                <button
                  key={event.id}
                  onClick={() => inspect(event)}
                  className={`w-full text-left rounded-xl border p-2.5 transition-all ${
                    selected?.id === event.id
                      ? 'border-cyan-500 bg-cyan-950/40 shadow-sm'
                      : 'border-slate-800 bg-[#07111e] hover:border-slate-700'
                  }`}
                >
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-xs sm:text-sm font-bold capitalize text-slate-100">
                      {event.kind} · {event.status || event.severity}
                    </span>
                    {event.verified && (
                      <span className="text-[9px] text-emerald-300 border border-emerald-700/60 bg-emerald-950/80 px-1.5 py-0.5 rounded-full flex items-center gap-1 font-mono font-bold">
                        <ShieldCheck size={11} /> VERIFIED
                      </span>
                    )}
                  </div>
                  <p className="text-[11.5px] text-slate-300 mt-1 leading-snug">{event.text}</p>
                  <div className="text-[9.5px] text-slate-500 mt-1.5 font-mono flex items-center justify-between">
                    <span>Origin: {event.origin_device}</span>
                    <span>{formatTime(event.observed_at)}</span>
                  </div>
                </button>
              ))
            ) : (
              <Empty icon={Database}>No public observations recorded yet.</Empty>
            )}
          </div>
        </Card>

        {/* Right Column: Memory Ripple & Contradiction Radar */}
        <div className="space-y-3 sm:space-y-4">
          <Card title="Cryptographic Provenance Ripple">
            <div className="flex items-center gap-1.5 text-cyan-400 text-[11px] font-bold uppercase tracking-wider mb-2">
              <GitBranch size={13} /> Event Transfer Lineage
            </div>
            {journey ? (
              <div className="text-xs">
                <p className="text-slate-200 mb-2 bg-[#07111e] p-2.5 rounded-xl border border-slate-800 leading-snug text-xs">
                  {journey.event.text}
                </p>
                <div className="text-[10px] text-slate-400 mb-2 font-mono">
                  Chain: {journey.known_nodes.join(' → ')}
                </div>
                <div className="space-y-1.5">
                  {journey.hops.length ? (
                    journey.hops.map((hop) => (
                      <div key={hop.id} className="border-l-2 border-cyan-500 pl-2.5 py-0.5">
                        <strong className="text-slate-100 text-xs">{hop.from_node} → {hop.to_node}</strong>
                        <p className="text-[9.5px] text-slate-500 font-mono">{formatTime(hop.synced_at)}</p>
                      </div>
                    ))
                  ) : (
                    <Empty icon={ShieldCheck}>Only the origin device holds this observation so far.</Empty>
                  )}
                </div>
              </div>
            ) : (
              <Empty icon={GitBranch}>Select a report on the left to inspect its cryptographic hops.</Empty>
            )}
          </Card>

          {/* Contradiction Radar Card */}
          <Card title="Contradiction & Reroute Radar">
            {timeline ? (
              <div className="text-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-slate-300 font-bold text-xs">{timeline.entity_id}</span>
                  {timeline.conflict ? (
                    <span className="text-[9.5px] font-bold text-amber-300 bg-amber-950/80 border border-amber-700/60 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                      <ShieldAlert size={11} /> Conflict Detected
                    </span>
                  ) : (
                    <span className="text-[9.5px] font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-700/60 px-1.5 py-0.5 rounded-full">
                      Consistent State
                    </span>
                  )}
                </div>

                <div className="rounded-xl p-2 bg-[#07111e] border border-slate-800 text-xs mb-2 flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">Effective Operational State:</span>
                  <strong className="uppercase text-amber-400 font-mono text-xs">{timeline.effective?.status || 'unknown'}</strong>
                </div>

                {timeline.alternative_recommendation && (
                  <div className="rounded-xl p-2.5 mb-2 bg-gradient-to-r from-emerald-950/60 to-[#07111e] border border-emerald-500/80 text-emerald-200 shadow-md">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                        <Zap size={12} /> Safe Alternative
                      </span>
                      <span className="text-[9.5px] font-mono text-emerald-300 bg-emerald-900/60 px-1.5 py-0.5 rounded border border-emerald-700/50">
                        Score: {timeline.alternative_recommendation.score}
                      </span>
                    </div>
                    <div className="text-xs font-extrabold text-white mt-1">
                      Reroute recommendation: {timeline.alternative_recommendation.name}
                    </div>
                    <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                      {timeline.alternative_recommendation.rationale}
                    </p>
                    {timeline.alternative_recommendation.facilities?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {timeline.alternative_recommendation.facilities.map((fac) => (
                          <span key={fac} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/60 border border-emerald-700/50 text-emerald-200 font-mono">
                            {fac}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-1.5 mt-2 pt-2 border-t border-slate-800">
                  {timeline.timeline.map((event) => (
                    <div key={event.id} className="text-xs border-l-2 border-slate-700 pl-2.5 py-0.5">
                      <strong className="text-slate-200 capitalize">{event.status || event.kind}</strong> ·{' '}
                      <span className="text-slate-400 text-[11px]">{event.verified ? 'Command Verified' : 'Field Report'}</span>
                      <div className="text-[9.5px] text-slate-500 font-mono">{formatTime(event.observed_at)} · {event.origin_device}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Empty icon={ShieldAlert}>Select a report with a checkpoint reference to inspect its history.</Empty>
            )}
          </Card>
        </div>
      </div>

      {/* Bottom Command Operations */}
      <div className="grid lg:grid-cols-2 gap-3 sm:gap-4 mt-3 sm:mt-4">
        <Card title="Publish Verified Checkpoint Override">
          <p className="text-[11px] text-slate-400 mb-2 leading-snug">
            Command nodes only. Signs an authoritative override in the facility timeline to correct ground truth.
          </p>
          <form onSubmit={verifyCheckpoint} className="space-y-2">
            <input
              className="field"
              placeholder="Place ID (e.g. gate-3, cp-17)"
              value={checkpoint.entity_id}
              onChange={(e) => setCheckpoint({ ...checkpoint, entity_id: e.target.value })}
              required
            />
            <textarea
              className="field min-h-16"
              value={checkpoint.text}
              onChange={(e) => setCheckpoint({ ...checkpoint, text: e.target.value })}
              required
            />
            <input
              className="field"
              placeholder="Status (e.g. blocked, operational, danger)"
              value={checkpoint.status}
              onChange={(e) => setCheckpoint({ ...checkpoint, status: e.target.value })}
              required
            />
            <button className="btn-secondary w-full py-2 text-xs font-bold">
              Sign & Save Verified Update
            </button>
          </form>
        </Card>

        <Card title="Qdrant Cloud Uplink">
          <p className="text-[11px] text-slate-400 mb-2 leading-snug">
            Syncs verified memory between this edge cluster and central Qdrant Cloud when internet connectivity is restored.
          </p>
          <div className="flex gap-2 mb-2">
            <button
              onClick={testCloud}
              disabled={working}
              type="button"
              className="btn-secondary flex-1 py-2 flex justify-center items-center gap-1.5 text-xs font-semibold"
            >
              <Radio size={14} />
              <span>{working ? 'Testing…' : 'Test Connection'}</span>
            </button>
            <button
              onClick={mirror}
              disabled={working}
              type="button"
              className="btn-primary flex-1 py-2 flex justify-center items-center gap-1.5 text-xs font-bold"
            >
              <CloudUpload size={14} />
              <span>{working ? 'Syncing…' : 'Mirror to Cloud'}</span>
            </button>
          </div>
          {cloudStatus && (
            <div className={`p-2.5 rounded-xl border text-[11px] mb-2 font-mono ${
              cloudStatus.connected
                ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                : 'bg-red-950/40 border-red-800/80 text-red-300'
            }`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold">Status: {cloudStatus.connected ? 'ONLINE' : 'OFFLINE'}</span>
                <span>{cloudStatus.collections?.length ?? 0} Collections</span>
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                {cloudStatus.url || cloudStatus.reason || cloudStatus.error}
              </div>
            </div>
          )}
          {cloudResult && (
            <pre className="text-[10px] text-emerald-300 bg-slate-950/80 p-2.5 rounded-xl mt-1.5 overflow-auto border border-emerald-900/50 font-mono">
              {JSON.stringify(cloudResult, null, 2)}
            </pre>
          )}
        </Card>

        {/* Publish Clinical Protocol */}
        <Card title="Publish New Survival Protocol" className="lg:col-span-2">
          <p className="text-[11px] text-slate-400 mb-2 leading-snug">
            Clinical protocols require authenticated reviewer signing. Distributed automatically across edge devices during peer exchange.
          </p>
          <form onSubmit={publishGuide} className="grid md:grid-cols-2 gap-2">
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
              placeholder="Trigger Keywords (comma-separated)"
              required
              value={guide.keywords}
              onChange={(e) => setGuide({ ...guide, keywords: e.target.value })}
            />
            <input
              className="field"
              placeholder="Authorized Reviewer Name"
              required
              value={guide.reviewer}
              onChange={(e) => setGuide({ ...guide, reviewer: e.target.value })}
            />
            <input
              className="field md:col-span-2"
              type="url"
              placeholder="https://who.int/guideline/example"
              required
              value={guide.source}
              onChange={(e) => setGuide({ ...guide, source: e.target.value })}
            />
            <textarea
              className="field md:col-span-2 min-h-14"
              placeholder="Protocol Summary / Directives"
              required
              value={guide.summary}
              onChange={(e) => setGuide({ ...guide, summary: e.target.value })}
            />
            <textarea
              className="field min-h-14"
              placeholder="Steps (one numbered action per line)"
              required
              value={guide.steps}
              onChange={(e) => setGuide({ ...guide, steps: e.target.value })}
            />
            <textarea
              className="field min-h-14"
              placeholder="Critical Warnings (one warning per line)"
              value={guide.warnings}
              onChange={(e) => setGuide({ ...guide, warnings: e.target.value })}
            />
            <button className="btn-secondary md:col-span-2 py-2 font-bold text-xs">
              Sign & Publish Protocol to Local Vector Memory
            </button>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
