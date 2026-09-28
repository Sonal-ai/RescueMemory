import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CloudUpload, RefreshCw, Radio, ShieldCheck, Users } from 'lucide-react';
import { api, formatTime, setting } from '../api';
import { Card, Empty, Shell } from '../components';
import MapPanel from '../MapPanel';

const CENTER = { lat: 28.7041, lon: 77.1025 };

export default function VolunteerBoard() {
  const [center, setCenter] = useState(CENTER);
  const [scope, setScope] = useState('public');
  const [items, setItems] = useState([]);
  const [mapUpdatedAt, setMapUpdatedAt] = useState(null);
  const [status, setStatus] = useState(null);
  const [selected, setSelected] = useState(null);
  const [provenance, setProvenance] = useState(null);
  const [working, setWorking] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const groupId = scope === 'group' ? setting('groupId') : '';
      const [map, sync] = await Promise.all([
        api('/api/map/nearby', { method: 'POST', group: Boolean(groupId), responder: scope === 'responders',
          body: { location: center, radius_m: 5000,
            ...(groupId ? { group_id: groupId } : {}),
            include_responders: scope === 'responders' } }),
        api('/api/sync/status'),
      ]);
      const matching = map.items.filter((item) => item.visibility === scope);
      setItems(matching); setStatus(sync); setMapUpdatedAt(new Date()); setError('');
    } catch (err) { setError(err.message); }
  }, [scope, center]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  const useGps = () => {
    if (!navigator.geolocation) { setError('GPS is unavailable. The map remains on its current center.'); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => setCenter({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => setError('Location permission or secure HTTPS is required.'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const inspect = async (item) => {
    setSelected(item); setProvenance(null);
    try {
      const groupId = item.visibility === 'group' ? setting('groupId') : '';
      const path = `/api/provenance/${item.id}${groupId ? `?group_id=${encodeURIComponent(groupId)}` : ''}`;
      setProvenance(await api(path, { group: Boolean(groupId), responder: item.visibility === 'responders' }));
    } catch (err) { setError(err.message); }
  };

  const exchange = async (action) => {
    setWorking(action); setError(''); setResult(null);
    try {
      const peerUrl = setting('peerUrl');
      if (action !== 'global' && !peerUrl) throw new Error('Set a nearby node URL in Node settings first.');
      if (!setting('adminKey')) throw new Error('Set the local node admin key in Node settings first.');
      let path = '/api/sync/peer';
      let body = { peer_url: peerUrl };
      if (action === 'group') {
        if (!setting('groupId')) throw new Error('Join a group first.');
        body.group_id = setting('groupId');
      }
      if (action === 'responders') body.responder = true;
      if (action === 'sos') path = '/api/sync/sos-uplink';
      if (action === 'global') { path = '/api/sync/global'; body = undefined; }
      const response = await api(path, { method: 'POST', admin: true, body });
      setResult(response); refresh();
    } catch (err) { setError(err.message); }
    finally { setWorking(''); }
  };

  return <Shell title="Volunteer field board" subtitle="Collect nearby reports, relay them across local nodes, and upload to command when a connection returns.">
    {error && <div role="alert" className="mb-5 p-4 rounded-xl border border-red-800 bg-red-950/40 text-red-200">{error}</div>}
    <div className="grid sm:grid-cols-3 gap-4 mb-5">
      <div className="stat-card"><Radio className="text-cyan-400" /><div><div className="text-2xl font-bold">{status?.local_event_count ?? '—'}</div><p>Locally stored reports</p></div></div>
      <div className="stat-card"><Users className="text-amber-400" /><div><div className="text-2xl font-bold">{status?.by_visibility?.group ?? '—'}</div><p>Group reports</p></div></div>
      <div className="stat-card"><ShieldCheck className="text-rose-400" /><div><div className="text-2xl font-bold">{status?.by_visibility?.responders ?? '—'}</div><p>Responder records</p></div></div>
    </div>
    <div className="grid xl:grid-cols-[1.3fr_.7fr] gap-5">
      <Card title="Nearby memory">
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          {['public', 'group', 'responders'].map((value) => <button key={value} onClick={() => { setScope(value); setSelected(null); }} className={`text-sm px-3 py-2 rounded-lg ${scope === value ? 'bg-cyan-950 border border-cyan-500 text-cyan-200' : 'bg-slate-900 border border-slate-700 text-slate-400'}`}>{value}</button>)}
          <button onClick={useGps} className="ml-auto text-cyan-300 flex items-center gap-1 text-sm">My location</button>
          <button onClick={refresh} className="text-cyan-300 flex items-center gap-1 text-sm"><RefreshCw size={15} /> Refresh</button>
        </div>
        <p className="text-xs text-slate-400 mb-2">{items.filter((item) => item.kind === 'presence').length} people requesting contact · local memory refreshes every 30 s{mapUpdatedAt ? ` · updated ${mapUpdatedAt.toLocaleTimeString()}` : ''}</p>
        <MapPanel center={center} items={items} onMarker={inspect} />
        <div className="mt-4 space-y-2 max-h-72 overflow-auto">
          {items.length ? items.map((item) => <button key={item.id} onClick={() => inspect(item)} className={`w-full text-left border p-3 rounded-xl ${selected?.id === item.id ? 'border-cyan-500 bg-cyan-950/30' : 'border-slate-700 bg-slate-900'}`}><div className="font-semibold capitalize text-sm">{item.kind} · {item.status || item.severity}</div><div className="text-sm text-slate-300 mt-1">{item.text}</div><div className="text-xs text-slate-500 mt-1">{item.distance_m} m · {formatTime(item.observed_at)} · {item.origin_device}</div></button>) : <Empty>No visible reports in this scope. Group and responder scopes require their keys in Node settings.</Empty>}
        </div>
      </Card>
      <div className="space-y-5">
        <Card title="Exchange memory"><p className="text-sm text-slate-400 mb-3">Nearby transport uses local HTTP over Wi-Fi or hotspot. Internet is only required for central sync.</p><p className="text-xs text-slate-500 mb-4">Peer: {setting('peerUrl') || 'Set nearby node URL in settings'}</p>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={Boolean(working)} onClick={() => exchange('public')} className="btn-secondary flex items-center justify-center gap-2"><Radio size={16} /> Public</button>
            <button disabled={Boolean(working)} onClick={() => exchange('group')} className="btn-secondary flex items-center justify-center gap-2"><Users size={16} /> Group</button>
            <button disabled={Boolean(working)} onClick={() => exchange('responders')} className="btn-secondary flex items-center justify-center gap-2"><ShieldCheck size={16} /> Responders</button>
            <button disabled={Boolean(working)} onClick={() => exchange('sos')} className="btn-secondary flex items-center justify-center gap-2"><ArrowUpRight size={16} /> SOS uplink</button>
          </div>
          <button disabled={Boolean(working)} onClick={() => exchange('global')} className="btn-primary w-full mt-3 flex justify-center gap-2 items-center"><CloudUpload size={17} /> {working ? 'Exchanging…' : 'Sync with central memory'}</button>
          {result && <pre className="text-xs text-emerald-300 bg-slate-950 rounded-lg p-3 overflow-auto mt-3 max-h-40">{JSON.stringify(result, null, 2)}</pre>}
        </Card>
        <Card title="Known journey">{provenance ? <div><div className="text-sm text-slate-300 mb-3">Known on: {provenance.known_nodes.join(' → ')}</div><div className="space-y-2">{provenance.hops.length ? provenance.hops.map((hop) => <div key={hop.id} className="border-l-2 border-cyan-500 pl-3 text-sm"><span className="font-semibold">{hop.from_node} → {hop.to_node}</span><div className="text-xs text-slate-500">{formatTime(hop.synced_at)}</div></div>) : <Empty>No transfer recorded yet. This observation may exist only on this node.</Empty>}</div></div> : <Empty>Select a report to inspect its known hops and holders.</Empty>}</Card>
      </div>
    </div>
  </Shell>;
}
