import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  CloudUpload,
  Database,
  GitBranch,
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
        <div role="alert" className="mb-6 p-4 rounded-2xl border border-red-800/80 bg-red-950/40 text-red-200 text-sm shadow-md">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="mb-6 p-4 rounded-2xl border border-emerald-800/80 bg-emerald-950/40 text-emerald-200 text-sm flex items-center gap-2.5 shadow-md">
          <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />
          <span>{message}</span>
        </div>
      )}

      {/* Telemetry Stat Cards */}
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <div className="stat-card">
          <div className="p-3 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Database size={24} />
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-slate-100 font-mono">
              {sync?.local_event_count ?? '—'}
            </div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
              Local Observations
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <BookOpen size={24} />
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-slate-100 font-mono">
              {guides.length || '—'}
            </div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
              Signed Reference Protocols
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CloudUpload size={24} />
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-slate-100 font-mono">
              {health?.cloud_configured ? 'Connected' : 'Local Standalone'}
            </div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
              Qdrant Cloud Mirror
            </p>
          </div>
        </div>
      </div>

      <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-6">
        {/* Left Column: Public Memory Feed */}
        <Card title="Public Memory Feed">
          <div className="flex justify-between items-center gap-2 mb-3 text-xs text-slate-400 font-mono">
            <span>Authoritative and peer observations in memory</span>
            <button className="text-cyan-300 hover:underline flex items-center gap-1 font-bold font-sans" onClick={refresh}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          <div className="max-h-[560px] overflow-auto space-y-2.5 pr-1">
            {events.length ? (
              events.map((event) => (
                <button
                  key={event.id}
                  onClick={() => inspect(event)}
                  className={`w-full text-left rounded-2xl border p-4 transition-all ${
                    selected?.id === event.id
                      ? 'border-cyan-500 bg-cyan-950/40 shadow-sm'
                      : 'border-slate-800 bg-[#07111e] hover:border-slate-700'
                  }`}
                >
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-sm font-bold capitalize text-slate-100">
                      {event.kind} · {event.status || event.severity}
                    </span>
                    {event.verified && (
                      <span className="text-[10px] text-emerald-300 border border-emerald-700/60 bg-emerald-950/80 px-2 py-0.5 rounded-full flex items-center gap-1 font-mono font-bold">
                        <ShieldCheck size={12} /> VERIFIED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 mt-2 leading-relaxed">{event.text}</p>
                  <div className="text-[10px] text-slate-500 mt-2 font-mono flex items-center justify-between">
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
        <div className="space-y-6">
          <Card title="Cryptographic Provenance Ripple">
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-wider mb-3">
              <GitBranch size={15} /> Event Transfer Lineage
            </div>
            {journey ? (
              <div className="text-xs">
                <p className="text-slate-200 mb-3 bg-[#07111e] p-3 rounded-xl border border-slate-800 leading-relaxed">
                  {journey.event.text}
                </p>
                <div className="text-[11px] text-slate-400 mb-3 font-mono">
                  Chain: {journey.known_nodes.join(' → ')}
                </div>
                <div className="space-y-2">
                  {journey.hops.length ? (
                    journey.hops.map((hop) => (
                      <div key={hop.id} className="border-l-2 border-cyan-500 pl-3 py-1">
                        <strong className="text-slate-100">{hop.from_node} → {hop.to_node}</strong>
                        <p className="text-[10px] text-slate-500 font-mono">{formatTime(hop.synced_at)}</p>
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
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-slate-300 font-bold">{timeline.entity_id}</span>
                  {timeline.conflict ? (
                    <span className="text-[10px] font-bold text-amber-300 bg-amber-950/80 border border-amber-700/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <ShieldAlert size={12} /> Conflict Detected
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-700/60 px-2 py-0.5 rounded-full">
                      Consistent State
                    </span>
                  )}
                </div>

                <div className="rounded-xl p-3 bg-[#07111e] border border-slate-800 text-xs mb-3 flex items-center justify-between">
                  <span className="text-slate-400">Effective Operational State:</span>
                  <strong className="uppercase text-amber-400 font-mono">{timeline.effective?.status || 'unknown'}</strong>
                </div>

                {timeline.alternative_recommendation && (
                  <div className="rounded-2xl p-4 mb-3 bg-gradient-to-r from-emerald-950/60 to-[#07111e] border border-emerald-500/80 text-emerald-200 shadow-md">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                        <Zap size={14} /> Qdrant Safe Alternative
                      </span>
                      <span className="text-[10px] font-mono text-emerald-300 bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-700/50">
                        Score: {timeline.alternative_recommendation.score}
                      </span>
                    </div>
                    <div className="text-sm font-extrabold text-white mt-1">
                      Reroute recommendation: {timeline.alternative_recommendation.name}
                    </div>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      {timeline.alternative_recommendation.rationale}
                    </p>
                    {timeline.alternative_recommendation.facilities?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2.5">
                        {timeline.alternative_recommendation.facilities.map((fac) => (
                          <span key={fac} className="text-[9px] px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700/50 text-emerald-200 font-mono">
                            {fac}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2 mt-3 pt-3 border-t border-slate-800">
                  {timeline.timeline.map((event) => (
                    <div key={event.id} className="text-xs border-l-2 border-slate-700 pl-3 py-0.5">
                      <strong className="text-slate-200 capitalize">{event.status || event.kind}</strong> ·{' '}
                      <span className="text-slate-400">{event.verified ? 'Command Verified' : 'Field Report'}</span>
                      <div className="text-[10px] text-slate-500 font-mono">{formatTime(event.observed_at)} · {event.origin_device}</div>
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
      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <Card title="Publish Verified Checkpoint Override">
          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            Command nodes only. Signs an authoritative override in the facility timeline to correct ground truth.
          </p>
          <form onSubmit={verifyCheckpoint} className="space-y-3">
            <input
              className="field"
              placeholder="Place ID (e.g. gate-3, cp-17)"
              value={checkpoint.entity_id}
              onChange={(e) => setCheckpoint({ ...checkpoint, entity_id: e.target.value })}
              required
            />
            <textarea
              className="field min-h-24"
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
            <button className="btn-secondary w-full py-3.5">
              Sign & Save Verified Update
            </button>
          </form>
        </Card>

        <Card title="Qdrant Cloud Uplink">
          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            Syncs verified memory between this edge cluster and central Qdrant Cloud when internet connectivity is restored.
          </p>
          <button
            onClick={mirror}
            disabled={working}
            className="btn-primary w-full py-4 flex justify-center items-center gap-2 text-base font-bold"
          >
            <CloudUpload size={18} />
            <span>{working ? 'Syncing with Qdrant Cloud…' : 'Mirror Approved Memory to Cloud'}</span>
          </button>
          {cloudResult && (
            <pre className="text-[11px] text-emerald-300 bg-slate-950/80 p-3 rounded-2xl mt-4 overflow-auto border border-emerald-900/50 font-mono">
              {JSON.stringify(cloudResult, null, 2)}
            </pre>
          )}
        </Card>

        {/* Publish Clinical Protocol */}
        <Card title="Publish New Survival Protocol" className="lg:col-span-2">
          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            Clinical protocols require authenticated reviewer signing. Distributed automatically across edge devices during peer exchange.
          </p>
          <form onSubmit={publishGuide} className="grid md:grid-cols-2 gap-3.5">
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
              className="field md:col-span-2"
              placeholder="Protocol Summary / Directives"
              required
              value={guide.summary}
              onChange={(e) => setGuide({ ...guide, summary: e.target.value })}
            />
            <textarea
              className="field"
              placeholder="Steps (one numbered action per line)"
              required
              value={guide.steps}
              onChange={(e) => setGuide({ ...guide, steps: e.target.value })}
            />
            <textarea
              className="field"
              placeholder="Critical Warnings (one warning per line)"
              value={guide.warnings}
              onChange={(e) => setGuide({ ...guide, warnings: e.target.value })}
            />
            <button className="btn-secondary md:col-span-2 py-3.5 font-bold">
              Sign & Publish Protocol to Local Vector Memory
            </button>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
