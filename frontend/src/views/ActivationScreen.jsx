import {
  Activity,
  ArrowRight,
  Compass,
  Cpu,
  Database,
  Globe,
  HeartPulse,
  Layers,
  MapPin,
  Radio,
  Route as RouteIcon,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  Wifi,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Shell } from '../components';
import { useNodeStatus } from '../hooks/useNodeStatus';

export default function ActivationScreen() {
  const { health, sync } = useNodeStatus();
  const count = sync?.local_event_count ?? 0;

  return (
    <Shell
      title="RescueMemory • Project Overview"
      subtitle="Autonomous Edge Vector Intelligence for Disasters — Zero Servers, Zero Internet, 100% Offline."
    >
      {/* Tactical Hero Banner */}
      <div className="hero-panel rounded-2xl overflow-hidden border border-slate-700/80 bg-[#091424] relative min-h-[260px] sm:min-h-[360px] flex items-end shadow-2xl">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-30 mix-blend-luminosity"
          style={{ backgroundImage: "url('/background.jpg')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#060b13] via-[#060b13]/85 to-transparent" />

        <div className="relative z-10 p-4 sm:p-8 max-w-4xl">
          <div className="flex flex-wrap items-center gap-2 mb-2 sm:mb-3">
            <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono tracking-widest uppercase text-cyan-300 border border-cyan-800/80 bg-cyan-950/80 rounded-full px-2.5 py-0.5 shadow-sm">
              <Radio size={12} className="animate-pulse text-cyan-400" /> Qdrant Edge Shards
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono tracking-widest uppercase text-emerald-300 border border-emerald-800/80 bg-emerald-950/80 rounded-full px-2.5 py-0.5 shadow-sm">
              <Zap size={12} className="text-emerald-400" /> 100% Offline Resilience
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono tracking-widest uppercase text-amber-300 border border-amber-800/80 bg-amber-950/80 rounded-full px-2.5 py-0.5 shadow-sm">
              <Layers size={12} className="text-amber-400" /> Negative Vector Routing
            </span>
          </div>

          <h1 className="text-2xl sm:text-5xl font-black tracking-tight leading-tight text-white">
            When the network dies,<br />
            <span className="bg-gradient-to-r from-red-500 via-rose-400 to-amber-400 bg-clip-text text-transparent">
              memory survives.
            </span>
          </h1>

          <p className="text-slate-300 text-xs sm:text-sm mt-2 sm:mt-3 max-w-2xl leading-relaxed">
            RescueMemory is an edge-native disaster intelligence mesh that embeds in-process Qdrant vector shards directly on survivors' phones and responders' field laptops. Query medical guidance, avoid active hazards using negative vectors, and coordinate rescues over local Wi-Fi without internet.
          </p>

          <div className="flex flex-wrap gap-2.5 mt-4 sm:mt-5">
            <Link
              to="/"
              className="btn-primary text-xs sm:text-sm px-4 py-2 shadow-lg shadow-red-600/30 flex items-center gap-1.5"
            >
              <HeartPulse size={15} />
              <span>Launch Survivor HUD</span>
              <ArrowRight size={14} />
            </Link>
            <Link
              to="/safeplace"
              className="btn-secondary text-xs sm:text-sm px-4 py-2 border-cyan-500/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/10 flex items-center gap-1.5"
            >
              <ShieldCheck size={15} className="text-cyan-400" />
              <span>Safe Evacuation & Negative Routing</span>
            </Link>
            <Link
              to="/volunteer"
              className="btn-secondary text-xs sm:text-sm px-4 py-2 flex items-center gap-1.5"
            >
              <Users size={15} />
              <span>Responder Field Board</span>
            </Link>
            <Link
              to="/command"
              className="btn-secondary text-xs sm:text-sm px-4 py-2 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 flex items-center gap-1.5"
            >
              <Activity size={15} className="text-amber-400" />
              <span>Qdrant Cloud Telemetry</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Live Node Telemetry Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5 mt-3 sm:mt-4">
        <div className="stat-card">
          <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shrink-0">
            <Database size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-lg sm:text-2xl font-black text-slate-900 dark:text-slate-100 font-mono">
              {health ? (health.guides ?? 0) : 419}
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              {health ? 'Signed Protocols' : 'Offline Protocols'}
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
            <MapPin size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-lg sm:text-2xl font-black text-slate-900 dark:text-slate-100 font-mono">
              {health ? count : '—'}
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              Field Observations
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
            <Wifi size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-lg sm:text-2xl font-black text-slate-900 dark:text-slate-100 font-mono">
              P2P Mesh
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              Local Wi-Fi / BLE
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="p-2 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 shrink-0">
            <Globe size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-lg sm:text-2xl font-black text-slate-900 dark:text-slate-100 font-mono">
              Qdrant Cloud
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-400 font-semibold uppercase tracking-wider mt-0.5 truncate">
              Cluster Synced
            </p>
          </div>
        </div>
      </div>

      {/* Subsystem Showcase: The 4 Core Pillars */}
      <div className="mt-4 sm:mt-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Sparkles size={16} className="text-cyan-500" />
            <span>Interactive Subsystems & Features</span>
          </h2>
          <span className="text-[11px] text-slate-500 font-mono">Click to launch any module</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {/* Card 1: Survivor HUD */}
          <Link
            to="/"
            className="group p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#091424] hover:border-red-500/50 hover:shadow-lg transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20">
                  <HeartPulse size={18} />
                </div>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-bold">
                  Survivor
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-red-500 transition-colors">
                Survivor HUD & Offline Triage
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                Emergency conversational AI and instant semantic search over verified medical protocols. Broadcast SOS alerts with GPS coordinates completely offline.
              </p>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-red-600 dark:text-red-400 font-bold">
              <span>Open Survivor HUD</span>
              <ArrowRight size={13} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* Card 2: Safe Evacuation */}
          <Link
            to="/safeplace"
            className="group p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#091424] hover:border-cyan-500/50 hover:shadow-lg transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-500 border border-cyan-500/20">
                  <ShieldCheck size={18} />
                </div>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-bold">
                  Negative Vectors
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-cyan-400 transition-colors">
                Safe Evacuation & Negative Routing
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                Uses Qdrant vector mathematics to match shelters offering your exact needs (water, beds, first aid) while negative vectors steer survivors away from active hazards.
              </p>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-cyan-600 dark:text-cyan-400 font-bold">
              <span>Calculate Safe Route</span>
              <ArrowRight size={13} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* Card 3: Responders Board */}
          <Link
            to="/volunteer"
            className="group p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#091424] hover:border-emerald-500/50 hover:shadow-lg transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  <Users size={18} />
                </div>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                  Medic
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-emerald-400 transition-colors">
                Responder & Medic Field Board
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                Tactical dispatch list prioritizing severe casualties. Features cardinal compass HUD pointing directly to trapped victims, with autonomous peer sync over local hotspot.
              </p>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-bold">
              <span>View Triage Board</span>
              <ArrowRight size={13} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* Card 4: Command HQ */}
          <Link
            to="/hq"
            className="group p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#091424] hover:border-purple-500/50 hover:shadow-lg transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 rounded-xl bg-purple-500/10 text-purple-500 border border-purple-500/20">
                  <Radio size={18} />
                </div>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-bold">
                  Central
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-purple-400 transition-colors">
                Command HQ Incident Ledger
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                Central verification hub for regional incident commanders. Authenticate field reports with cryptographic authority seals and manage tactical mesh teams.
              </p>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-purple-600 dark:text-purple-400 font-bold">
              <span>Open Command Ledger</span>
              <ArrowRight size={13} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* Card 5: Inspector & Cloud Mirror */}
          <Link
            to="/command"
            className="group p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#091424] hover:border-amber-500/50 hover:shadow-lg transition-all flex flex-col justify-between md:col-span-2 lg:col-span-2"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <Activity size={18} />
                </div>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                  Live Proofs
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-amber-400 transition-colors">
                Inspector & Qdrant Cloud Synchronization
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                Real-time technical inspector verifying end-to-end cryptographic proofs, peer vector transfer logs, and live bidirectional mirroring with AWS Qdrant Cloud cluster.
              </p>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-amber-600 dark:text-amber-400 font-bold">
              <span>Inspect Telemetry & Cloud Proofs</span>
              <ArrowRight size={13} className="group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        </div>
      </div>

      {/* How it Works: 3-Tier Offline Architecture */}
      <div className="mt-4 sm:mt-5 p-4 sm:p-5 rounded-2xl border border-[#dbe6f0] dark:border-slate-800 bg-white dark:bg-[#091424] shadow-sm">
        <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-3">
          <Cpu size={16} className="text-cyan-500" />
          <span>3-Tier Architecture: Zero-Internet to Regional Cloud</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
            <div className="p-1.5 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 w-fit mb-2">
              <Cpu size={15} />
            </div>
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">1. On-Device Edge Vectors</h3>
            <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              In-process Qdrant Edge shard runs directly inside device memory. Cosine search across verified protocols in under 15 milliseconds without cellular connection.
            </p>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
            <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-500 border border-cyan-500/20 w-fit mb-2">
              <Radio size={15} />
            </div>
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">2. Tactical Hotspot Mesh</h3>
            <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Nearby phones and laptops automatically discover each other over local Wi-Fi hotspots and BLE beacons, exchanging casualty records peer-to-peer.
            </p>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 w-fit mb-2">
              <Globe size={15} />
            </div>
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">3. Autonomous Cloud Mirror</h3>
            <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Whenever any node reaches internet/cellular data, local SQLite and edge vectors autonomously mirror to Qdrant Cloud for regional coordination.
            </p>
          </div>
        </div>
      </div>

      {/* Security & Scoping Notice */}
      <div className="mt-3 rounded-xl bg-[#091424] border border-cyan-900/60 p-3 text-xs text-slate-300 flex items-center gap-2.5 shadow-md">
        <ShieldCheck className="text-cyan-400 shrink-0" size={18} />
        <p className="leading-snug">
          <strong>Privacy by Design:</strong> Public hazards and safe water checkpoints propagate freely across all nearby civilian nodes. Sensitive emergency medical SOS broadcasts remain strictly scoped to authorized responders.
        </p>
      </div>
    </Shell>
  );
}
