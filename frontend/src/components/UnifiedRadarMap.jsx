import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Compass,
  Crosshair,
  Droplets,
  HeartPulse,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Volume2,
  VolumeX,
  Wifi,
  Zap
} from 'lucide-react';
import { getSurvivalRadar } from '../api';
import MapPanel from '../MapPanel';

const COMPASS_SIZE = 300;
const COMPASS_CENTER = COMPASS_SIZE / 2;
const COMPASS_RADIUS = 120;

export default function UnifiedRadarMap({
  userLocation = { lat: 28.7041, lon: 77.1025 },
  items = [],
  peers = [],
  onSelectLocation = null,
  onNavigateTarget = null,
  role = 'survivor'
}) {
  const [radarData, setRadarData] = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [mapFilter, setMapFilter] = useState('all');

  // Device orientation / heading state (0 = North, 90 = East, 180 = South, 270 = West)
  const [deviceHeading, setDeviceHeading] = useState(0);
  const [isCompassActive, setIsCompassActive] = useState(false);
  const [manualHeading, setManualHeading] = useState(0);
  const [lastHapticTime, setLastHapticTime] = useState(0);

  // Audio Context Ref for offline synthetic radar/compass ping
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
      osc.frequency.exponentialRampToValueAtTime(freq * 1.3, ctx.currentTime + 0.05);
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

  // Listen to Smartphone Compass / Magnetometer
  useEffect(() => {
    let lastHeading = 0;
    const handleOrientation = (e) => {
      let heading = null;
      if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
        heading = e.webkitCompassHeading;
      } else if (e.alpha !== null && e.alpha !== undefined) {
        heading = (360 - e.alpha) % 360;
      }
      if (heading !== null && !Number.isNaN(heading)) {
        const rounded = Math.round(heading);
        if (Math.abs(rounded - lastHeading) >= 2) {
          lastHeading = rounded;
          setDeviceHeading(rounded);
          setIsCompassActive(true);
        }
      }
    };

    if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
        window.removeEventListener('deviceorientation', handleOrientation, true);
      }
    };
  }, []);

  // Fetch Radar Signals from Qdrant Edge Memory
  const locLat = userLocation?.lat ?? 28.7041;
  const locLon = userLocation?.lon ?? 77.1025;

  const fetchRadar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getSurvivalRadar({
        lat: locLat,
        lon: locLon,
        radius_m: 5000,
        filter_category: 'all',
        include_responders: true,
      });
      setRadarData(data);
    } catch (err) {
      setError(err.message || 'Failed to scan radar space');
    } finally {
      setLoading(false);
    }
  }, [locLat, locLon]);

  useEffect(() => {
    fetchRadar();
    const interval = setInterval(fetchRadar, 15000);
    return () => clearInterval(interval);
  }, [fetchRadar]);

  const radarItems = radarData?.radar_items || [];
  const summary = radarData?.summary || {
    urgent_casualties: 0,
    total_casualties: 0,
    operational_shelters: 0,
    active_peers: 0
  };

  // Build unified destinations list for dropdown:
  // Combines casualties, safe shelters, water stations, and checkpoints
  const destinationOptions = useMemo(() => {
    const list = [...radarItems];
    // Baseline safe shelters if not already in radar
    const baseline = [
      {
        id: 'shelter_alpha',
        name: 'Shelter Alpha (Central High - Safe Haven)',
        category: 'shelter',
        distance_m: 850,
        bearing_deg: 320,
        cardinal: 'NW',
        walk_time_min: 11,
        location: { lat: 28.712, lon: 77.098 },
        triage_level: 'safe_green',
        text: 'Verified safe high-ground shelter with food, emergency surgery & power generator.'
      },
      {
        id: 'water_point_4',
        name: 'Clean Water Depot (North Gate Tanker 4)',
        category: 'resource',
        distance_m: 540,
        bearing_deg: 45,
        cardinal: 'NE',
        walk_time_min: 7,
        location: { lat: 28.706, lon: 77.108 },
        triage_level: 'safe_green',
        text: 'Drinkable water distribution depot guarded by emergency relief corps.'
      },
      {
        id: 'cp_17',
        name: 'Checkpoint CP-17 (North Bridge)',
        category: 'hazard',
        distance_m: 350,
        bearing_deg: 90,
        cardinal: 'E',
        walk_time_min: 5,
        location: { lat: 28.7041, lon: 77.1025 },
        triage_level: 'hazard_warning',
        text: 'Caution: Submerged entrance & downed live wires. Exercise caution.'
      }
    ];

    baseline.forEach((b) => {
      if (!list.some((item) => item.id === b.id)) {
        list.push(b);
      }
    });

    return list;
  }, [radarItems]);

  // Compute Active Target for Compass Pointer
  const activeTarget = useMemo(() => {
    if (selectedTargetId) {
      const found = destinationOptions.find((d) => d.id === selectedTargetId);
      if (found) return found;
    }
    // Default 1: Nearest Casualty in distress
    if (summary.nearest_casualty) return summary.nearest_casualty;
    const firstCasualty = destinationOptions.find((i) => i.category === 'casualty');
    if (firstCasualty) return firstCasualty;
    // Default 2: Nearest Safe Shelter
    if (summary.nearest_shelter) return summary.nearest_shelter;
    const firstShelter = destinationOptions.find((i) => i.category === 'shelter');
    if (firstShelter) return firstShelter;
    return destinationOptions[0] || null;
  }, [selectedTargetId, summary, destinationOptions]);

  // Auto-sync selected target id
  useEffect(() => {
    if (!selectedTargetId && activeTarget) {
      setSelectedTargetId(activeTarget.id);
    }
  }, [activeTarget, selectedTargetId]);

  // Current heading to use: device magnetometer if active, else manual slider
  const currentHeading = isCompassActive ? deviceHeading : manualHeading;

  // Relative Bearing: Difference between device heading and target bearing
  // (targetBearing - currentHeading + 360) % 360
  const targetBearing = activeTarget?.bearing_deg ?? 0;
  const relativeAngle = ((targetBearing - currentHeading + 360) % 360);

  // Alignment Calculation:
  // Is user facing directly toward destination? (within +/- 10 degrees)
  const isAligned = relativeAngle <= 10 || relativeAngle >= 350;
  const turnRightAngle = relativeAngle > 180 ? 0 : relativeAngle;
  const turnLeftAngle = relativeAngle > 180 ? 360 - relativeAngle : 0;

  // Haptic feedback when user aligns phone directly with target
  useEffect(() => {
    if (isAligned && activeTarget && typeof navigator !== 'undefined' && navigator.vibrate) {
      const now = Date.now();
      if (now - lastHapticTime > 3000) {
        navigator.vibrate([35, 45, 35]);
        setLastHapticTime(now);
      }
    }
  }, [isAligned, activeTarget, lastHapticTime]);

  const handleSelectDestination = (targetId) => {
    setSelectedTargetId(targetId);
    const chosen = destinationOptions.find((d) => d.id === targetId);
    if (chosen) {
      playChirp(chosen.category === 'casualty' ? 1200 : 800);
      if (onNavigateTarget && chosen.location) {
        onNavigateTarget(chosen);
      }
    }
  };

  // Filtered items for MapPanel
  const filteredMapItems = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    if (mapFilter === 'all') return list;
    if (mapFilter === 'sos') return list.filter((i) => i.kind === 'incident' || i.severity === 'red');
    if (mapFilter === 'hazard') return list.filter((i) => i.kind === 'hazard');
    if (mapFilter === 'resource') return list.filter((i) => i.kind === 'resource' || i.kind === 'checkpoint');
    return list;
  }, [items, mapFilter]);

  return (
    <div className="flex flex-col gap-5 text-slate-900 dark:text-slate-100">
      {/* Top Reassuring Navigation Header & Live Telemetry */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#0b1626] border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-md shadow-cyan-600/20 shrink-0">
              <Navigation size={18} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>Tactical Radar Map & Compass</span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-950/80 text-cyan-800 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-800">
                  100% Offline
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Top interactive map with real-time 360° survival compass pointing to nearest survivors & safe shelters
              </p>
            </div>
          </div>
        </div>

        {/* Telemetry Chips */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Compass Sensor Status */}
          <div className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono flex items-center gap-1.5">
            <RotateCw size={13} className="text-cyan-500" />
            <span className="font-bold">{String(currentHeading).padStart(3, '0')}°</span>
            <span className="text-slate-400">|</span>
            <span className={isCompassActive ? 'text-emerald-500 font-semibold' : 'text-amber-500'}>
              {isCompassActive ? 'GYRO ACTIVE' : 'NORTH REF'}
            </span>
          </div>

          {/* Audio Chirp Toggle */}
          <button
            type="button"
            onClick={() => setAudioEnabled(!audioEnabled)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
              audioEnabled
                ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30'
                : 'bg-slate-100 dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
            title={audioEnabled ? 'Audio ping active' : 'Turn on audio ping beacon'}
          >
            {audioEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
            <span className="hidden sm:inline">Beacon Sound</span>
          </button>

          {/* Refresh Radar */}
          <button
            type="button"
            onClick={fetchRadar}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-cyan-500 transition-colors"
            title="Scan local Qdrant memory"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Prominent Navigation Destination Dropdown Selector */}
      <div className="bg-white dark:bg-gradient-to-b dark:from-[#0d172b]/95 dark:to-[#091222]/95 border border-slate-200 dark:border-cyan-500/15 rounded-3xl p-4 sm:p-5 shadow-xl">
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <MapPin size={14} className="text-red-500" />
            <span>Select Target Destination (Retrieved Locally):</span>
          </span>
          {activeTarget && (
            <span className="font-mono text-[11px] text-cyan-600 dark:text-cyan-400 font-bold">
              Locked: {activeTarget.distance_m}m · {activeTarget.cardinal} ({String(activeTarget.bearing_deg).padStart(3, '0')}°)
            </span>
          )}
        </label>

        <div className="relative">
          <select
            value={selectedTargetId}
            onChange={(e) => handleSelectDestination(e.target.value)}
            className="w-full appearance-none py-3.5 px-4 pr-10 rounded-2xl border border-slate-300 dark:border-cyan-500/30 bg-slate-50 dark:bg-[#07111e] text-slate-900 dark:text-slate-100 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-cyan-500 cursor-pointer shadow-inner"
          >
            {destinationOptions.map((dest) => {
              const isCas = dest.category === 'casualty';
              const isShelter = dest.category === 'shelter';
              const icon = isCas ? '🆘' : isShelter ? '🏥' : dest.category === 'resource' ? '💧' : '📍';
              return (
                <option key={dest.id} value={dest.id}>
                  {icon} {dest.name} — {dest.distance_m}m {dest.cardinal} ({dest.bearing_deg}°) {isCas ? '· IMMEDIATE HELP' : ''}
                </option>
              );
            })}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5 text-slate-400">
            <ChevronDown size={18} />
          </div>
        </div>
      </div>

      {/* TOP VIEW: Interactive Tactical Map */}
      <div className="bg-white dark:bg-gradient-to-b dark:from-[#0d172b]/95 dark:to-[#091222]/95 border border-slate-200 dark:border-cyan-500/15 rounded-3xl p-4 sm:p-5 shadow-xl">
        {/* Map Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex flex-wrap gap-1.5">
            {[
              ['all', 'All Points'],
              ['sos', 'SOS / Casualties'],
              ['hazard', 'Hazards'],
              ['resource', 'Safe Resources']
            ].map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => setMapFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-xl border font-bold transition-all ${
                  mapFilter === f
                    ? 'border-cyan-500 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            Grid Center: {userLocation.lat.toFixed(4)}, {userLocation.lon.toFixed(4)}
          </div>
        </div>

        {/* Map Canvas */}
        <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
          <MapPanel
            center={userLocation}
            items={filteredMapItems}
            peers={peers}
            selected={activeTarget?.location || userLocation}
            onSelect={onSelectLocation}
            onMarker={(item) => {
              const matched = destinationOptions.find(
                (d) => d.id === item.id || d.name === item.entity_id || d.name.includes(item.entity_id || '')
              );
              if (matched) {
                handleSelectDestination(matched.id);
              }
            }}
          />

          {/* Compass Rose Mini Watermark overlay on map */}
          <div className="absolute top-3 right-3 bg-slate-900/80 backdrop-blur-md border border-slate-700/60 rounded-xl px-2.5 py-1 text-[11px] font-mono text-cyan-300 font-bold flex items-center gap-1.5 shadow-md">
            <Compass size={13} className="text-cyan-400" />
            <span>N {String(currentHeading).padStart(3, '0')}°</span>
          </div>
        </div>
      </div>

      {/* JUST BELOW THE MAP: Working 360° Compass Pointer & Live Azimuth Dial */}
      <div className="bg-white dark:bg-gradient-to-b dark:from-[#0d172b]/95 dark:to-[#091222]/95 border border-slate-200 dark:border-cyan-500/15 rounded-3xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
          {/* Compass SVG Housing */}
          <div className="flex flex-col items-center justify-center shrink-0 w-full lg:w-auto">
            <div className="relative w-[300px] h-[300px] flex items-center justify-center">
              <svg
                width={COMPASS_SIZE}
                height={COMPASS_SIZE}
                viewBox={`0 0 ${COMPASS_SIZE} ${COMPASS_SIZE}`}
                className="select-none drop-shadow-2xl"
              >
                <defs>
                  {/* Outer ring gradient */}
                  <linearGradient id="compassRing" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#0284c7" />
                    <stop offset="100%" stopColor="#0f172a" />
                  </linearGradient>

                  {/* Glow filter */}
                  <filter id="needleGlow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {/* Outer Azimuth Bezel */}
                <circle cx={COMPASS_CENTER} cy={COMPASS_CENTER} r={COMPASS_RADIUS + 20} fill="#091424" stroke="#334155" strokeWidth="2.5" />
                <circle cx={COMPASS_CENTER} cy={COMPASS_CENTER} r={COMPASS_RADIUS + 14} fill="#030712" stroke="#0e7490" strokeWidth="1" strokeDasharray="3 3" />
                <circle cx={COMPASS_CENTER} cy={COMPASS_CENTER} r={COMPASS_RADIUS} fill="#060e1a" stroke="#1e293b" strokeWidth="1.5" />

                {/* 360-degree tick marks */}
                {Array.from({ length: 72 }).map((_, i) => {
                  const deg = i * 5;
                  const isMajor = deg % 30 === 0;
                  const isCardinal = deg % 90 === 0;
                  const tickLen = isCardinal ? 13 : isMajor ? 9 : 4;
                  const rad = (deg * Math.PI) / 180;
                  const x1 = COMPASS_CENTER + (COMPASS_RADIUS - 2) * Math.sin(rad);
                  const y1 = COMPASS_CENTER - (COMPASS_RADIUS - 2) * Math.cos(rad);
                  const x2 = COMPASS_CENTER + (COMPASS_RADIUS - 2 - tickLen) * Math.sin(rad);
                  const y2 = COMPASS_CENTER - (COMPASS_RADIUS - 2 - tickLen) * Math.cos(rad);
                  return (
                    <line
                      key={deg}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={isCardinal ? '#ef4444' : isMajor ? '#38bdf8' : '#334155'}
                      strokeWidth={isCardinal ? 2 : isMajor ? 1.5 : 0.75}
                    />
                  );
                })}

                {/* Cardinal Points */}
                <text x={COMPASS_CENTER} y={COMPASS_CENTER - COMPASS_RADIUS + 18} textAnchor="middle" fill="#ef4444" fontSize="14" fontWeight="900" fontFamily="monospace">N</text>
                <text x={COMPASS_CENTER + COMPASS_RADIUS - 16} y={COMPASS_CENTER + 5} textAnchor="middle" fill="#38bdf8" fontSize="12" fontWeight="bold" fontFamily="monospace">E</text>
                <text x={COMPASS_CENTER} y={COMPASS_CENTER + COMPASS_RADIUS - 8} textAnchor="middle" fill="#38bdf8" fontSize="12" fontWeight="bold" fontFamily="monospace">S</text>
                <text x={COMPASS_CENTER - COMPASS_RADIUS + 16} y={COMPASS_CENTER + 5} textAnchor="middle" fill="#38bdf8" fontSize="12" fontWeight="bold" fontFamily="monospace">W</text>

                {/* Crosshairs */}
                <line x1={COMPASS_CENTER - 25} y1={COMPASS_CENTER} x2={COMPASS_CENTER + 25} y2={COMPASS_CENTER} stroke="#0e7490" strokeWidth="0.8" opacity="0.3" />
                <line x1={COMPASS_CENTER} y1={COMPASS_CENTER - 25} x2={COMPASS_CENTER} y2={COMPASS_CENTER + 25} stroke="#0e7490" strokeWidth="0.8" opacity="0.3" />

                {/* DYNAMIC COMPASS NEEDLE POINTING TO LOCKED DESTINATION */}
                {activeTarget && (
                  <g
                    transform={`rotate(${relativeAngle} ${COMPASS_CENTER} ${COMPASS_CENTER})`}
                    filter="url(#needleGlow)"
                    className="transition-transform duration-300 ease-out"
                  >
                    {/* Needle Arrowhead */}
                    <polygon
                      points={`${COMPASS_CENTER},${COMPASS_CENTER - COMPASS_RADIUS + 15} ${COMPASS_CENTER - 11},${COMPASS_CENTER - 18} ${COMPASS_CENTER},${COMPASS_CENTER - 9} ${COMPASS_CENTER + 11},${COMPASS_CENTER - 18}`}
                      fill={isAligned ? '#10b981' : '#ef4444'}
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />

                    {/* Needle Shaft Line */}
                    <line
                      x1={COMPASS_CENTER}
                      y1={COMPASS_CENTER}
                      x2={COMPASS_CENTER}
                      y2={COMPASS_CENTER - COMPASS_RADIUS + 15}
                      stroke={isAligned ? '#10b981' : '#ef4444'}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />

                    {/* Counterbalance tail */}
                    <polygon
                      points={`${COMPASS_CENTER},${COMPASS_CENTER + 30} ${COMPASS_CENTER - 6},${COMPASS_CENTER + 12} ${COMPASS_CENTER + 6},${COMPASS_CENTER + 12}`}
                      fill="#475569"
                    />

                    {/* Reticle ring at tip */}
                    <circle
                      cx={COMPASS_CENTER}
                      cy={COMPASS_CENTER - COMPASS_RADIUS + 15}
                      r="6"
                      fill="none"
                      stroke={isAligned ? '#10b981' : '#ef4444'}
                      strokeWidth="2"
                      className={isAligned ? 'animate-pulse' : ''}
                    />
                  </g>
                )}

                {/* Center Hub Display */}
                <circle cx={COMPASS_CENTER} cy={COMPASS_CENTER} r="32" fill="#091424" stroke="#1e293b" strokeWidth="2" />
                <circle cx={COMPASS_CENTER} cy={COMPASS_CENTER} r="28" fill="#030712" />

                <text
                  x={COMPASS_CENTER}
                  y={COMPASS_CENTER - 3}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="13"
                  fontWeight="900"
                  fontFamily="monospace"
                >
                  {activeTarget ? `${activeTarget.distance_m}m` : '0m'}
                </text>
                <text
                  x={COMPASS_CENTER}
                  y={COMPASS_CENTER + 12}
                  textAnchor="middle"
                  fill={isAligned ? '#10b981' : '#38bdf8'}
                  fontSize="9"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {activeTarget?.cardinal || 'N'}
                </text>
              </svg>
            </div>

            {/* Desktop Manual Heading Slider (Shown when no gyroscope detected) */}
            {!isCompassActive && (
              <div className="mt-3 w-full max-w-[280px] bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 text-center">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 mb-1">
                  <span>Simulate Facing Angle:</span>
                  <strong className="text-cyan-600 dark:text-cyan-400">{manualHeading}°</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="359"
                  value={manualHeading}
                  onChange={(e) => setManualHeading(Number(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-0.5">
                  <span>0° N</span>
                  <span>90° E</span>
                  <span>180° S</span>
                  <span>270° W</span>
                </div>
              </div>
            )}
          </div>

          {/* Locked Target Navigation Telemetry & Alignment Guide */}
          <div className="flex-1 min-w-0 w-full flex flex-col gap-3.5">
            {/* Live Alignment Action Banner */}
            <div className="w-full text-center font-mono">
              {isAligned ? (
                <div className="py-3 px-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-600 dark:text-emerald-300 font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 shadow-sm animate-pulse">
                  <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                  <span>ON TARGET · PROCEED STRAIGHT AHEAD</span>
                </div>
              ) : turnRightAngle > 0 ? (
                <div className="py-3 px-4 rounded-2xl bg-amber-500/10 border border-amber-500/40 text-amber-700 dark:text-amber-300 font-bold text-xs sm:text-sm flex items-center justify-center gap-2">
                  <ArrowRight size={16} className="text-amber-500 animate-bounce shrink-0" />
                  <span>TURN RIGHT {Math.round(turnRightAngle)}° TO ALIGN WITH DESTINATION</span>
                </div>
              ) : (
                <div className="py-3 px-4 rounded-2xl bg-amber-500/10 border border-amber-500/40 text-amber-700 dark:text-amber-300 font-bold text-xs sm:text-sm flex items-center justify-center gap-2">
                  <ArrowLeft size={16} className="text-amber-500 animate-bounce shrink-0" />
                  <span>TURN LEFT {Math.round(turnLeftAngle)}° TO ALIGN WITH DESTINATION</span>
                </div>
              )}
            </div>

            {/* Target Card Details */}
            {activeTarget ? (
              <div
                className={`p-4 sm:p-5 rounded-2xl border-2 transition-all shadow-sm ${
                  activeTarget.category === 'casualty'
                    ? 'bg-red-50/60 dark:bg-red-950/20 border-red-500/60'
                    : activeTarget.category === 'shelter'
                    ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-500/60'
                    : 'bg-slate-50 dark:bg-slate-900/60 border-slate-300 dark:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className={`p-2.5 rounded-xl shrink-0 ${
                      activeTarget.category === 'casualty'
                        ? 'bg-red-600 text-white'
                        : activeTarget.category === 'shelter'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-cyan-600 text-white'
                    }`}
                  >
                    {activeTarget.category === 'casualty' ? (
                      <HeartPulse size={22} className="animate-pulse" />
                    ) : activeTarget.category === 'shelter' ? (
                      <ShieldCheck size={22} />
                    ) : activeTarget.category === 'resource' ? (
                      <Droplets size={22} />
                    ) : (
                      <MapPin size={22} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          activeTarget.category === 'casualty'
                            ? 'bg-red-600 text-white animate-pulse'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {activeTarget.category === 'casualty' ? 'PRIORITY CASUALTY' : 'SAFE DESTINATION'}
                      </span>
                      <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                        Azimuth {String(activeTarget.bearing_deg).padStart(3, '0')}° ({activeTarget.cardinal})
                      </span>
                    </div>
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate mt-1">
                      {activeTarget.name}
                    </h3>
                  </div>
                </div>

                {/* Metrics Matrix */}
                <div className="grid grid-cols-3 gap-2 bg-white dark:bg-slate-950/80 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-center font-mono text-xs mb-3">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-medium">Distance</span>
                    <strong className="text-sm font-black text-slate-900 dark:text-cyan-400">{activeTarget.distance_m} m</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-medium">Bearing</span>
                    <strong className="text-sm font-black text-slate-900 dark:text-cyan-400">{activeTarget.bearing_deg}° {activeTarget.cardinal}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-medium">Walking Time</span>
                    <strong className="text-sm font-black text-slate-900 dark:text-cyan-400">~{activeTarget.walk_time_min || 5} min</strong>
                  </div>
                </div>

                {/* Situation text / Description */}
                {activeTarget.text && (
                  <p className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 leading-relaxed mb-3">
                    {activeTarget.text}
                  </p>
                )}

                {/* 1-Tap Action Buttons */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (onNavigateTarget && activeTarget.location) {
                        onNavigateTarget(activeTarget);
                      }
                      playChirp(1000);
                    }}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all active:scale-98"
                  >
                    <Navigation size={14} />
                    <span>Center Map on Destination</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => playChirp(activeTarget.category === 'casualty' ? 1400 : 900)}
                    className="py-2.5 px-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:border-cyan-500 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-98"
                  >
                    <Volume2 size={14} className="text-cyan-500" />
                    <span>Ping Sound</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 text-center text-xs text-slate-500">
                Select a target destination from the dropdown above to point the compass and view tactical telemetry.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
