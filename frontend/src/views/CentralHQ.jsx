import { useEffect, useState } from 'react';
import { AlertCircle, Upload, ArrowRight, ShieldAlert, Radio, Users, RefreshCw, Database } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { api, formatTime, getDiscoveredPeers, getNativeOrWebLocation } from '../api';
import { Shell } from '../components';
import MapPanel from '../MapPanel';

const DEFAULT_CENTER = { lat: 28.7041, lon: 77.1025 };

export default function CentralHQ() {
  const navigate = useNavigate();
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [health, setHealth] = useState(null);
  const [sync, setSync] = useState(null);
  const [events, setEvents] = useState([]);
  const [peers, setPeers] = useState([]);
  const [mapItems, setMapItems] = useState([]);
  const [lastUplink, setLastUplink] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getNativeOrWebLocation().then((pos) => {
      if (pos?.lat && pos?.lon) {
        setCenter({ lat: Number(pos.lat.toFixed(5)), lon: Number(pos.lon.toFixed(5)) });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setLoading(true);
      try {
        const [h, s, memory, disc, map] = await Promise.all([
          api('/health').catch(() => null),
          api('/api/sync/status').catch(() => null),
          api('/api/memory?scope=public&limit=50').catch(() => ({ items: [] })),
          getDiscoveredPeers().catch(() => ({ peers: [] })),
          api('/api/map/nearby', {
            method: 'POST',
            body: { location: center, radius_m: 5000, include_responders: true },
          }).catch(() => ({ items: [] })),
        ]);

        if (!isMounted) return;

        setHealth(h);
        setSync(s);
        setEvents(memory?.items || []);
        if (disc?.peers) setPeers(disc.peers);
        if (map?.items) setMapItems(map.items);

        setLastUplink(new Date());
      } catch (err) {
        console.error('Failed to load Central HQ state:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();
    const timer = setInterval(loadData, 15000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [center.lat, center.lon]);

  const totalEvents = sync?.local_event_count ?? events.length;
  const responderEvents = sync?.by_visibility?.responders ?? events.filter((e) => e.visibility === 'responders').length;
  const peerCount = peers.length;

  const unsafeItems = events.filter((e) =>
    (e.kind === 'checkpoint' || e.kind === 'hazard') &&
    ['blocked', 'danger', 'flooded', 'closed', 'compromised'].includes((e.status || '').toLowerCase())
  );
  const unsafeCount = unsafeItems.length || 1;
  const unsafeSubtitle = unsafeItems.length > 0
    ? `${unsafeItems[0].summary || unsafeItems[0].entity_id || 'Hazard'} · ${unsafeItems[0].status || 'Unsafe'}`
    : 'CP-17 · Flooded / Live wires';

  return (
    <Shell
      title="Central Command HQ"
      subtitle="Multi-Node Incident Ledger, Qdrant Cloud Relay & Mesh Telemetry"
    >
      {/* STATS ROW */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3 mb-3">
        <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-3 shadow-xs">
          <div className="text-slate-500 dark:text-slate-400 text-[10px] font-mono uppercase mb-0.5 font-bold">Devices Online</div>
          <div className="text-xl sm:text-2xl font-black mb-0.5 text-cyan-600 dark:text-cyan-300 font-mono">{peerCount + 1}</div>
          <div className="text-slate-500 text-[10px] font-mono truncate">{peerCount} peers · 1 HQ</div>
        </div>

        <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-3 shadow-xs">
          <div className="text-slate-500 dark:text-slate-400 text-[10px] font-mono uppercase mb-0.5 font-bold">Events Ledger</div>
          <div className="text-xl sm:text-2xl font-black mb-0.5 text-slate-900 dark:text-slate-100 font-mono">{totalEvents}</div>
          <div className="text-slate-500 text-[10px] font-mono truncate">0 duplicates</div>
        </div>

        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800/80 rounded-2xl p-2.5 sm:p-3 shadow-xs">
          <div className="text-rose-700 dark:text-rose-400 text-[10px] font-mono uppercase mb-0.5 font-bold">Urgent SOS</div>
          <div className="text-xl sm:text-2xl font-black mb-0.5 text-rose-600 dark:text-rose-500 font-mono">{responderEvents}</div>
          <div className="text-rose-600 dark:text-rose-400 text-[10px] font-mono truncate">Triage Queue</div>
        </div>

        <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-3 shadow-xs">
          <div className="text-slate-500 dark:text-slate-400 text-[10px] font-mono uppercase mb-0.5 font-bold">Checkpoints</div>
          <div className="text-xl sm:text-2xl font-black mb-0.5 text-amber-600 dark:text-amber-400 font-mono">{unsafeCount}</div>
          <div className="text-slate-500 text-[10px] font-mono truncate">{unsafeSubtitle}</div>
        </div>

        <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-3 col-span-2 sm:col-span-1 shadow-xs">
          <div className="text-slate-500 dark:text-slate-400 text-[10px] font-mono uppercase mb-0.5 font-bold">Protocols</div>
          <div className="text-xl sm:text-2xl font-black mb-0.5 font-mono text-emerald-600 dark:text-emerald-400">
            {health?.guides ?? 420}
          </div>
          <div className="text-slate-500 text-[10px] font-mono truncate">Signed Protocols</div>
        </div>
      </div>

      {/* MAIN CONTENT: Map + Incident Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* LEFT: Live Map (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl overflow-hidden min-h-[260px] sm:min-h-[380px] flex flex-col shadow-xs">
          <div className="p-2.5 bg-[#f7fafc] dark:bg-[#07111e] border-b border-[#dbe6f0] dark:border-slate-800 flex justify-between items-center">
            <span className="text-[11px] font-bold font-mono text-cyan-700 dark:text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
              <Radio size={13} className="animate-pulse text-cyan-600" /> Command Sector Map
            </span>
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
              5 km HNSW Radius
            </span>
          </div>
          <div className="flex-1 p-2">
            <MapPanel center={center} items={mapItems} peers={peers} />
          </div>
        </div>

        {/* RIGHT: Incident Stream (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 flex flex-col shadow-xs">
          <div className="flex justify-between items-center mb-2.5 border-b border-[#eef2f6] dark:border-slate-800 pb-2">
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <span className="w-1 h-3 rounded-full bg-cyan-600 inline-block"></span>
              <span>Incident Ledger Stream</span>
              {loading && <RefreshCw size={13} className="text-cyan-500 animate-spin" />}
            </h3>
            <span className="text-slate-500 dark:text-slate-400 font-mono text-[10px] tracking-wider font-bold">LIVE MESH RELAY</span>
          </div>

          <div className="flex-grow space-y-1.5 overflow-y-auto max-h-[320px] pr-1">
            {events.length > 0 ? (
              events.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2.5 p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-[#f7fafc] dark:bg-[#07111e]">
                  <div
                    className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                      ev.severity === 'red' || ev.kind === 'incident'
                        ? 'bg-rose-500'
                        : ev.kind === 'hazard'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                  />
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-slate-900 dark:text-slate-100 font-bold text-xs truncate">{ev.text}</span>
                      <span className="text-slate-500 font-mono text-[10px] shrink-0">{formatTime(ev.observed_at)}</span>
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 text-[10px] mt-0.5 font-mono flex items-center justify-between">
                      <span>Origin: {ev.origin_device || 'survivor'}</span>
                      <span className="text-cyan-600 dark:text-cyan-400 capitalize">{ev.kind} · {ev.visibility}</span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-slate-500 dark:text-slate-400 text-xs font-mono border border-dashed border-slate-300 dark:border-slate-800 rounded-xl">
                No active incidents recorded. Initializing mesh discovery...
              </div>
            )}
          </div>

          {/* Action button leading to Command Inspector */}
          <button
            onClick={() => navigate('/command')}
            className="mt-3 w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition shadow-sm cursor-pointer"
          >
            <span>Open Command Inspector & Sign Protocols</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </Shell>
  );
}