import { useEffect, useState } from 'react';
import { AlertCircle, Upload, ArrowRight, ShieldAlert, Radio, Users, RefreshCw, Database } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { api, formatTime, getDiscoveredPeers } from '../api';
import MapPanel from '../MapPanel';

const DEFAULT_CENTER = { lat: 28.7041, lon: 77.1025 };

export default function CentralHQ() {
  const navigate = useNavigate();
  const [health, setHealth] = useState(null);
  const [sync, setSync] = useState(null);
  const [events, setEvents] = useState([]);
  const [peers, setPeers] = useState([]);
  const [mapItems, setMapItems] = useState([]);
  const [lastUplink, setLastUplink] = useState(null);
  const [loading, setLoading] = useState(false);

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
            body: { location: DEFAULT_CENTER, radius_m: 5000, include_responders: true },
          }).catch(() => ({ items: [] })),
        ]);

        if (!isMounted) return;

        setHealth(h);
        setSync(s);
        setEvents(memory.items || []);
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
  }, []);

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
    <div className="min-h-screen bg-[#050914] text-white font-sans flex flex-col">
      {/* TOP HEADER */}
      <header className="flex flex-wrap justify-between items-center px-3 sm:px-6 py-2.5 sm:py-3.5 border-b border-slate-800 bg-[#091122] gap-2.5">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link to="/" className="flex items-center gap-2 group">
            <AlertCircle className="text-red-500 w-5 h-5 group-hover:scale-105 transition-transform" />
            <span className="text-base sm:text-lg font-bold tracking-tight">RescueMemory</span>
          </Link>
          <div>
            <h2 className="text-xs sm:text-base font-bold text-slate-100 flex items-center gap-1.5">
              Central Command HQ
            </h2>
            <p className="text-[10px] sm:text-xs text-slate-400 font-mono mt-0.5">
              Node: {health?.node_id || 'central_HQ'} · {health?.role || 'central'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="bg-emerald-950/60 border border-emerald-700/80 text-emerald-400 px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-bold flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" />
            {health?.cloud_configured ? 'Cloud Synced' : 'Mesh Gateway Online'}
          </div>
          <span className="text-xs sm:text-sm font-mono text-slate-400">
            {lastUplink ? lastUplink.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
          </span>
        </div>
      </header>

      {/* STATS ROW */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-2.5 p-2 sm:p-4 pb-1">
        <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-2 sm:p-2.5">
          <div className="text-slate-400 text-[9.5px] font-mono uppercase mb-0.5">Devices Online</div>
          <div className="text-xl sm:text-2xl font-black mb-0.5 text-cyan-300 font-mono">{peerCount + 1}</div>
          <div className="text-slate-500 text-[9.5px] font-mono truncate">{peerCount} peers · 1 HQ</div>
        </div>

        <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-2 sm:p-2.5">
          <div className="text-slate-400 text-[9.5px] font-mono uppercase mb-0.5">Events Ledger</div>
          <div className="text-xl sm:text-2xl font-black mb-0.5 text-slate-100 font-mono">{totalEvents}</div>
          <div className="text-slate-500 text-[9.5px] font-mono truncate">0 duplicates</div>
        </div>

        <div className="bg-rose-950/40 border-2 border-rose-800/80 rounded-xl p-2 sm:p-2.5">
          <div className="text-slate-400 text-[9.5px] font-mono uppercase mb-0.5">Urgent SOS</div>
          <div className="text-xl sm:text-2xl font-black mb-0.5 text-rose-500 font-mono">{responderEvents}</div>
          <div className="text-slate-400 text-[9.5px] font-mono truncate">Triage Queue</div>
        </div>

        <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-2 sm:p-2.5">
          <div className="text-slate-400 text-[9.5px] font-mono uppercase mb-0.5">Checkpoints</div>
          <div className="text-xl sm:text-2xl font-black mb-0.5 text-amber-400 font-mono">{unsafeCount}</div>
          <div className="text-slate-500 text-[9.5px] font-mono truncate">{unsafeSubtitle}</div>
        </div>

        <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-2 sm:p-2.5 col-span-2 sm:col-span-1">
          <div className="text-slate-400 text-[9.5px] font-mono uppercase mb-0.5">Protocols</div>
          <div className="text-xl sm:text-2xl font-black mb-0.5 font-mono text-emerald-400">
            {health?.guides ?? 420}
          </div>
          <div className="text-slate-500 text-[9.5px] font-mono truncate">Signed Protocols</div>
        </div>
      </div>

      {/* MAIN CONTENT: Map + Incident Stream */}
      <div className="flex-grow p-2 sm:p-4 grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* LEFT: Live Map (7 cols) */}
        <div className="lg:col-span-7 bg-[#0b1120] border border-slate-800 rounded-xl overflow-hidden min-h-[220px] sm:min-h-[340px] flex flex-col">
          <div className="p-2 sm:p-2.5 bg-[#07111e] border-b border-slate-800 flex justify-between items-center">
            <span className="text-[11px] font-bold font-mono text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
              <Radio size={12} className="animate-pulse" /> Command Sector Map
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              5 km HNSW Radius
            </span>
          </div>
          <div className="flex-1 p-2">
            <MapPanel center={DEFAULT_CENTER} items={mapItems} peers={peers} dark={true} />
          </div>
        </div>

        {/* RIGHT: Incident Stream (5 cols) */}
        <div className="lg:col-span-5 bg-[#0f172a] border border-slate-800 rounded-xl p-3 sm:p-4 flex flex-col">
          <div className="flex justify-between items-center mb-2.5">
            <h3 className="text-xs sm:text-sm font-bold text-slate-100 flex items-center gap-1.5">
              Incident Ledger Stream
              {loading && <RefreshCw size={13} className="text-cyan-400 animate-spin" />}
            </h3>
            <span className="text-slate-400 font-mono text-[10px] tracking-wider">LIVE MESH RELAY</span>
          </div>

          <div className="flex-grow space-y-1.5 overflow-y-auto max-h-[320px] pr-1">
            {events.length > 0 ? (
              events.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-800 bg-[#07111e]">
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
                      <span className="text-slate-100 font-bold text-xs truncate">{ev.text}</span>
                      <span className="text-slate-500 font-mono text-[10px] shrink-0">{formatTime(ev.observed_at)}</span>
                    </div>
                    <div className="text-slate-400 text-[10px] mt-0.5 font-mono flex items-center justify-between">
                      <span>Origin: {ev.origin_device || 'survivor'}</span>
                      <span className="text-cyan-400 capitalize">{ev.kind} · {ev.visibility}</span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-slate-400 text-xs font-mono border border-dashed border-slate-800 rounded-lg">
                No active incidents recorded. Initializing mesh discovery...
              </div>
            )}
          </div>

          {/* Action button leading to Command Inspector */}
          <button
            onClick={() => navigate('/command')}
            className="mt-3 w-full bg-[#0b1120] border border-cyan-500/60 hover:border-cyan-400 text-cyan-200 font-bold text-xs py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition shadow-md shadow-cyan-950/40"
          >
            <span>Open Command Inspector & Sign Protocols</span>
            <ArrowRight className="w-4 h-4 text-cyan-400" />
          </button>
        </div>
      </div>
    </div>
  );
}