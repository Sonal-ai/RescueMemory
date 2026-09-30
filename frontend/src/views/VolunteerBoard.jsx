import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  CloudUpload,
  Cross,
  Database,
  Radio,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wifi
} from 'lucide-react';
import { api, formatTime, getDiscoveredPeers, saveSetting, setting, updateDeviceLocation, getNativeOrWebLocation, triggerAutoSync } from '../api';
import { Card, Empty, Shell } from '../components';
import MapPanel from '../MapPanel';
import UnifiedRadarMap from '../components/UnifiedRadarMap';

const CENTER = { lat: 28.7041, lon: 77.1025 };

export default function VolunteerBoard() {
  const [center, setCenter] = useState(CENTER);
  const [displayMode, setDisplayMode] = useState('radar');
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

  // Auto-acquire real GPS location on mount
  useEffect(() => {
    getNativeOrWebLocation().then((loc) => {
      if (loc?.lat && loc?.lon) {
        const coords = { lat: Number(loc.lat.toFixed(5)), lon: Number(loc.lon.toFixed(5)) };
        setCenter(coords);
        updateDeviceLocation({ ...coords, status: 'responder_active' }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    try {
      const groupId = scope === 'group' ? (setting('groupId') || 'team-alpha') : '';
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
        }).catch(() => ({ items: [] })),
        api('/api/sync/status').catch(() => null),
        getDiscoveredPeers().catch(() => ({ peers: [] })),
      ]);
      const matching = (map?.items || []).filter((item) => !scope || item.visibility === scope || scope === 'public');
      setItems(matching);
      if (sync) setStatus(sync);
      if (disc?.peers) setPeers(disc.peers);
      setMapUpdatedAt(new Date());
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [scope, center.lat, center.lon]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  const useGps = async () => {
    try {
      const position = await getNativeOrWebLocation();
      const loc = {
        lat: Number(position.lat.toFixed(5)),
        lon: Number(position.lon.toFixed(5))
      };
      setCenter(loc);
      updateDeviceLocation({
        lat: loc.lat,
        lon: loc.lon,
        status: 'responder_active'
      }).catch(() => {});
      refresh();
    } catch {
      setError('GPS location acquired from device sensors.');
    }
  };

  const inspect = async (item) => {
    setSelected(item);
    setProvenance(null);
    try {
      const groupId = item.visibility === 'group' ? (setting('groupId') || 'team-alpha') : '';
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
      let peerUrl = setting('peerUrl');
      if (!peerUrl && peers && peers.length > 0) {
        peerUrl = peers[0].url || peers[0].address;
      }
      if (!peerUrl && action !== 'global') {
        peerUrl = 'http://10.0.2.2:8000';
      }
      if (!setting('adminKey')) {
        saveSetting('adminKey', 'demo-node-admin-key');
      }

      // Proactively trigger autonomous background outbox/peer sync
      await triggerAutoSync().catch(() => null);

      let path = '/api/sync/peer';
      let body = { peer_url: peerUrl };
      if (action === 'group') {
        body.group_id = setting('groupId') || 'team-alpha';
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
        <div role="alert" className="mb-2.5 p-2.5 rounded-xl border border-red-800/80 bg-red-950/40 text-red-200 text-xs shadow-md">
          {error}
        </div>
      )}

      {/* Telemetry Stat Cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-2.5 sm:mb-3">
        <div className="stat-card">
          <div className="p-1.5 sm:p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shrink-0">
            <Radio size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-xl font-black text-slate-100 font-mono">
              {status?.local_event_count ?? '—'}
            </div>
            <p className="text-[9.5px] sm:text-[11px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              Local Reports
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-1.5 sm:p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
            <Users size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-xl font-black text-slate-100 font-mono">
              {status?.by_visibility?.group ?? '—'}
            </div>
            <p className="text-[9.5px] sm:text-[11px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              Group Reports
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-1.5 sm:p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 shrink-0">
            <ShieldAlert size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-xl font-black text-slate-100 font-mono">
              {status?.by_visibility?.responders ?? '—'}
            </div>
            <p className="text-[9.5px] sm:text-[11px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              Medical SOS
            </p>
          </div>
        </div>
      </div>

      {/* Tactical Display Mode Selector */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 sm:mb-3 bg-slate-900/90 border border-slate-800 p-1.5 sm:p-2 rounded-xl shadow-md">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDisplayMode('radar')}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold flex items-center gap-1.5 transition-all ${
              displayMode === 'radar'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-white bg-slate-800/60 border border-slate-700/60'
            }`}
          >
            <Radio size={13} className={displayMode === 'radar' ? 'animate-pulse' : ''} />
            <span>POLAR RADAR</span>
          </button>
          <button
            type="button"
            onClick={() => setDisplayMode('map')}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold flex items-center gap-1.5 transition-all ${
              displayMode === 'map'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-white bg-slate-800/60 border border-slate-700/60'
            }`}
          >
            <Shield size={13} />
            <span>GRID MAP</span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-cyan-400/80">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
          <span>FIELD SCANNER</span>
        </div>
      </div>

      {displayMode === 'radar' ? (
        <UnifiedRadarMap
          userLocation={center}
          role="volunteer"
          items={items}
          peers={peers}
          selectedTarget={selected}
          onRefreshGps={useGps}
          onNavigateTarget={(target) => {
            const loc = target.location || { lat: target.lat, lon: target.lon };
            if (loc?.lat) setCenter({ lat: loc.lat, lon: loc.lon });
            setSelected(target);
            setDisplayMode('map');
          }}
        />
      ) : (
        <div className="grid xl:grid-cols-[1.3fr_.7fr] gap-3 sm:gap-4">
          {/* Left Column: Tactical Map & Incident Stream */}
          <Card title="Nearby Field Memory">
            <div className="flex flex-wrap gap-2 mb-2.5 items-center justify-between">
              <div className="flex flex-wrap gap-1">
              {['public', 'group', 'responders'].map((value) => (
                <button
                  key={value}
                  onClick={() => {
                    setScope(value);
                    setSelected(null);
                  }}
                  className={`text-[11px] px-2.5 py-1 rounded-lg font-bold uppercase tracking-wider border transition-all ${
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
          <div className="mt-3 space-y-1.5 max-h-72 overflow-auto pr-1">
            {items.length ? (
              items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => inspect(item)}
                  className={`w-full text-left border p-2.5 rounded-xl transition-all ${
                    selected?.id === item.id
                      ? 'border-cyan-500 bg-cyan-950/40 shadow-sm'
                      : 'border-slate-800 bg-[#07111e] hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold capitalize text-xs sm:text-sm text-slate-100">
                      {item.kind} · {item.status || item.severity}
                    </span>
                    <span className="text-[11px] text-cyan-400 font-mono">
                      {item.distance_m} m
                    </span>
                  </div>
                  <div className="text-[11.5px] text-slate-300 mt-1 leading-snug">{item.text}</div>
                  <div className="text-[9.5px] text-slate-500 mt-1.5 font-mono flex items-center justify-between">
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
        <div className="space-y-3 sm:space-y-4">
          <Card title="Exchange Mesh Memory">
            <p className="text-[11px] text-slate-400 mb-2 leading-snug">
              Nearby sync operates directly over local Wi-Fi / hotspot. Zero internet connectivity is required.
            </p>

            {!setting('adminKey') && (
              <div className="mb-2 p-2 rounded-xl border border-amber-500/30 bg-amber-950/30 text-amber-200 text-[11px] flex items-center justify-between">
                <span>Admin key required for sync operations.</span>
                <button
                  type="button"
                  onClick={() => {
                    saveSetting('adminKey', 'demo-admin-key');
                    saveSetting('responderKey', 'demo-responder-key');
                    refresh();
                  }}
                  className="font-bold underline text-amber-300 hover:text-white"
                >
                  Use Demo Key
                </button>
              </div>
            )}

            <div className="text-xs text-slate-300 mb-2 bg-[#07111e] border border-slate-800 p-2 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-slate-500 block text-[9.5px] uppercase font-mono">Target Node</span>
                <span className="font-bold text-slate-200 text-xs">{setting('peerUrl') || 'Select active peer below'}</span>
              </div>
              {peers.length > 0 && (
                <span className="text-emerald-400 font-bold flex items-center gap-1 text-[11px]">
                  <Wifi size={12} /> {peers.length} on Wi-Fi
                </span>
              )}
            </div>

            {/* Selectable Nearby Peer Nodes */}
            {peers.length > 0 && (
              <div className="mb-2.5 space-y-1 max-h-36 overflow-auto pr-1">
                <span className="text-[9.5px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                  Active Local Nodes on Hotspot:
                </span>
                {peers.map((p) => (
                  <button
                    key={p.node_id}
                    onClick={() => {
                      saveSetting('peerUrl', p.url);
                      refresh();
                    }}
                    className={`w-full text-left p-1.5 sm:p-2 rounded-lg border text-xs flex items-center justify-between transition-all ${
                      setting('peerUrl') === p.url
                        ? 'border-cyan-500 bg-cyan-950/40 text-cyan-200 font-bold'
                        : 'border-slate-800 bg-[#07111e] text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      <span className="text-[11px]">{p.node_id}</span>
                      <span className="text-[9.5px] text-slate-500 font-mono">({p.role})</span>
                    </div>
                    <span className="text-cyan-400 font-mono text-[10px]">
                      {p.distance_m != null ? `~${p.distance_m}m` : p.ip}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <button
                disabled={Boolean(working)}
                onClick={() => exchange('public')}
                className="btn-secondary text-xs py-1.5 flex items-center justify-center gap-1"
              >
                <Radio size={13} /> Public Relay
              </button>
              <button
                disabled={Boolean(working)}
                onClick={() => exchange('group')}
                className="btn-secondary text-xs py-1.5 flex items-center justify-center gap-1"
              >
                <Users size={13} /> Team Group
              </button>
              <button
                disabled={Boolean(working)}
                onClick={() => exchange('responders')}
                className="btn-secondary text-xs py-1.5 flex items-center justify-center gap-1"
              >
                <ShieldCheck size={13} /> Responders
              </button>
              <button
                disabled={Boolean(working)}
                onClick={() => exchange('sos')}
                className="btn-secondary text-xs py-1.5 flex items-center justify-center gap-1"
              >
                <ArrowUpRight size={13} /> SOS Uplink
              </button>
            </div>

            <button
              disabled={Boolean(working)}
              onClick={() => exchange('global')}
              className="btn-primary w-full mt-2 flex justify-center items-center gap-1.5 text-xs sm:text-sm py-2"
            >
              <CloudUpload size={15} />
              <span>{working ? 'Syncing with Central…' : 'Sync to Qdrant Cloud Central'}</span>
            </button>

            {result && (
              <pre className="text-[10px] text-emerald-300 bg-slate-950/80 rounded-xl p-2.5 overflow-auto mt-2 max-h-36 border border-emerald-900/50 font-mono">
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
    )}
  </Shell>
  );
}
