import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowRight,
  Battery,
  CheckCircle2,
  Compass,
  Crosshair,
  Droplets,
  ExternalLink,
  Flame,
  Footprints,
  HeartPulse,
  Info,
  Navigation,
  Radio,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Signal,
  Sparkles,
  Volume2,
  VolumeX,
  Wifi
} from 'lucide-react';
import { getSurvivalRadar, setting, updateDeviceLocation } from './api';

const RADAR_SIZE = 400;
const CENTER_X = RADAR_SIZE / 2;
const CENTER_Y = RADAR_SIZE / 2;
const MAX_RADIUS = 168; // pixels inside the 400x400 viewbox

const CATEGORIES = [
  { id: 'all', label: 'All Targets', icon: Crosshair },
  { id: 'casualties', label: 'Casualties (SOS)', icon: HeartPulse, countKey: 'total_casualties', badgeColor: 'bg-red-500/20 text-red-400 border-red-500/40' },
  { id: 'shelters', label: 'Shelters & Clinics', icon: ShieldCheck, countKey: 'operational_shelters', badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' },
  { id: 'peers', label: 'Wi-Fi / BLE Peers', icon: Wifi, countKey: 'active_peers', badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/40' },
  { id: 'resources', label: 'Water & Supplies', icon: Droplets, badgeColor: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40' },
  { id: 'hazards', label: 'Hazards', icon: ShieldAlert, badgeColor: 'bg-orange-500/20 text-orange-400 border-orange-500/40' }
];

const RANGES = [
  { label: '1 km', value: 1000 },
  { label: '2 km', value: 2000 },
  { label: '3.5 km', value: 3500 },
  { label: '5 km', value: 5000 }
];

export default function SurvivalRadar({
  userLocation = { lat: 28.7041, lon: 77.1025 },
  onNavigateTarget = null,
  role = 'survivor'
}) {
  const [rangeMeters, setRangeMeters] = useState(3500);
  const [category, setCategory] = useState('all');
  const [radarData, setRadarData] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [sweepAngle, setSweepAngle] = useState(0);
  const [viewMode, setViewMode] = useState('radar'); // 'radar', 'list', 'split'
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // Audio Context Ref for offline synthetic radar ping
  const audioCtxRef = useRef(null);

  const playChirp = useCallback((freq = 880) => {
    if (!audioEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch {
      // Audio context restricted
    }
  }, [audioEnabled]);

  // Fetch Radar Signals
  const fetchRadar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getSurvivalRadar({
        lat: userLocation.lat,
        lon: userLocation.lon,
        radius_m: rangeMeters,
        filter_category: category,
        include_responders: true,
      });
      setRadarData(data);
      setLastRefreshed(new Date());

      // If a target was selected, re-select from new data or clear
      if (selectedTarget) {
        const stillPresent = data.radar_items?.find((i) => i.id === selectedTarget.id);
        if (stillPresent) setSelectedTarget(stillPresent);
      }
    } catch (err) {
      setError(err.message || 'Failed to scan radar space');
    } finally {
      setLoading(false);
    }
  }, [userLocation, rangeMeters, category]);

  useEffect(() => {
    fetchRadar();
    const interval = setInterval(fetchRadar, 12000);
    return () => clearInterval(interval);
  }, [fetchRadar]);

  // Animate Sweep Line
  useEffect(() => {
    let animId;
    let start = performance.now();
    const animate = (time) => {
      const elapsed = time - start;
      const angle = (elapsed / 4000 * 360) % 360;
      setSweepAngle(angle);
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Polar Projection: Converts Bearing (degrees) and Distance (meters) to SVG (cx, cy)
  const projectPolar = (bearingDeg, distanceM) => {
    const clampedDist = Math.min(distanceM, rangeMeters);
    const radiusRatio = clampedDist / rangeMeters;
    const rPixels = radiusRatio * MAX_RADIUS;
    const rad = (bearingDeg * Math.PI) / 180;
    const cx = CENTER_X + rPixels * Math.sin(rad);
    const cy = CENTER_Y - rPixels * Math.cos(rad);
    return { cx, cy, rPixels };
  };

  const handleSelectBlip = (item) => {
    setSelectedTarget(item);
    playChirp(item.category === 'casualty' ? 1200 : 750);
  };

  const items = radarData?.radar_items || [];
  const summary = radarData?.summary || {
    urgent_casualties: 0,
    total_casualties: 0,
    operational_shelters: 0,
    active_peers: 0
  };

  return (
    <div className="flex flex-col gap-5 text-slate-100">
      {/* Header & Tactical Scope Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Radio className="w-6 h-6 animate-pulse" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-black tracking-tight text-white uppercase">
                Survival Radar HUD
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-mono tracking-widest bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full font-bold">
                QDRANT + WI-FI + BLE
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Polar proximity tracking · Azimuth angles · Estimated walk times
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Audio Ping Toggle */}
          <button
            type="button"
            onClick={() => {
              const next = !audioEnabled;
              setAudioEnabled(next);
              if (next) playChirp(900);
            }}
            aria-label="Toggle Radar Audio Ping"
            className={`p-2.5 rounded-2xl border transition-all text-xs font-mono flex items-center gap-1.5 ${
              audioEnabled
                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-lg shadow-cyan-500/10'
                : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {audioEnabled ? <Volume2 className="w-4 h-4 text-cyan-400" /> : <VolumeX className="w-4 h-4" />}
            <span className="hidden sm:inline">{audioEnabled ? 'PING ON' : 'MUTE'}</span>
          </button>

          {/* Sweep Refresh */}
          <button
            type="button"
            onClick={fetchRadar}
            disabled={loading}
            className="p-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-all text-xs font-mono flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 text-cyan-400 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">SWEEP</span>
          </button>

          {/* View Mode Toggle for Small Screens */}
          <div className="flex sm:hidden bg-slate-800/80 p-0.5 rounded-2xl border border-slate-700">
            <button
              type="button"
              onClick={() => setViewMode('radar')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'radar' ? 'bg-cyan-500 text-slate-950 shadow' : 'text-slate-400'
              }`}
            >
              Radar
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'list' ? 'bg-cyan-500 text-slate-950 shadow' : 'text-slate-400'
              }`}
            >
              List ({items.length})
            </button>
          </div>
        </div>
      </div>

      {/* KPI Triage Banners */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-red-950/30 border border-red-800/50 rounded-2xl p-3 sm:p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-red-400 font-mono font-bold uppercase tracking-wider mb-1">
            <span>Casualties</span>
            <HeartPulse className="w-4 h-4 text-red-500 animate-pulse" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-red-200">
              {summary.total_casualties}
            </span>
            {summary.urgent_casualties > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500 text-white animate-pulse">
                {summary.urgent_casualties} URGENT
              </span>
            )}
          </div>
          <div className="text-[11px] text-red-300/80 font-mono mt-0.5">
            {summary.nearest_casualty ? `${summary.nearest_casualty.distance_m}m · ${summary.nearest_casualty.cardinal}` : 'None nearby'}
          </div>
        </div>

        <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-2xl p-3 sm:p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-emerald-400 font-mono font-bold uppercase tracking-wider mb-1">
            <span>Shelters</span>
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-emerald-200">
              {summary.operational_shelters}
            </span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              ACTIVE
            </span>
          </div>
          <div className="text-[11px] text-emerald-300/80 font-mono mt-0.5 truncate">
            {summary.nearest_shelter ? `${summary.nearest_shelter.name.split(' ')[0]} · ${summary.nearest_shelter.distance_m}m` : 'None in range'}
          </div>
        </div>

        <div className="bg-amber-950/30 border border-amber-800/50 rounded-2xl p-3 sm:p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-amber-400 font-mono font-bold uppercase tracking-wider mb-1">
            <span>Wi-Fi / Mesh</span>
            <Wifi className="w-4 h-4 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-amber-200">
              {summary.active_peers}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
              DIRECT
            </span>
          </div>
          <div className="text-[11px] text-amber-300/80 font-mono mt-0.5">
            P2P Local Hotspots
          </div>
        </div>

        <div className="bg-cyan-950/30 border border-cyan-800/50 rounded-2xl p-3 sm:p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-cyan-400 font-mono font-bold uppercase tracking-wider mb-1">
            <span>Coverage</span>
            <Navigation className="w-4 h-4 text-cyan-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-cyan-200">
              {(rangeMeters / 1000).toFixed(1)}
            </span>
            <span className="text-xs font-mono text-cyan-300">KM</span>
          </div>
          <div className="text-[11px] text-cyan-300/80 font-mono mt-0.5 truncate">
            Origin: {userLocation.lat.toFixed(4)}, {userLocation.lon.toFixed(4)}
          </div>
        </div>
      </div>

      {/* Filter and Range Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 max-w-full no-scrollbar">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isAct = category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                className={`px-3 py-2 rounded-xl text-xs font-bold font-mono whitespace-nowrap transition-all flex items-center gap-1.5 ${
                  isAct
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                    : 'bg-slate-800/90 text-slate-300 hover:text-white border border-slate-700/60'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isAct ? 'text-slate-950' : 'text-cyan-400'}`} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Range Selector */}
        <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
          <span className="text-[11px] font-mono text-slate-400 px-2 font-bold uppercase">Range:</span>
          {RANGES.map((rng) => (
            <button
              key={rng.value}
              type="button"
              onClick={() => setRangeMeters(rng.value)}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                rangeMeters === rng.value
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {rng.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Dual Display: Polar Radar (Left) + Tactical Target Directory (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Interactive Polar Radar Scope Canvas */}
        <div
          className={`lg:col-span-6 flex flex-col items-center justify-center bg-slate-950/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-2xl relative overflow-hidden ${
            viewMode === 'list' ? 'hidden sm:flex' : 'flex'
          }`}
        >
          {/* Tactical Corner Watermarks */}
          <div className="w-full flex items-center justify-between text-[10px] font-mono text-cyan-500/60 mb-2 uppercase tracking-widest">
            <span>POLAR SCOPE · AZIMUTH GRATICULE</span>
            <span>BEARING CLOCKWISE FROM 000° N</span>
          </div>

          <div className="relative w-full max-w-[380px] sm:max-w-[420px] aspect-square flex items-center justify-center select-none">
            <svg
              viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
              className="w-full h-full drop-shadow-[0_0_25px_rgba(6,182,212,0.15)]"
              role="img"
              aria-label="Polar Radar Scope showing nearby survivors and shelters"
            >
              <defs>
                {/* Radial Glow Gradient */}
                <radialGradient id="radarBackglow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#082f49" stopOpacity="0.45" />
                  <stop offset="60%" stopColor="#020617" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#020617" stopOpacity="0.98" />
                </radialGradient>

                {/* Sweep Persistence Gradient */}
                <linearGradient id="sweepGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.3" />
                  <stop offset="60%" stopColor="#06b6d4" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                </linearGradient>

                {/* Triage Ping Glow */}
                <filter id="glowRed" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Background Radar Disc */}
              <circle
                cx={CENTER_X}
                cy={CENTER_Y}
                r={MAX_RADIUS + 12}
                fill="url(#radarBackglow)"
                stroke="#1e293b"
                strokeWidth="2"
              />

              {/* Concentric Range Rings */}
              {[0.25, 0.5, 0.75, 1.0].map((frac, idx) => {
                const r = MAX_RADIUS * frac;
                const distAtRing = Math.round(rangeMeters * frac);
                const label = distAtRing >= 1000 ? `${(distAtRing / 1000).toFixed(1)}k` : `${distAtRing}m`;
                return (
                  <g key={idx}>
                    <circle
                      cx={CENTER_X}
                      cy={CENTER_Y}
                      r={r}
                      fill="none"
                      stroke="#0e7490"
                      strokeWidth={idx === 3 ? '1.5' : '0.8'}
                      strokeDasharray={idx === 3 ? 'none' : '3 3'}
                      opacity={idx === 3 ? 0.8 : 0.45}
                    />
                    {/* Range Labels on vertical azimuth */}
                    <text
                      x={CENTER_X + 4}
                      y={CENTER_Y - r + 11}
                      fill="#38bdf8"
                      fontSize="9"
                      fontFamily="monospace"
                      opacity="0.75"
                    >
                      {label}
                    </text>
                  </g>
                );
              })}

              {/* Azimuth Spokes (0, 45, 90, 135, 180, 225, 270, 315) */}
              {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
                const rad = (deg * Math.PI) / 180;
                const x1 = CENTER_X;
                const y1 = CENTER_Y;
                const x2 = CENTER_X + MAX_RADIUS * Math.sin(rad);
                const y2 = CENTER_Y - MAX_RADIUS * Math.cos(rad);
                const isCardinal = deg % 90 === 0;
                return (
                  <line
                    key={deg}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#0e7490"
                    strokeWidth={isCardinal ? '1' : '0.6'}
                    strokeDasharray={isCardinal ? 'none' : '2 3'}
                    opacity={isCardinal ? 0.6 : 0.3}
                  />
                );
              })}

              {/* Outer Graticule Degree Ticks */}
              {Array.from({ length: 36 }).map((_, i) => {
                const deg = i * 10;
                const rad = (deg * Math.PI) / 180;
                const inner = MAX_RADIUS + (deg % 30 === 0 ? 4 : 8);
                const outer = MAX_RADIUS + 12;
                return (
                  <line
                    key={deg}
                    x1={CENTER_X + inner * Math.sin(rad)}
                    y1={CENTER_Y - inner * Math.cos(rad)}
                    x2={CENTER_X + outer * Math.sin(rad)}
                    y2={CENTER_Y - outer * Math.cos(rad)}
                    stroke="#38bdf8"
                    strokeWidth={deg % 30 === 0 ? '1.5' : '0.8'}
                    opacity={deg % 30 === 0 ? 0.8 : 0.4}
                  />
                );
              })}

              {/* Cardinal Compass Labels */}
              <text x={CENTER_X} y={CENTER_Y - MAX_RADIUS - 16} textAnchor="middle" fill="#ef4444" fontSize="13" fontWeight="900" fontFamily="monospace">N</text>
              <text x={CENTER_X + MAX_RADIUS + 18} y={CENTER_Y + 4} textAnchor="middle" fill="#38bdf8" fontSize="12" fontWeight="bold" fontFamily="monospace">E</text>
              <text x={CENTER_X} y={CENTER_Y + MAX_RADIUS + 22} textAnchor="middle" fill="#38bdf8" fontSize="12" fontWeight="bold" fontFamily="monospace">S</text>
              <text x={CENTER_X - MAX_RADIUS - 18} y={CENTER_Y + 4} textAnchor="middle" fill="#38bdf8" fontSize="12" fontWeight="bold" fontFamily="monospace">W</text>

              {/* Sweeping Radar Beam (Conical Sector) */}
              <g transform={`rotate(${sweepAngle} ${CENTER_X} ${CENTER_Y})`}>
                {/* Sector Trail */}
                <path
                  d={`M ${CENTER_X} ${CENTER_Y} L ${CENTER_X} ${CENTER_Y - MAX_RADIUS} A ${MAX_RADIUS} ${MAX_RADIUS} 0 0 1 ${
                    CENTER_X + MAX_RADIUS * Math.sin((35 * Math.PI) / 180)
                  } ${
                    CENTER_Y - MAX_RADIUS * Math.cos((35 * Math.PI) / 180)
                  } Z`}
                  fill="url(#sweepGradient)"
                />
                {/* Leading Beam Line */}
                <line
                  x1={CENTER_X}
                  y1={CENTER_Y}
                  x2={CENTER_X}
                  y2={CENTER_Y - MAX_RADIUS}
                  stroke="#22d3ee"
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.9"
                />
              </g>

              {/* Central User Marker (YOU) */}
              <g>
                <circle cx={CENTER_X} cy={CENTER_Y} r="8" fill="#0284c7" opacity="0.3" className="animate-ping" />
                <circle cx={CENTER_X} cy={CENTER_Y} r="4.5" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
              </g>

              {/* Target Blips */}
              {items.map((item) => {
                const { cx, cy } = projectPolar(item.bearing_deg, item.distance_m);
                const isSelected = selectedTarget?.id === item.id;
                const isCasualty = item.category === 'casualty';
                const isShelter = item.category === 'shelter';
                const isPeer = item.category === 'peer';
                const isHazard = item.category === 'hazard';

                let blipFill = '#38bdf8';
                if (isCasualty) blipFill = '#ef4444';
                else if (isShelter) blipFill = '#10b981';
                else if (isPeer) blipFill = '#f59e0b';
                else if (isHazard) blipFill = '#f97316';

                return (
                  <g
                    key={item.id}
                    className="cursor-pointer transition-transform duration-200 hover:scale-125"
                    onClick={() => handleSelectBlip(item)}
                  >
                    {/* Expanding ping ring for urgent casualties */}
                    {isCasualty && item.triage_level === 'immediate_red' && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r="14"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="1.5"
                        opacity="0.75"
                        className="animate-ping"
                      />
                    )}

                    {/* Wi-Fi RSSI waves for peer devices */}
                    {isPeer && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r="10"
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="1"
                        strokeDasharray="2 2"
                        opacity="0.6"
                      />
                    )}

                    {/* Blip Geometry */}
                    {isShelter ? (
                      // Diamond for Shelter
                      <polygon
                        points={`${cx},${cy - 6} ${cx + 6},${cy} ${cx},${cy + 6} ${cx - 6},${cy}`}
                        fill={blipFill}
                        stroke="#ffffff"
                        strokeWidth="1"
                      />
                    ) : isHazard ? (
                      // Triangle for Hazard
                      <polygon
                        points={`${cx},${cy - 6} ${cx + 6},${cy + 5} ${cx - 6},${cy + 5}`}
                        fill={blipFill}
                        stroke="#ffffff"
                        strokeWidth="1"
                      />
                    ) : (
                      // Circle for Casualties & Peers & Resources
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isSelected ? 6.5 : 5}
                        fill={blipFill}
                        stroke="#ffffff"
                        strokeWidth={isSelected ? 2 : 1}
                      />
                    )}

                    {/* Tactical Lock Reticle Brackets if Selected */}
                    {isSelected && (
                      <g>
                        <circle cx={cx} cy={cy} r="16" fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="6 4" className="animate-spin" />
                        <line x1={cx - 10} y1={cy - 10} x2={cx - 5} y2={cy - 10} stroke="#22d3ee" strokeWidth="1.5" />
                        <line x1={cx - 10} y1={cy - 10} x2={cx - 10} y2={cy - 5} stroke="#22d3ee" strokeWidth="1.5" />
                        <line x1={cx + 10} y1={cy - 10} x2={cx + 5} y2={cy - 10} stroke="#22d3ee" strokeWidth="1.5" />
                        <line x1={cx + 10} y1={cy - 10} x2={cx + 10} y2={cy - 5} stroke="#22d3ee" strokeWidth="1.5" />
                        <line x1={cx - 10} y1={cy + 10} x2={cx - 5} y2={cy + 10} stroke="#22d3ee" strokeWidth="1.5" />
                        <line x1={cx - 10} y1={cy + 10} x2={cx - 10} y2={cy + 5} stroke="#22d3ee" strokeWidth="1.5" />
                        <line x1={cx + 10} y1={cy + 10} x2={cx + 5} y2={cy + 10} stroke="#22d3ee" strokeWidth="1.5" />
                        <line x1={cx + 10} y1={cy + 10} x2={cx + 10} y2={cy + 5} stroke="#22d3ee" strokeWidth="1.5" />
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Sweep Status Pill */}
            <div className="absolute bottom-2 left-4 text-[10px] font-mono text-cyan-400 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700/60">
              RADAR ACTIVE · {items.length} TRACKS
            </div>
            {lastRefreshed && (
              <div className="absolute bottom-2 right-4 text-[10px] font-mono text-slate-500 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700/60">
                SWEEP {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            )}
          </div>

          {/* Radar Legend */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-slate-800/80 w-full mt-2 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
              <span className="text-slate-300">Casualty / SOS</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rotate-45 bg-emerald-500"></span>
              <span className="text-slate-300">Shelter / Clinic</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              <span className="text-slate-300">Mesh Peer Node</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-cyan-400"></span>
              <span className="text-slate-300">Water / Supplies</span>
            </div>
          </div>
        </div>

        {/* Right Column: Tactical Target Directory & Locked Target Inspector */}
        <div
          className={`lg:col-span-6 flex flex-col gap-4 ${
            viewMode === 'radar' ? 'hidden sm:flex' : 'flex'
          }`}
        >
          {/* Active Target Inspector Card (if any selected) */}
          {selectedTarget ? (
            <div className="bg-slate-900/95 border-2 border-cyan-500/60 rounded-3xl p-5 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 px-3 py-1 bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-black tracking-widest uppercase rounded-bl-xl border-l border-b border-cyan-500/40">
                TARGET LOCKED · AZIMUTH {String(selectedTarget.bearing_deg).padStart(3, '0')}° {selectedTarget.cardinal}
              </div>

              <div className="flex items-start gap-3.5 mb-3">
                <div
                  className={`p-3 rounded-2xl flex items-center justify-center ${
                    selectedTarget.category === 'casualty'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                      : selectedTarget.category === 'shelter'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : selectedTarget.category === 'peer'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                  }`}
                >
                  {selectedTarget.category === 'casualty' ? (
                    <HeartPulse className="w-6 h-6 animate-pulse" />
                  ) : selectedTarget.category === 'shelter' ? (
                    <ShieldCheck className="w-6 h-6" />
                  ) : selectedTarget.category === 'peer' ? (
                    <Wifi className="w-6 h-6" />
                  ) : (
                    <Droplets className="w-6 h-6" />
                  )}
                </div>

                <div className="flex-1 min-w-0 pr-12">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full uppercase ${
                        selectedTarget.triage_level === 'immediate_red'
                          ? 'bg-red-500 text-white animate-pulse'
                          : selectedTarget.triage_level === 'safe_green'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      }`}
                    >
                      {selectedTarget.triage_level.replace('_', ' ')}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      ID: {selectedTarget.id}
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-white truncate mt-1">
                    {selectedTarget.name}
                  </h3>
                </div>
              </div>

              {/* Polar Navigation Coordinates Grid */}
              <div className="grid grid-cols-3 gap-2 bg-slate-950/70 p-3 rounded-2xl border border-slate-800/80 mb-3 font-mono text-center">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase">Distance</div>
                  <div className="text-base font-black text-cyan-300">
                    {selectedTarget.distance_m} m
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase">Bearing</div>
                  <div className="text-base font-black text-cyan-300">
                    {String(selectedTarget.bearing_deg).padStart(3, '0')}° {selectedTarget.cardinal}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase">Est. Walk</div>
                  <div className="text-base font-black text-cyan-300">
                    ~{selectedTarget.walk_time_min} min
                  </div>
                </div>
              </div>

              {/* Observation / Details Text */}
              {selectedTarget.text && (
                <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed mb-3">
                  <div className="text-[10px] font-mono text-slate-400 uppercase mb-1 font-bold">Observation Record:</div>
                  {selectedTarget.text}
                </div>
              )}

              {/* Signal Metadata */}
              <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-400 mb-4 px-1">
                <span>Signal Source: <strong className="text-slate-200">{selectedTarget.signal_source}</strong></span>
                {selectedTarget.signal_dbm && (
                  <span>Signal: <strong className="text-amber-300">{selectedTarget.signal_dbm} dBm ({selectedTarget.signal_quality})</strong></span>
                )}
                <span>Status: <strong className="text-emerald-400 uppercase">{selectedTarget.status}</strong></span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {onNavigateTarget && (
                  <button
                    type="button"
                    onClick={() => onNavigateTarget(selectedTarget)}
                    className="flex-1 py-3 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs font-mono uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition-all"
                  >
                    <Navigation className="w-4 h-4" />
                    <span>Engage Compass Bearing</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedTarget(null)}
                  className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs uppercase"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-4 text-center">
              <p className="text-xs text-slate-400 font-mono">
                Click any blip on the polar radar scope to lock on and inspect bearing coordinates.
              </p>
            </div>
          )}

          {/* Tactical Target Directory List */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-2xl flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crosshair className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-black text-white font-mono uppercase tracking-wider">
                  Proximity Target Directory ({items.length})
                </h3>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                Sorted by closest
              </span>
            </div>

            {items.length === 0 ? (
              <div className="py-12 text-center text-slate-500 font-mono text-xs">
                No signal tracks detected in {rangeMeters}m radius for category &apos;{category}&apos;.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 max-h-[460px] overflow-y-auto pr-1">
                {items.map((item) => {
                  const isSelected = selectedTarget?.id === item.id;
                  const isCasualty = item.category === 'casualty';
                  const isShelter = item.category === 'shelter';
                  const isPeer = item.category === 'peer';

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelectBlip(item)}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-cyan-950/40 border-cyan-500/80 shadow-md shadow-cyan-500/10'
                          : 'bg-slate-950/60 hover:bg-slate-800/80 border-slate-800/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isCasualty
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : isShelter
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : isPeer
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                          }`}
                        >
                          {isCasualty ? (
                            <HeartPulse className="w-4 h-4" />
                          ) : isShelter ? (
                            <ShieldCheck className="w-4 h-4" />
                          ) : isPeer ? (
                            <Wifi className="w-4 h-4" />
                          ) : (
                            <Droplets className="w-4 h-4" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-black text-white truncate">
                              {item.name}
                            </span>
                            {item.triage_level === 'immediate_red' && (
                              <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-red-500 text-white shrink-0">
                                URGENT
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                            {item.text || `${item.category.toUpperCase()} signal track`}
                          </div>
                        </div>
                      </div>

                      {/* Distance & Bearing Pill */}
                      <div className="text-right shrink-0 font-mono">
                        <div className="text-xs font-black text-cyan-400">
                          {item.distance_m}m
                        </div>
                        <div className="text-[10px] text-slate-400 font-bold">
                          {String(item.bearing_deg).padStart(3, '0')}° {item.cardinal}
                        </div>
                        <div className="text-[9px] text-slate-500">
                          ~{item.walk_time_min}m walk
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
