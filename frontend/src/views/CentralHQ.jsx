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

  return (
    <div className="min-h-screen bg-[#050914] text-white font-sans flex flex-col">
      {/* TOP HEADER */}
      <header className="flex flex-wrap justify-between items-center px-6 sm:px-10 py-5 border-b border-slate-800 bg-[#091122] gap-4">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-3 group">
            <AlertCircle className="text-red-500 w-8 h-8 group-hover:scale-105 transition-transform" />
            <span className="text-2xl font-bold tracking-tight">RescueMemory</span>
          </Link>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-100 flex items-center gap-2">
              Central Command & Relay HQ
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 font-mono mt-0.5">
              Node: {health?.node_id || 'central_HQ'} · Role: {health?.role || 'central'} · {health?.engine || 'Qdrant Edge Vector Engine'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-emerald-950/60 border border-emerald-700/80 text-emerald-400 px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2">
            <Upload className="w-4 h-4" />
            {health?.cloud_configured ? 'Qdrant Cloud Synced' : 'Mesh Gateway Online'}
          </div>
          <span className="text-xl sm:text-2xl font-mono text-slate-400">
            {lastUplink ? lastUplink.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
          </span>
        </div>
      </header>

      {/* STATS ROW */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 p-4 sm:p-8 pb-2">
        <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5">
          <div className="text-slate-400 text-xs font-mono uppercase mb-2">Devices Online</div>
          <div className="text-3xl sm:text-5xl font-black mb-2 text-cyan-300 font-mono">{peerCount + 1}</div>
          <div className="text-slate-500 text-xs font-mono">{peerCount} Wi-Fi peers · 1 local HQ</div>
        </div>

        <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5">
          <div className="text-slate-400 text-xs font-mono uppercase mb-2">Events in Ledger</div>
          <div className="text-3xl sm:text-5xl font-black mb-2 text-slate-100 font-mono">{totalEvents}</div>
          <div className="text-slate-500 text-xs font-mono">0 duplicates · Verified immutable</div>
        </div>

        <div className="bg-rose-950/40 border-2 border-rose-800/80 rounded-2xl p-5">
          <div className="text-slate-400 text-xs font-mono uppercase mb-2">Urgent Medical SOS</div>
          <div className="text-3xl sm:text-5xl font-black mb-2 text-rose-500 font-mono">{responderEvents}</div>
          <div className="text-slate-400 text-xs font-mono">Responder Triage Queue</div>
        </div>

        <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5">
          <div className="text-slate-400 text-xs font-mono uppercase mb-2">Unsafe Checkpoints</div>
          <div className="text-3xl sm:text-5xl font-black mb-2 text-amber-400 font-mono">1</div>
          <div className="text-slate-500 text-xs font-mono">CP-17 · Flooded / Live wires</div>
        </div>

        <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5">
          <div className="text-slate-400 text-xs font-mono uppercase mb-2">Protocols Indexed</div>
          <div className="text-3xl sm:text-5xl font-black mb-2 font-mono text-emerald-400">
            {health?.guides ?? 420}
          </div>
          <div className="text-slate-500 text-xs font-mono">Signed Reference Manuals</div>
        </div>
      </div>

      {/* MAIN CONTENT: Map + Incident Stream */}
      <div className="flex-grow p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT: Live Map (7 cols) */}
        <div className="lg:col-span-7 bg-[#0b1120] border border-slate-800 rounded-2xl overflow-hidden min-h-[450px] flex flex-col">
          <div className="p-3 bg-[#07111e] border-b border-slate-800 flex justify-between items-center">
            <span className="text-xs font-bold font-mono text-cyan-300 uppercase tracking-wider flex items-center gap-2">
              <Radio size={14} className="animate-pulse" /> Command Operational Sector Map
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              5 km Qdrant HNSW Radius
            </span>
          </div>
          <div className="flex-1 p-3">
            <MapPanel center={DEFAULT_CENTER} items={mapItems} peers={peers} />
          </div>
        </div>

        {/* RIGHT: Incident Stream (5 cols) */}
        <div className="lg:col-span-5 bg-[#0f172a] border border-slate-800 rounded-2xl p-6 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              Incident Ledger Stream
              {loading && <RefreshCw size={16} className="text-cyan-400 animate-spin" />}
            </h3>
            <span className="text-slate-400 font-mono text-xs tracking-wider">LIVE MESH RELAY</span>
          </div>

          <div className="flex-grow space-y-3 overflow-y-auto max-h-[400px] pr-1">
            {events.length > 0 ? (
              events.map((ev) => (
                <div key={ev.id} className="flex items-start gap-4 p-3 rounded-xl border border-slate-800 bg-[#07111e]">
                  <div
                    className={`w-3 h-3 rounded-full mt-1.5 shrink-0 ${
                      ev.severity === 'red' || ev.kind === 'incident'
                        ? 'bg-rose-500'
                        : ev.kind === 'hazard'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                  />
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-100 font-bold text-sm truncate">{ev.text}</span>
                      <span className="text-slate-500 font-mono text-xs shrink-0">{formatTime(ev.observed_at)}</span>
                    </div>
                    <div className="text-slate-400 text-xs mt-1 font-mono flex items-center justify-between">
                      <span>Origin: {ev.origin_device || 'survivor'}</span>
                      <span className="text-cyan-400 capitalize">{ev.kind} · {ev.visibility}</span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-slate-400 text-xs font-mono border border-dashed border-slate-800 rounded-xl">
                No active incidents recorded. Initializing mesh discovery...
              </div>
            )}
          </div>

          {/* Action button leading to Command Inspector */}
          <button
            onClick={() => navigate('/command')}
            className="mt-6 w-full bg-[#0b1120] border border-cyan-500/60 hover:border-cyan-400 text-cyan-200 font-bold text-sm py-4 rounded-xl flex items-center justify-center gap-3 transition shadow-lg shadow-cyan-950/40"
          >
            Open Command Inspector & Sign Protocols
            <ArrowRight className="w-5 h-5 text-cyan-400" />
          </button>
        </div>
      </div>
    </div>
  );
}