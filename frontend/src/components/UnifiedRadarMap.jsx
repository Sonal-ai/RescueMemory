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
  Settings2,
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
  const [showSettings, setShowSettings] = useState(false);
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

  // Listen to Smartphone Compass / Magnetometer with Low-Pass EMA Filter
  useEffect(() => {
    let smoothedHeading = null;
    let animFrameId = null;
    let targetRawHeading = null;

    const updateFilter = () => {
      if (targetRawHeading !== null) {
        if (smoothedHeading === null) {
          smoothedHeading = targetRawHeading;
        } else {
          // Calculate shortest angular distance
          let diff = (targetRawHeading - smoothedHeading) % 360;
          if (diff < -180) diff += 360;
          if (diff > 180) diff -= 360;

          // Low-pass exponential smoothing factor (0.16 gives silky damping without sluggishness)
          smoothedHeading = (smoothedHeading + diff * 0.16 + 360) % 360;
        }

        const rounded = Math.round(smoothedHeading);
        setDeviceHeading((prev) => {
          // Deadband: Only re-render when change is at least 1 degree
          if (Math.abs(rounded - prev) >= 1) {
            return rounded;
          }
          return prev;
        });
        setIsCompassActive(true);
      }
      animFrameId = requestAnimationFrame(updateFilter);
    };

    const handleOrientation = (e) => {
      let heading = null;
      if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
        heading = e.webkitCompassHeading;
      } else if (e.alpha !== null && e.alpha !== undefined) {
        heading = (360 - e.alpha) % 360;
      }
      if (heading !== null && !Number.isNaN(heading)) {
        targetRawHeading = heading;
      }
    };

    if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
      animFrameId = requestAnimationFrame(updateFilter);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
        window.removeEventListener('deviceorientation', handleOrientation, true);
      }
      if (animFrameId) cancelAnimationFrame(animFrameId);
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
  const targetBearing = activeTarget?.bearing_deg ?? 0;
  const relativeAngle = ((targetBearing - currentHeading + 360) % 360);

  // Maintain continuous smooth needle rotation (prevents 360° flip spins)
  const [needleAngle, setNeedleAngle] = useState(0);
  useEffect(() => {
    setNeedleAngle((prev) => {
      let delta = (relativeAngle - (prev % 360) + 540) % 360 - 180;
      return prev + delta;
    });
  }, [relativeAngle]);

  // Alignment Calculation with Hysteresis (prevents edge flickering between aligned and turning)
  const [isAligned, setIsAligned] = useState(false);
  const angularError = Math.abs(((relativeAngle + 180) % 360) - 180);

  useEffect(() => {
    if (!isAligned && angularError <= 8) {
      setIsAligned(true);
    } else if (isAligned && angularError >= 13) {
      setIsAligned(false);
    }
  }, [angularError, isAligned]);

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
    <div className="flex flex-col gap-4 text-slate-900 dark:text-slate-100">
      {/* Sleek, Simplified Tactical Radar & Destination Header */}
      <div className="bg-[#f0f5fa] dark:bg-[#0b1626] border border-[#cfe1f0] dark:border-slate-800 rounded-3xl p-3.5 sm:p-4 shadow-sm transition-all">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          {/* Title and Status */}
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-sm shrink-0">
              <Navigation size={15} />
            </div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>Radar Map & Compass</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Offline Active" />
            </h2>
          </div>

          {/* Right Action Menu: Options and Refresh */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className={`px-2.5 py-1 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
                showSettings
                  ? 'bg-slate-900 text-white dark:bg-cyan-500 dark:text-slate-950 border-transparent shadow-xs'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-[#cbdbe9] dark:border-slate-800 hover:bg-[#edf5fb] dark:hover:bg-slate-800'
              }`}
              title="Toggle gyro and audio settings"
            >
              <Settings2 size={13} />
              <span>Options</span>
              <ChevronDown size={12} className={`transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`} />
            </button>

            <button
              type="button"
              onClick={fetchRadar}
              disabled={loading}
              className="p-1.5 rounded-xl border border-[#cbdbe9] dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-[#edf5fb] dark:hover:bg-slate-800 transition-colors"
              title="Refresh local radar"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Streamlined Destination Selector Bar */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-red-500">
            <MapPin size={16} />
          </div>
          <select
            value={selectedTargetId}
            onChange={(e) => handleSelectDestination(e.target.value)}
            className="w-full appearance-none py-2.5 pl-10 pr-10 rounded-2xl border-2 border-[#cbd5e1] dark:border-slate-700 bg-white dark:bg-[#07111e] text-slate-900 dark:text-slate-100 text-xs sm:text-sm font-bold focus:outline-none focus:ring-2 focus:ring-cyan-500 cursor-pointer shadow-inner"
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
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
            <ChevronDown size={16} />
          </div>
        </div>

        {/* Collapsible Secondary Controls Drawer */}
        {showSettings && (
          <div className="mt-2.5 pt-2.5 border-t border-[#dbe6f0] dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5 animate-in fade-in">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg border ${
                isCompassActive
                  ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-400/40 dark:border-emerald-500/20'
                  : 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-400/40 dark:border-amber-500/20'
              }`}>
                {isCompassActive ? 'GYRO HARDWARE ACTIVE' : 'NORTH REFERENCE MODE'}
              </span>

              <button
                type="button"
                onClick={() => setAudioEnabled(!audioEnabled)}
                className={`px-2.5 py-1 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
                  audioEnabled
                    ? 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-400 border-cyan-400/40'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-400 border-[#cbdbe9] dark:border-slate-800'
                }`}
                title={audioEnabled ? 'Audio ping active' : 'Turn on audio ping beacon'}
              >
                {audioEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                <span>Beacon Ping Audio</span>
              </button>
            </div>

            {activeTarget && (
              <span className="text-[11px] font-mono text-cyan-800 dark:text-cyan-400 font-bold ml-auto">
                Locked: {activeTarget.name} ({activeTarget.distance_m}m · {activeTarget.cardinal})
              </span>
            )}
          </div>
        )}
      </div>

      {/* TOP VIEW: Interactive Tactical Map */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xs text-slate-900 dark:text-slate-100">
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
                    ? 'bg-slate-900 text-white dark:bg-cyan-500 dark:text-slate-950 border-transparent shadow-xs'
                    : 'border-[#cbdbe9] dark:border-slate-800 bg-[#e6f0f7] dark:bg-slate-900 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-[#d9e8f4]'
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
        <div className="relative rounded-2xl overflow-hidden border border-[#e8e4db] dark:border-slate-800">
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
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xs">
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
                    transform={`rotate(${needleAngle} ${COMPASS_CENTER} ${COMPASS_CENTER})`}
                    filter="url(#needleGlow)"
                    className="transition-transform duration-200 ease-out"
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
              <div className="mt-3 w-full max-w-[280px] bg-[#f0f5fa] dark:bg-slate-900/60 p-2.5 rounded-2xl border border-[#dbe6f0] dark:border-slate-800 text-center">
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
            {/* Live Alignment Action Banner with FIXED HEIGHT to guarantee ZERO layout shift */}
            <div className="w-full font-mono h-[52px] min-h-[52px] flex items-center justify-center">
              {isAligned ? (
                <div className="w-full h-full rounded-2xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs animate-pulse px-3">
                  <CheckCircle2 size={17} className="text-emerald-500 shrink-0" />
                  <span className="truncate">ON TARGET · PROCEED STRAIGHT</span>
                </div>
              ) : turnRightAngle > 0 ? (
                <div className="w-full h-full rounded-2xl bg-amber-500/10 border border-amber-500/40 text-amber-900 dark:text-amber-300 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 px-3">
                  <ArrowRight size={17} className="text-amber-600 shrink-0" />
                  <span className="truncate tabular-nums">TURN RIGHT {Math.round(turnRightAngle)}° TO ALIGN</span>
                </div>
              ) : (
                <div className="w-full h-full rounded-2xl bg-amber-500/10 border border-amber-500/40 text-amber-900 dark:text-amber-300 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 px-3">
                  <ArrowLeft size={17} className="text-amber-600 shrink-0" />
                  <span className="truncate tabular-nums">TURN LEFT {Math.round(turnLeftAngle)}° TO ALIGN</span>
                </div>
              )}
            </div>

            {/* Target Card Details */}
            {activeTarget ? (
              <div
                className={`p-4 sm:p-5 rounded-2xl border-2 transition-all shadow-xs ${
                  activeTarget.category === 'casualty'
                    ? 'bg-red-50/80 dark:bg-red-950/20 border-red-300 dark:border-red-500/60'
                    : activeTarget.category === 'shelter'
                    ? 'bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-500/60'
                    : 'bg-[#f0f5fa] dark:bg-slate-900/60 border-[#dbe6f0] dark:border-slate-700'
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
                <div className="grid grid-cols-3 gap-2 bg-[#f8fafc] dark:bg-slate-950/80 p-3 rounded-xl border border-[#dbe6f0] dark:border-slate-800 text-center font-mono text-xs mb-3">
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
                  <p className="text-xs text-slate-800 dark:text-slate-300 bg-[#f8fafc] dark:bg-slate-950/60 p-3 rounded-xl border border-[#dbe6f0] dark:border-slate-800/80 leading-relaxed mb-3 font-medium">
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
                    className="flex-1 py-2.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-98"
                  >
                    <Navigation size={14} />
                    <span>Center Map on Destination</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => playChirp(activeTarget.category === 'casualty' ? 1400 : 900)}
                    className="py-2.5 px-3 rounded-xl border border-[#cbdbe9] dark:border-slate-700 hover:border-cyan-500 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-98"
                  >
                    <Volume2 size={14} className="text-cyan-600 dark:text-cyan-400" />
                    <span>Ping Sound</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-2xl border border-dashed border-[#cbdbe9] dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                Select a target destination from the dropdown above to point the compass and view tactical telemetry.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
