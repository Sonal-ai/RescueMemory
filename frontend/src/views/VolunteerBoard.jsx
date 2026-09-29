import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  CloudUpload,
  Cross,
  Database,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wifi
} from 'lucide-react';
import { api, formatTime, getDiscoveredPeers, saveSetting, setting, updateDeviceLocation } from '../api';
import { Card, Empty, Shell } from '../components';
import MapPanel from '../MapPanel';

const CENTER = { lat: 28.7041, lon: 77.1025 };

export default function VolunteerBoard() {
  const [center, setCenter] = useState(CENTER);
  const [scope, setScope] = useState('public');
  const [items, setItems] = useState([]);
  const [peers, setPeers] = useState([]);
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
      const [map, sync, disc] = await Promise.all([
        api('/api/map/nearby', {
          method: 'POST',
          group: Boolean(groupId),
          responder: scope === 'responders',
          body: {
            location: center,
            radius_m: 5000,
            ...(groupId ? { group_id: groupId } : {}),
            include_responders: scope === 'responders'
          }
        }),
        api('/api/sync/status'),
        getDiscoveredPeers().catch(() => ({ peers: [] })),
      ]);
      const matching = map.items.filter((item) => item.visibility === scope);
      setItems(matching);
      setStatus(sync);
      if (disc?.peers) setPeers(disc.peers);
      setMapUpdatedAt(new Date());
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [scope, center]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  const useGps = () => {
    if (!navigator.geolocation) {
      setError('GPS is unavailable in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = {
          lat: Number(position.coords.latitude.toFixed(5)),
          lon: Number(position.coords.longitude.toFixed(5))
        };
        setCenter(loc);
        updateDeviceLocation({
          lat: loc.lat,
          lon: loc.lon,
          status: 'responder_active'
        }).catch(() => {});
      },
      () => setError('GPS location permission required.'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const inspect = async (item) => {
    setSelected(item);
    setProvenance(null);
    try {
      const groupId = item.visibility === 'group' ? setting('groupId') : '';
      const path = `/api/provenance/${item.id}${groupId ? `?group_id=${encodeURIComponent(groupId)}` : ''}`;
      setProvenance(await api(path, { group: Boolean(groupId), responder: item.visibility === 'responders' }));
    } catch (err) {
      setError(err.message);
    }
  };

  const exchange = async (action) => {
    setWorking(action);
    setError('');
    setResult(null);
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
      if (action === 'global') {
        path = '/api/sync/global';
        body = undefined;
      }
      const response = await api(path, { method: 'POST', admin: true, body });
      setResult(response);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking('');
    }
  };

  return (
    <Shell
      title="Volunteer & Medic Field Board"
      subtitle="Gather nearby survivor reports, relay life-critical data peer-to-peer across hotspots, and uplink to command."
    >
      {error && (
        <div role="alert" className="mb-6 p-4 rounded-2xl border border-red-800/80 bg-red-950/40 text-red-200 text-sm shadow-md">
          {error}
        </div>
      )}

      {/* Telemetry Stat Cards */}
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <div className="stat-card">
          <div className="p-3 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Radio size={24} />
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-slate-100 font-mono">
              {status?.local_event_count ?? '—'}
            </div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
              Locally Stored Reports
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Users size={24} />
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-slate-100 font-mono">
              {status?.by_visibility?.group ?? '—'}
            </div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
              Private Group Reports
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-3 rounded-2xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <ShieldAlert size={24} />
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-slate-100 font-mono">
              {status?.by_visibility?.responders ?? '—'}
            </div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
              Urgent Medical SOS Records
            </p>
          </div>
        </div>
      </div>

      <div className="grid xl:grid-cols-[1.3fr_.7fr] gap-6">
        {/* Left Column: Tactical Map & Incident Stream */}
        <Card title="Nearby Field Memory">
          <div className="flex flex-wrap gap-2 mb-4 items-center justify-between">
            <div className="flex flex-wrap gap-1.5">
              {['public', 'group', 'responders'].map((value) => (
                <button
                  key={value}
                  onClick={() => {
                    setScope(value);
                    setSelected(null);
                  }}
                  className={`text-xs px-3.5 py-1.5 rounded-xl font-bold uppercase tracking-wider border transition-all ${
                    scope === value
                      ? 'bg-cyan-950 border-cyan-500 text-cyan-300 shadow-sm'
                      : 'bg-[#07111e] border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {value} Scope
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={useGps}
                className="text-cyan-300 hover:underline flex items-center gap-1 text-xs font-bold"
              >
                <Cross size={13} /> GPS
              </button>
              <button
                onClick={refresh}
                className="text-cyan-300 hover:underline flex items-center gap-1 text-xs font-bold"
              >
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-400 mb-3 font-mono">
            {items.filter((item) => item.kind === 'presence' || item.kind === 'incident').length} active survivor incidents
            {mapUpdatedAt ? ` • Updated ${mapUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>

          <MapPanel center={center} items={items} peers={peers} onMarker={inspect} />

          {/* Incident Feed */}
          <div className="mt-5 space-y-2 max-h-80 overflow-auto pr-1">
            {items.length ? (
              items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => inspect(item)}
                  className={`w-full text-left border p-3.5 rounded-2xl transition-all ${
                    selected?.id === item.id
                      ? 'border-cyan-500 bg-cyan-950/40 shadow-sm'
                      : 'border-slate-800 bg-[#07111e] hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold capitalize text-sm text-slate-100">
                      {item.kind} · {item.status || item.severity}
                    </span>
                    <span className="text-xs text-cyan-400 font-mono">
                      {item.distance_m} m away
                    </span>
                  </div>
                  <div className="text-xs text-slate-300 mt-1.5 leading-relaxed">{item.text}</div>
                  <div className="text-[10px] text-slate-500 mt-2 font-mono flex items-center justify-between">
                    <span>{formatTime(item.observed_at)}</span>
                    <span>Origin: {item.origin_device}</span>
                  </div>
                </button>
              ))
            ) : (
              <Empty icon={Radio}>
                No reports matching this scope. Note that Group and Responder scopes require their respective keys in Node Settings.
              </Empty>
            )}
          </div>
        </Card>

        {/* Right Column: Peer Synchronization & Provenance Journey */}
        <div className="space-y-6">
          <Card title="Exchange Mesh Memory">
            <p className="text-xs text-slate-400 mb-3 leading-relaxed">
              Nearby sync operates directly over local Wi-Fi / hotspot. Zero internet connectivity is required.
            </p>

            <div className="text-xs text-slate-300 mb-3 bg-[#07111e] border border-slate-800 p-3 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-mono">Target Node</span>
                <span className="font-bold text-slate-200">{setting('peerUrl') || 'Select active peer below'}</span>
              </div>
              {peers.length > 0 && (
                <span className="text-emerald-400 font-bold flex items-center gap-1 text-xs">
                  <Wifi size={13} /> {peers.length} on Wi-Fi
                </span>
              )}
            </div>

            {/* Selectable Nearby Peer Nodes */}
            {peers.length > 0 && (
              <div className="mb-4 space-y-1.5 max-h-40 overflow-auto pr-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Active Local Nodes on Hotspot:
                </span>
                {peers.map((p) => (
                  <button
                    key={p.node_id}
                    onClick={() => {
                      saveSetting('peerUrl', p.url);
                      refresh();
                    }}
                    className={`w-full text-left p-2.5 rounded-xl border text-xs flex items-center justify-between transition-all ${
                      setting('peerUrl') === p.url
                        ? 'border-cyan-500 bg-cyan-950/40 text-cyan-200 font-bold'
                        : 'border-slate-800 bg-[#07111e] text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      <span>{p.node_id}</span>
                      <span className="text-[10px] text-slate-500 font-mono">({p.role})</span>
                    </div>
                    <span className="text-cyan-400 font-mono text-[11px]">
                      {p.distance_m != null ? `~${p.distance_m}m` : p.ip}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={Boolean(working)}
                onClick={() => exchange('public')}
                className="btn-secondary text-xs py-2.5 flex items-center justify-center gap-1.5"
              >
                <Radio size={14} /> Public Relay
              </button>
              <button
                disabled={Boolean(working)}
                onClick={() => exchange('group')}
                className="btn-secondary text-xs py-2.5 flex items-center justify-center gap-1.5"
              >
                <Users size={14} /> Team Group
              </button>
              <button
                disabled={Boolean(working)}
                onClick={() => exchange('responders')}
                className="btn-secondary text-xs py-2.5 flex items-center justify-center gap-1.5"
              >
                <ShieldCheck size={14} /> Responders
              </button>
              <button
                disabled={Boolean(working)}
                onClick={() => exchange('sos')}
                className="btn-secondary text-xs py-2.5 flex items-center justify-center gap-1.5"
              >
                <ArrowUpRight size={14} /> SOS Uplink
              </button>
            </div>

            <button
              disabled={Boolean(working)}
              onClick={() => exchange('global')}
              className="btn-primary w-full mt-3 flex justify-center items-center gap-2 text-sm"
            >
              <CloudUpload size={17} />
              <span>{working ? 'Syncing with Central Memory…' : 'Sync to Qdrant Cloud Central'}</span>
            </button>

            {result && (
              <pre className="text-[11px] text-emerald-300 bg-slate-950/80 rounded-xl p-3 overflow-auto mt-3 max-h-40 border border-emerald-900/50 font-mono">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </Card>

          {/* Cryptographic Provenance Card */}
          <Card title="Cryptographic Provenance">
            {provenance ? (
              <div className="text-xs">
                <div className="text-slate-300 mb-3 bg-[#07111e] p-2.5 rounded-xl border border-slate-800 font-mono">
                  Known Holders: {provenance.known_nodes.join(' → ')}
                </div>
                <div className="space-y-2">
                  {provenance.hops.length ? (
                    provenance.hops.map((hop) => (
                      <div key={hop.id} className="border-l-2 border-cyan-500 pl-3 py-1">
                        <span className="font-bold text-slate-100">{hop.from_node} → {hop.to_node}</span>
                        <div className="text-[10px] text-slate-500 font-mono">{formatTime(hop.synced_at)}</div>
                      </div>
                    ))
                  ) : (
                    <Empty icon={ShieldCheck}>
                      Origin observation held locally on this node.
                    </Empty>
                  )}
                </div>
              </div>
            ) : (
              <Empty icon={ShieldCheck}>
                Tap any observation on the left to inspect its cryptographic hops and provenance history.
              </Empty>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
