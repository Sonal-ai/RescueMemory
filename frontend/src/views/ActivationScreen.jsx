import { ArrowRight, Cloud, Database, MapPin, Radio, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Shell, useNodeStatus } from '../components';

export default function ActivationScreen() {
  const { health, sync } = useNodeStatus();
  const count = sync?.local_event_count ?? 0;
  return (
    <Shell title="Memory that moves with people" subtitle="Ask locally, report what changed, and exchange knowledge whenever another node or the central network becomes reachable.">
      <div className="rounded-3xl overflow-hidden border border-slate-700 bg-slate-900 relative min-h-[340px] sm:min-h-[430px] flex items-end">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/background.jpg')" }} />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07111f] via-[#07111f]/75 to-[#07111f]/20" />
        <div className="relative z-10 p-6 sm:p-10 max-w-3xl">
          <span className="inline-flex items-center gap-2 text-xs tracking-widest uppercase text-cyan-300 border border-cyan-800 bg-cyan-950/50 rounded-full px-3 py-1.5 mb-5"><Radio size={14} /> Disaster memory relay</span>
          <h2 className="text-4xl sm:text-6xl font-black tracking-tight leading-tight">When the network disappears,<br /><span className="text-red-400">memory remains.</span></h2>
          <p className="text-slate-300 mt-4 max-w-xl">Your local Qdrant Edge node keeps answers and observations available. New reports travel through nearby peers, then reach central memory when internet returns.</p>
          <div className="flex flex-wrap gap-3 mt-7"><Link to="/crisis" className="btn-primary inline-flex items-center gap-2">Open survivor view <ArrowRight size={18} /></Link><Link to="/volunteer" className="btn-secondary">Volunteer board</Link></div>
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-4 mt-5">
        <div className="stat-card"><Database className="text-cyan-400" /><div><div className="text-2xl font-bold">{health ? health.guides : '—'}</div><p>Local guide cards</p></div></div>
        <div className="stat-card"><MapPin className="text-amber-400" /><div><div className="text-2xl font-bold">{health ? count : '—'}</div><p>Local observations</p></div></div>
        <div className="stat-card"><Cloud className="text-emerald-400" /><div><div className="text-2xl font-bold">{health?.central_configured ? 'Ready' : 'Local'}</div><p>Central link configured</p></div></div>
      </div>
      <div className="mt-5 rounded-xl bg-[#102335] border border-cyan-900/50 p-4 text-sm text-slate-300 flex gap-3"><ShieldCheck className="text-cyan-300 shrink-0" /><p>Public hazard and resource reports can spread to nearby nodes. Exact survivor help requests stay in responder scope. Guidance cards show their sources and review state.</p></div>
    </Shell>
  );
}
