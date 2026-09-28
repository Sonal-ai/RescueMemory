import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, Cross, Droplets, MapPin, MessageCircle, RefreshCw, ShieldAlert, TriangleAlert, Users } from 'lucide-react';
import { api, formatTime, saveSetting, setting } from '../api';
import { Card, Empty, Shell } from '../components';
import MapPanel from '../MapPanel';

const DEFAULT_CENTER = { lat: 28.7041, lon: 77.1025 };
const TABS = [['ask', 'Ask locally', MessageCircle], ['report', 'Report', ShieldAlert], ['map', 'Nearby map', MapPin], ['group', 'My group', Users]];

export default function SurvivorHUD() {
  const [tab, setTab] = useState('ask');
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [shareLocation, setShareLocation] = useState(false);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [pin, setPin] = useState(DEFAULT_CENTER);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [report, setReport] = useState({ kind: 'hazard', text: '', entity_id: '', status: 'danger', severity: 'yellow', visibility: 'public' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [groupName, setGroupName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [joinToken, setJoinToken] = useState('');

  const refreshMap = useCallback(async () => {
    try {
      const groupId = setting('groupId');
      const result = await api('/api/map/nearby', { method: 'POST', group: Boolean(groupId),
        body: { location: center, radius_m: 5000, ...(groupId ? { group_id: groupId } : {}) } });
      setItems(result.items);
    } catch (err) { setError(err.message); }
  }, [center]);
  useEffect(() => { refreshMap(); }, [refreshMap]);

  const useGps = () => {
    if (!navigator.geolocation) { setError('GPS is unavailable in this browser. Tap the map to place a pin.'); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = { lat: position.coords.latitude, lon: position.coords.longitude };
        setCenter(location); setPin(location); setError('');
      }, () => setError('Location permission or secure HTTPS is required. Tap the map instead.'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const ask = async (event) => {
    event.preventDefault(); setError(''); setChatBusy(true);
    try {
      const groupId = setting('groupId');
      const result = await api('/api/chat', { method: 'POST', group: Boolean(groupId),
        body: { text, survivor_id: setting('reporterId') || 'survivor-1',
          share_location: shareLocation, ...(shareLocation ? { location: pin } : {}),
          ...(groupId ? { group_id: groupId } : {}) } });
      setAnswer(result); if (shareLocation) refreshMap();
    } catch (err) { setError(err.message); }
    finally { setChatBusy(false); }
  };

  const submitReport = async (event) => {
    event.preventDefault(); setError(''); setMessage('');
    try {
      const groupId = setting('groupId');
      const visibility = report.kind === 'incident' ? 'responders' : report.visibility;
      const result = await api('/api/reports', { method: 'POST', group: visibility === 'group',
        body: { ...report, visibility, text: report.text.trim(),
          reporter_id: setting('reporterId') || 'survivor-1', location: pin,
          entity_id: report.entity_id.trim() || null,
          group_id: visibility === 'group' ? groupId : null } });
      setMessage(result.duplicate ? 'This observation is already in local memory.' : `Saved locally as ${result.event.id.slice(0, 12)}…`);
      setReport({ ...report, text: '' }); refreshMap();
    } catch (err) { setError(err.message); }
  };

  const createGroup = async () => {
    try {
      const result = await api('/api/groups', { method: 'POST', body: { name: groupName } });
      saveSetting('groupId', result.group_id); saveSetting('groupToken', result.token);
      setMessage(`Group created. Share ID ${result.group_id} and its token privately with members.`);
    } catch (err) { setError(err.message); }
  };
  const joinGroup = async () => {
    try {
      await api('/api/groups/join', { method: 'POST', body: { group_id: joinId, name: groupName || joinId, token: joinToken } });
      saveSetting('groupId', joinId); saveSetting('groupToken', joinToken);
      setMessage(`Joined group ${joinId}.`); refreshMap();
    } catch (err) { setError(err.message); }
  };

  return <Shell title="Survivor view" subtitle="Ask in your own words. Guidance and observations come from this node's local Qdrant Edge memory.">
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
      {TABS.map(([id, label, Icon]) => <button key={id} onClick={() => { setTab(id); setError(''); setMessage(''); }} className={`rounded-xl border px-3 py-3 text-sm font-semibold flex items-center justify-center gap-2 ${tab === id ? 'bg-red-500/20 border-red-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'}`}><Icon size={17} />{label}</button>)}
    </div>
    {error && <div role="alert" className="mb-5 p-4 rounded-xl border border-red-800 bg-red-950/40 text-red-200">{error}</div>}
    {message && <div role="status" className="mb-5 p-4 rounded-xl border border-emerald-800 bg-emerald-950/40 text-emerald-200 flex items-center gap-2"><CheckCircle2 size={18} />{message}</div>}

    {tab === 'ask' && <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-5">
      <Card title="What do you need to know?">
        <form onSubmit={ask} className="space-y-4">
          <textarea className="field min-h-36" placeholder="Example: Is there clean water near the north gate?" value={text} onChange={(event) => setText(event.target.value)} required minLength={2} />
          <div className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300 flex gap-3"><MapPin className="shrink-0 text-cyan-400" size={19} /><div><div>Search uses this node's local memory. Your question is not copied into a public report.</div><label className="flex items-center gap-2 mt-2 cursor-pointer"><input type="checkbox" checked={shareLocation} onChange={(event) => setShareLocation(event.target.checked)} /> Share my selected location with responders for 2 hours</label></div></div>
          <button disabled={chatBusy} className="btn-primary w-full flex items-center justify-center gap-2">{chatBusy ? 'Searching local memory…' : 'Search local memory'} <ArrowRight size={18} /></button>
        </form>
      </Card>
      <Card title="Retrieved on this node">
        {!answer && <Empty>Ask a question to see locally stored guides and reports.</Empty>}
        {answer && <div className="space-y-4">
          {answer.cards?.length ? answer.cards.slice(0, 3).map((card) => <div key={card.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <div className="flex items-start gap-2"><BookOpen size={18} className="text-cyan-400 shrink-0 mt-1" /><div><h3 className="font-semibold">{card.title}</h3><p className="text-xs text-slate-500 mt-1">{card.review_status === 'team_reviewed' ? `Team reviewed · version ${card.version}` : 'Source-based prototype card'}</p></div></div>
            <p className="text-sm text-slate-300 mt-3">{card.summary}</p>
            {card.steps?.length > 0 && <ol className="list-decimal pl-5 text-sm text-slate-300 mt-3 space-y-1">{card.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
            {card.warnings?.length > 0 && <p className="text-sm text-amber-300 mt-3"><TriangleAlert size={14} className="inline mr-1" />{card.warnings.join(' ')}</p>}
            {card.source && <a href={card.source} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 underline mt-3 inline-block">Open source guidance</a>}
          </div>) : <Empty>No reliable local guide matched. Seek emergency services or a qualified responder.</Empty>}
          {answer.memory_hits?.length > 0 && <div><h3 className="font-semibold mb-2">Related local reports</h3>{answer.memory_hits.map((hit) => <div key={hit.id} className="text-sm p-3 border-l-2 border-cyan-500 bg-slate-900 mb-2"><p>{hit.text}</p><p className="text-xs text-slate-500 mt-1">{hit.kind} · {formatTime(hit.observed_at)} · {hit.origin_device}</p></div>)}</div>}
        </div>}
      </Card>
    </div>}

    {tab === 'report' && <div className="grid lg:grid-cols-[.9fr_1.1fr] gap-5">
      <Card title="Share an observation">
        <form onSubmit={submitReport} className="space-y-4">
          <label className="block text-sm text-slate-300">Report type<select className="field mt-1" value={report.kind} onChange={(event) => setReport({ ...report, kind: event.target.value, visibility: event.target.value === 'incident' ? 'responders' : 'public' })}><option value="hazard">Hazard</option><option value="resource">Resource</option><option value="checkpoint">Checkpoint update</option><option value="incident">Medical SOS — responders only</option></select></label>
          <label className="block text-sm text-slate-300">What happened?<textarea className="field mt-1 min-h-28" value={report.text} onChange={(event) => setReport({ ...report, text: event.target.value })} required minLength={3} placeholder="Describe what you directly observed" /></label>
          <div className="grid sm:grid-cols-2 gap-3"><label className="text-sm text-slate-300">Place ID (optional)<input className="field mt-1" value={report.entity_id} onChange={(event) => setReport({ ...report, entity_id: event.target.value })} placeholder="gate-3" /></label><label className="text-sm text-slate-300">Status<input className="field mt-1" value={report.status} onChange={(event) => setReport({ ...report, status: event.target.value })} placeholder="flooded" /></label></div>
          <div className="grid sm:grid-cols-2 gap-3"><label className="text-sm text-slate-300">Severity<select className="field mt-1" value={report.severity} onChange={(event) => setReport({ ...report, severity: event.target.value })}><option value="yellow">Attention</option><option value="red">Urgent</option><option value="green">Informational</option></select></label><label className="text-sm text-slate-300">Who receives it?<select disabled={report.kind === 'incident'} className="field mt-1" value={report.kind === 'incident' ? 'responders' : report.visibility} onChange={(event) => setReport({ ...report, visibility: event.target.value })}><option value="public">All nearby nodes</option><option value="group">My group</option><option value="responders">Responders only</option></select></label></div>
          <div className="text-xs text-slate-400">Selected pin: {pin.lat.toFixed(5)}, {pin.lon.toFixed(5)}. Tap the grid to change it.</div>
          <button className="btn-primary w-full">Save report in local memory</button>
        </form>
      </Card>
      <Card title="Place the report"><div className="flex justify-end mb-3"><button className="text-sm text-cyan-300 flex items-center gap-1" onClick={useGps}><Cross size={16} /> Use my GPS</button></div><MapPanel center={center} items={items} selected={pin} onSelect={setPin} onMarker={setSelected} /></Card>
    </div>}

    {tab === 'map' && <div className="grid lg:grid-cols-[1.3fr_.7fr] gap-5">
      <Card title="Nearby memory"><div className="flex flex-wrap justify-between gap-2 mb-3"><p className="text-sm text-slate-400">Local observations within 5 km</p><button onClick={refreshMap} className="text-sm text-cyan-300 flex gap-1 items-center"><RefreshCw size={15} /> Refresh</button></div><MapPanel center={center} items={items} onMarker={setSelected} /></Card>
      <Card title="Reports on this node">{items.length ? <div className="max-h-[510px] overflow-auto space-y-2">{items.map((item) => <button key={item.id} onClick={() => setSelected(item)} className={`w-full text-left p-3 rounded-xl border ${selected?.id === item.id ? 'border-cyan-500 bg-cyan-950/30' : 'border-slate-700 bg-slate-900'}`}><div className="flex items-center gap-2 text-sm font-semibold">{item.kind === 'resource' ? <Droplets size={16} className="text-emerald-400" /> : <TriangleAlert size={16} className="text-amber-400" />}{item.kind} · {item.distance_m} m</div><p className="text-sm text-slate-300 mt-1">{item.text}</p><p className="text-xs text-slate-500 mt-1">{formatTime(item.observed_at)} · {item.origin_device}</p></button>)}</div> : <Empty>No nearby local reports yet.</Empty>}</Card>
      {selected && <Card title="Selected observation" className="lg:col-span-2"><p className="text-slate-200">{selected.text}</p><div className="text-xs text-slate-400 mt-2">ID {selected.id} · {formatTime(selected.observed_at)} · {selected.visibility}</div></Card>}
    </div>}

    {tab === 'group' && <div className="grid md:grid-cols-2 gap-5">
      <Card title="Create a local group"><p className="text-sm text-slate-400 mb-4">Group reports move only between nodes joined with the same token.</p><input className="field mb-3" placeholder="Camp Alpha" value={groupName} onChange={(event) => setGroupName(event.target.value)} /><button onClick={createGroup} disabled={!groupName.trim()} className="btn-primary">Create group</button></Card>
      <Card title="Join an existing group"><div className="space-y-3"><input className="field" placeholder="Group ID" value={joinId} onChange={(event) => setJoinId(event.target.value)} /><input className="field" type="password" placeholder="Private group token" value={joinToken} onChange={(event) => setJoinToken(event.target.value)} /><button onClick={joinGroup} disabled={!joinId || !joinToken} className="btn-secondary">Join group</button></div></Card>
      <Card title="Current group" className="md:col-span-2"><p className="text-sm text-slate-300">{setting('groupId') || 'No group configured in this browser tab.'}</p></Card>
    </div>}
  </Shell>;
}
