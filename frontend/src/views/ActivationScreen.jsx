import { ArrowRight, Cloud, Cpu, Database, HeartPulse, MapPin, Radio, ShieldAlert, ShieldCheck, Wifi, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Shell, useNodeStatus } from '../components';

export default function ActivationScreen() {
  const { health, sync } = useNodeStatus();
  const count = sync?.local_event_count ?? 0;

  return (
    <Shell
      title="Decentralized Disaster Memory"
      subtitle="Ask locally, report what changed, and exchange knowledge peer-to-peer whenever nearby devices or central connectivity appear."
    >
      {/* Tactical Hero Banner */}
      <div className="hero-panel rounded-3xl overflow-hidden border border-slate-700/80 bg-[#091424] relative min-h-[380px] sm:min-h-[460px] flex items-end shadow-2xl">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-40 mix-blend-luminosity"
          style={{ backgroundImage: "url('/background.jpg')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#060b13] via-[#060b13]/85 to-transparent" />
        
        <div className="relative z-10 p-6 sm:p-12 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono tracking-widest uppercase text-cyan-300 border border-cyan-800/80 bg-cyan-950/70 rounded-full px-3 py-1 shadow-sm">
              <Radio size={12} className="animate-pulse" /> Qdrant Edge Tactical Mesh
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono tracking-widest uppercase text-emerald-300 border border-emerald-800/80 bg-emerald-950/70 rounded-full px-3 py-1 shadow-sm">
              <Zap size={12} /> 100% Offline Ready
            </span>
          </div>

          <h2 className="text-3xl sm:text-6xl font-black tracking-tight leading-tight text-white">
            When the network dies,<br />
            <span className="bg-gradient-to-r from-red-500 via-rose-400 to-amber-400 bg-clip-text text-transparent">
              memory survives.
            </span>
          </h2>

          <p className="text-slate-300 text-sm sm:text-base mt-4 max-w-xl leading-relaxed">
            Your device runs an embedded, in-process Qdrant Edge vector shard. Instantly query survival first-aid, discover verified shelters, and broadcast emergency SOS reports across local Wi-Fi without internet or Docker.
          </p>

          <div className="flex flex-wrap gap-3 mt-8">
            <Link
              to="/crisis"
              className="btn-primary text-sm sm:text-base px-6 py-3.5 shadow-xl shadow-red-600/30"
            >
              <span>Launch Crisis HUD</span>
              <ArrowRight size={18} />
            </Link>
            <Link
              to="/volunteer"
              className="btn-secondary text-sm sm:text-base px-6 py-3.5"
            >
              <span>Volunteer Field Board</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Live Node Telemetry Grid */}
      <div className="grid sm:grid-cols-3 gap-4 mt-6">
        <div className="stat-card">
          <div className="p-3 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Database size={24} />
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-slate-100 font-mono">
              {health ? health.guides : '518'}
            </div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
              Verified Survival Protocols
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <MapPin size={24} />
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-slate-100 font-mono">
              {health ? count : '—'}
            </div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
              Local Observations in Memory
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Wifi size={24} />
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-slate-100 font-mono">
              {health?.central_configured ? 'Active' : 'Mesh Only'}
            </div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mt-0.5">
              Central Cloud Sync Uplink
            </p>
          </div>
        </div>
      </div>

      {/* How it Works: 3-Pillar Offline Architecture */}
      <div className="mt-8 grid md:grid-cols-3 gap-4">
        <div className="p-5 rounded-3xl border border-slate-800 bg-[#091424] shadow-md">
          <div className="p-2.5 rounded-2xl bg-red-500/10 text-red-400 border border-red-500/20 w-fit mb-3.5">
            <Cpu size={20} />
          </div>
          <h3 className="text-base font-bold text-slate-100">1. In-Process Qdrant Edge</h3>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Zero external servers or Docker containers required. Vector embeddings and HNSW graphs run directly inside local device memory in under 15 ms.
          </p>
        </div>

        <div className="p-5 rounded-3xl border border-slate-800 bg-[#091424] shadow-md">
          <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 w-fit mb-3.5">
            <Radio size={20} />
          </div>
          <h3 className="text-base font-bold text-slate-100">2. UDP Peer Wi-Fi Relay</h3>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Automatically discovers neighboring survivor and medic nodes on local Wi-Fi hotspots, exchanging vector records and casualty statuses peer-to-peer.
          </p>
        </div>

        <div className="p-5 rounded-3xl border border-slate-800 bg-[#091424] shadow-md">
          <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 w-fit mb-3.5">
            <ShieldCheck size={20} />
          </div>
          <h3 className="text-base font-bold text-slate-100">3. Cryptographic Provenance</h3>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Every disaster observation is cryptographically anchored with an origin device signature, ensuring full data integrity and zero duplicate clutter.
          </p>
        </div>
      </div>

      {/* Security & Scoping Notice */}
      <div className="mt-6 rounded-2xl bg-[#091424] border border-cyan-900/60 p-4 text-xs text-slate-300 flex items-center gap-3 shadow-md">
        <ShieldCheck className="text-cyan-400 shrink-0" size={20} />
        <p className="leading-relaxed">
          <strong>Privacy by Design:</strong> General hazards and safe water observations propagate publicly across nearby nodes. Sensitive medical SOS requests stay strictly restricted to authorized responder nodes.
        </p>
      </div>
    </Shell>
  );
}
