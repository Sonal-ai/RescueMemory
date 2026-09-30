import { ArrowRight, Cloud, Cpu, Database, HeartPulse, MapPin, Radio, ShieldAlert, ShieldCheck, Wifi, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Shell } from '../components';
import { useNodeStatus } from '../hooks/useNodeStatus';

export default function ActivationScreen() {
  const { health, sync } = useNodeStatus();
  const count = sync?.local_event_count ?? 0;

  return (
    <Shell
      title="Decentralized Disaster Memory"
      subtitle="Ask locally, report what changed, and exchange knowledge peer-to-peer whenever nearby devices appear."
    >
      {/* Tactical Hero Banner */}
      <div className="hero-panel rounded-2xl overflow-hidden border border-slate-700/80 bg-[#091424] relative min-h-[220px] sm:min-h-[340px] flex items-end shadow-xl">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-40 mix-blend-luminosity"
          style={{ backgroundImage: "url('/background.jpg')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#060b13] via-[#060b13]/85 to-transparent" />
        
        <div className="relative z-10 p-3.5 sm:p-7 max-w-3xl">
          <div className="flex flex-wrap items-center gap-1.5 mb-2 sm:mb-2.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-mono tracking-widest uppercase text-cyan-300 border border-cyan-800/80 bg-cyan-950/70 rounded-full px-2 py-0.5 shadow-sm">
              <Radio size={11} className="animate-pulse" /> Qdrant Edge Mesh
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-mono tracking-widest uppercase text-emerald-300 border border-emerald-800/80 bg-emerald-950/70 rounded-full px-2 py-0.5 shadow-sm">
              <Zap size={11} /> 100% Offline
            </span>
          </div>

          <h2 className="text-xl sm:text-4xl font-black tracking-tight leading-tight text-white">
            When the network dies,<br />
            <span className="bg-gradient-to-r from-red-500 via-rose-400 to-amber-400 bg-clip-text text-transparent">
              memory survives.
            </span>
          </h2>

          <p className="text-slate-300 text-xs sm:text-sm mt-1.5 sm:mt-2.5 max-w-xl leading-snug sm:leading-relaxed">
            Your device runs an embedded, in-process Qdrant Edge vector shard. Instantly query survival first-aid, discover verified shelters, and broadcast emergency SOS reports across local Wi-Fi without internet.
          </p>

          <div className="flex flex-wrap gap-2 mt-3 sm:mt-4">
            <Link
              to="/crisis"
              className="btn-primary text-xs sm:text-sm px-3.5 py-1.5 sm:px-4 sm:py-2 shadow-lg shadow-red-600/30"
            >
              <span>Launch Crisis HUD</span>
              <ArrowRight size={14} />
            </Link>
            <Link
              to="/volunteer"
              className="btn-secondary text-xs sm:text-sm px-3.5 py-1.5 sm:px-4 sm:py-2"
            >
              <span>Volunteer Field Board</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Live Node Telemetry Grid */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-2.5 sm:mt-3.5">
        <div className="stat-card">
          <div className="p-1.5 sm:p-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shrink-0">
            <Database size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-xl font-black text-slate-900 dark:text-slate-100 font-mono">
              {health ? health.guides : '518'}
            </div>
            <p className="text-[9.5px] sm:text-[11px] text-slate-600 dark:text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              Survival Protocols
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-1.5 sm:p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
            <MapPin size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-xl font-black text-slate-900 dark:text-slate-100 font-mono">
              {health ? count : '—'}
            </div>
            <p className="text-[9.5px] sm:text-[11px] text-slate-600 dark:text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              Local Observations
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-1.5 sm:p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
            <Wifi size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-base sm:text-xl font-black text-slate-900 dark:text-slate-100 font-mono">
              {health?.central_configured ? 'Active' : 'Mesh Only'}
            </div>
            <p className="text-[9.5px] sm:text-[11px] text-slate-600 dark:text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              Cloud Sync Uplink
            </p>
          </div>
        </div>
      </div>

      {/* How it Works: 3-Pillar Offline Architecture */}
      <div className="mt-2.5 sm:mt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
        <div className="p-3 sm:p-3.5 rounded-2xl border border-[#dbe6f0] dark:border-slate-800 bg-white dark:bg-[#091424] shadow-xs">
          <div className="p-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 w-fit mb-2">
            <Cpu size={16} />
          </div>
          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">1. In-Process Qdrant Edge</h3>
          <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
            Zero external servers or Docker required. Vector embeddings and HNSW graphs run directly inside local device memory in &lt;15 ms.
          </p>
        </div>

        <div className="p-3 sm:p-3.5 rounded-2xl border border-[#dbe6f0] dark:border-slate-800 bg-white dark:bg-[#091424] shadow-xs">
          <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 w-fit mb-2">
            <Radio size={16} />
          </div>
          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">2. UDP Peer Wi-Fi Relay</h3>
          <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
            Automatically discovers neighboring survivor and medic nodes on local Wi-Fi hotspots, exchanging vector records and casualty statuses peer-to-peer.
          </p>
        </div>

        <div className="p-3 sm:p-3.5 rounded-2xl border border-[#dbe6f0] dark:border-slate-800 bg-white dark:bg-[#091424] shadow-xs">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 w-fit mb-2">
            <ShieldCheck size={16} />
          </div>
          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">3. Cryptographic Provenance</h3>
          <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
            Every disaster observation is cryptographically anchored with an origin device signature, ensuring full data integrity and zero duplicates.
          </p>
        </div>
      </div>

      {/* Security & Scoping Notice */}
      <div className="mt-2.5 sm:mt-3 rounded-xl bg-[#091424] border border-cyan-900/60 p-2.5 sm:p-3 text-[11px] sm:text-xs text-slate-300 flex items-center gap-2 shadow-md">
        <ShieldCheck className="text-cyan-400 shrink-0" size={16} />
        <p className="leading-snug">
          <strong>Privacy by Design:</strong> Hazards and safe water observations propagate publicly across nearby nodes. Sensitive medical SOS requests stay strictly restricted to authorized responder nodes.
        </p>
      </div>
    </Shell>
  );
}
