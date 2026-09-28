import { useCallback, useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, CloudUpload, Database, GitBranch, RefreshCw, ShieldCheck } from 'lucide-react';
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
  const [checkpoint, setCheckpoint] = useState({ entity_id: 'gate-3', text: 'Gate 3 is closed due to flooding. Use the north shelter.', status: 'blocked' });
  const [guide, setGuide] = useState({ id: '', title: '', keywords: '', summary: '', steps: '', warnings: '', source: '', reviewer: '' });

  const refresh = useCallback(async () => {
    try {
      const [h, s, memory, reference] = await Promise.all([
        api('/health'), api('/api/sync/status'), api('/api/memory?scope=public&limit=100'), api('/api/guides'),
      ]);
      setHealth(h); setSync(s); setEvents(memory.items.slice().reverse()); setGuides(reference.guides);
      setError('');
    } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const inspect = async (event) => {
    setSelected(event); setJourney(null); setTimeline(null);
    try {
      const [provenance, entity] = await Promise.all([
        api(`/api/provenance/${event.id}`),
        event.entity_id ? api(`/api/entities/${encodeURIComponent(event.entity_id)}`) : Promise.resolve(null),
      ]);
      setJourney(provenance); setTimeline(entity);
    } catch (err) { setError(err.message); }
  };

  const mirror = async () => {
    setWorking(true); setError(''); setMessage('');
    try {
      if (!setting('adminKey')) throw new Error('Set the central node admin key in Node settings.');
      setCloudResult(await api('/api/sync/cloud-mirror', { method: 'POST', admin: true }));
      setMessage('Cloud exchange completed. Approved records are now in central memory.'); refresh();
    } catch (err) { setError(err.message); }
    finally { setWorking(false); }
  };

  const verifyCheckpoint = async (event) => {
    event.preventDefault(); setError(''); setMessage('');
    try {
      if (!setting('adminKey')) throw new Error('Set the central node admin key in Node settings.');
      const response = await api('/api/reports', { method: 'POST', admin: true,
        body: { ...checkpoint, kind: 'checkpoint', reporter_id: 'command', visibility: 'public',
          severity: 'red', location: BASE, verified: true } });
      setMessage(`Verified update saved locally: ${response.event.id.slice(0, 12)}…`); refresh();
    } catch (err) { setError(err.message); }
  };

  const publishGuide = async (event) => {
    event.preventDefault(); setError(''); setMessage('');
    try {
      if (!setting('adminKey')) throw new Error('Set the central node admin key in Node settings.');
      const body = { ...guide, steps: guide.steps.split('\n').map((s) => s.trim()).filter(Boolean),
        warnings: guide.warnings.split('\n').map((s) => s.trim()).filter(Boolean) };
      const response = await api('/api/guides/publish', { method: 'POST', admin: true, body });
      setMessage(`Guide ${response.id} version ${response.version} published locally. Sync to distribute it.`);
      refresh();
    } catch (err) { setError(err.message); }
  };

  return <Shell title="Command and memory inspector" subtitle="Inspect what this node knows, publish a verified correction, and exchange approved memory with Qdrant Cloud.">
    {error && <div role="alert" className="mb-5 p-4 rounded-xl border border-red-800 bg-red-950/40 text-red-200">{error}</div>}
    {message && <div role="status" className="mb-5 p-4 rounded-xl border border-emerald-800 bg-emerald-950/40 text-emerald-200 flex gap-2"><CheckCircle2 size={18} />{message}</div>}
    <div className="grid sm:grid-cols-3 gap-4 mb-5">
      <div className="stat-card"><Database className="text-cyan-400" /><div><div className="text-2xl font-bold">{sync?.local_event_count ?? '—'}</div><p>Local observations</p></div></div>
      <div className="stat-card"><BookOpen className="text-amber-400" /><div><div className="text-2xl font-bold">{guides.length || '—'}</div><p>Local guide cards</p></div></div>
      <div className="stat-card"><CloudUpload className="text-emerald-400" /><div><div className="text-2xl font-bold">{health?.cloud_configured ? 'Configured' : 'Not set'}</div><p>Qdrant Cloud link</p></div></div>
    </div>
    <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-5">
      <Card title="Public memory feed">
        <div className="flex justify-between gap-2 mb-4 text-sm text-slate-400"><span>Local view of reports available for public relay</span><button className="text-cyan-300 flex items-center gap-1" onClick={refresh}><RefreshCw size={15} /> Refresh</button></div>
        <div className="max-h-[540px] overflow-auto space-y-2">{events.length ? events.map((event) => <button key={event.id} onClick={() => inspect(event)} className={`w-full text-left rounded-xl border p-4 ${selected?.id === event.id ? 'border-cyan-500 bg-cyan-950/30' : 'border-slate-700 bg-slate-900'}`}><div className="flex justify-between gap-2"><span className="text-sm font-semibold capitalize">{event.kind} · {event.status || event.severity}</span>{event.verified && <span className="text-xs text-emerald-300 flex items-center gap-1"><ShieldCheck size={14} /> Command verified</span>}</div><p className="text-sm text-slate-300 mt-2">{event.text}</p><p className="text-xs text-slate-500 mt-2">{event.origin_device} · {formatTime(event.observed_at)} · {event.id.slice(0, 12)}…</p></button>) : <Empty>No public observations yet.</Empty>}</div>
      </Card>
      <div className="space-y-5">
        <Card title="Memory Ripple"><div className="flex items-center gap-2 text-cyan-300 text-xs uppercase tracking-widest mb-3"><GitBranch size={16} /> Known event journey</div>{journey ? <><p className="text-sm text-slate-300 mb-3">{journey.event.text}</p><div className="text-xs text-slate-400 mb-3">Known nodes: {journey.known_nodes.join(' → ')}</div><div className="space-y-2">{journey.hops.length ? journey.hops.map((hop) => <div key={hop.id} className="border-l-2 border-cyan-500 pl-3 text-sm"><strong>{hop.from_node} → {hop.to_node}</strong><p className="text-xs text-slate-500">{formatTime(hop.synced_at)}</p></div>) : <Empty>Only the origin node is known so far.</Empty>}</div></> : <Empty>Select a report to show its known transfers.</Empty>}</Card>
        <Card title="Contradiction Radar">{timeline ? <><p className="text-sm text-slate-300 mb-2">{timeline.entity_id} · {timeline.conflict ? <span className="text-amber-300">Conflicting observations</span> : 'No conflict recorded'}</p><div className="rounded-lg p-3 bg-slate-900 border border-slate-700 text-sm mb-3">Effective state: <strong>{timeline.effective?.status || 'unknown'}</strong></div><div className="space-y-2">{timeline.timeline.map((event) => <div key={event.id} className="text-xs border-l-2 border-slate-600 pl-3"><strong>{event.status || event.kind}</strong> · {event.verified ? 'command verified' : 'reported'}<div className="text-slate-500">{formatTime(event.observed_at)} · {event.origin_device}</div></div>)}</div></> : <Empty>Select a report with a place ID to inspect its timeline.</Empty>}</Card>
      </div>
    </div>
    <div className="grid lg:grid-cols-2 gap-5 mt-5">
      <Card title="Publish a verified checkpoint update"><p className="text-sm text-slate-400 mb-4">Command nodes only. The new observation is added to the timeline; earlier reports remain visible.</p><form onSubmit={verifyCheckpoint} className="space-y-3"><input className="field" placeholder="Place ID" value={checkpoint.entity_id} onChange={(e) => setCheckpoint({ ...checkpoint, entity_id: e.target.value })} required /><textarea className="field min-h-24" value={checkpoint.text} onChange={(e) => setCheckpoint({ ...checkpoint, text: e.target.value })} required /><input className="field" placeholder="Status, e.g. blocked" value={checkpoint.status} onChange={(e) => setCheckpoint({ ...checkpoint, status: e.target.value })} required /><button className="btn-secondary">Save verified update</button></form></Card>
      <Card title="Central Cloud exchange"><p className="text-sm text-slate-400 mb-4">Cloud is reached by this gateway using its private API key. Devices receive approved updates on their next central or nearby exchange.</p><button onClick={mirror} disabled={working} className="btn-primary w-full flex justify-center items-center gap-2"><CloudUpload size={17} />{working ? 'Exchanging…' : 'Exchange with Qdrant Cloud'}</button>{cloudResult && <pre className="text-xs text-emerald-300 bg-slate-950 p-3 rounded-lg mt-4 overflow-auto">{JSON.stringify(cloudResult, null, 2)}</pre>}</Card>
      <Card title="Publish a reviewed guide" className="lg:col-span-2"><p className="text-sm text-slate-400 mb-4">A team reviewer must check the steps against the linked source before publishing. This authenticated version can travel through nearby peers.</p><form onSubmit={publishGuide} className="grid md:grid-cols-2 gap-3"><input className="field" placeholder="Guide ID" required value={guide.id} onChange={(e) => setGuide({ ...guide, id: e.target.value })} /><input className="field" placeholder="Title" required value={guide.title} onChange={(e) => setGuide({ ...guide, title: e.target.value })} /><input className="field" placeholder="Search keywords" required value={guide.keywords} onChange={(e) => setGuide({ ...guide, keywords: e.target.value })} /><input className="field" placeholder="Reviewer name" required value={guide.reviewer} onChange={(e) => setGuide({ ...guide, reviewer: e.target.value })} /><input className="field md:col-span-2" type="url" placeholder="https://official-source.example/guide" required value={guide.source} onChange={(e) => setGuide({ ...guide, source: e.target.value })} /><textarea className="field md:col-span-2" placeholder="Summary" required value={guide.summary} onChange={(e) => setGuide({ ...guide, summary: e.target.value })} /><textarea className="field" placeholder="One reviewed step per line" required value={guide.steps} onChange={(e) => setGuide({ ...guide, steps: e.target.value })} /><textarea className="field" placeholder="One warning per line" value={guide.warnings} onChange={(e) => setGuide({ ...guide, warnings: e.target.value })} /><button className="btn-secondary md:col-span-2">Publish versioned guide</button></form></Card>
    </div>
  </Shell>;
}
