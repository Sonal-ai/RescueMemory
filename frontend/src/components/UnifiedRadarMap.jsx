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
import { getSurvivalRadar, distM, bearingDeg, cardinalDirection } from '../api';
import MapPanel from '../MapPanel';

const COMPASS_SIZE = 300;
const COMPASS_CENTER = COMPASS_SIZE / 2;
const COMPASS_RADIUS = 120;

/**
 * Extracts true compass azimuth (0-360 degrees clockwise from North)
 * directly from hardware orientation sensors across Android WebView, Chrome, and iOS Safari.
 */
function extractCompassHeading(e) {
  // 1. iOS Safari CoreMotion: direct hardware-fused true heading (0-360 clockwise from North)
  if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
    return Number(e.webkitCompassHeading);
  }

  // 2. Android Chrome / W3C DeviceOrientationEvent:
  // e.alpha is the counter-clockwise rotation in degrees around the Z-axis (0 to 360).
  // Clockwise compass heading from North is (360 - e.alpha) % 360.
  if (e.alpha !== null && e.alpha !== undefined && !Number.isNaN(e.alpha)) {
    let heading = (360 - e.alpha) % 360;

    // Compensate for physical screen orientation (portrait vs landscape)
    if (typeof window !== 'undefined') {
      const screenAngle = window.screen?.orientation?.angle ?? (window.orientation || 0);
      if (typeof screenAngle === 'number' && !Number.isNaN(screenAngle)) {
        heading = (heading + screenAngle) % 360;
      }
    }
    return (heading + 360) % 360;
  }

  return null;
}

export default function UnifiedRadarMap({
  userLocation = { lat: 28.7041, lon: 77.1025 },
  items = [],
  peers = [],
  onSelectLocation = null,
  onNavigateTarget = null,
  onRefreshGps = null,
  selectedTarget = null,
  role = 'survivor'
}) {
  const [radarData, setRadarData] = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState(() => {
    return selectedTarget?.id || selectedTarget?.entity_id || '';
  });
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [mapFilter, setMapFilter] = useState('all');

  // Device orientation / heading state (0 = North, 90 = East, 180 = South, 270 = West)
  const [deviceHeading, setDeviceHeading] = useState(0);
  const [isCompassActive, setIsCompassActive] = useState(false);
  const [headingMode, setHeadingMode] = useState('sensor'); // 'sensor' | 'manual'
  const [manualHeading, setManualHeading] = useState(0);
  const [isAutoSweeping, setIsAutoSweeping] = useState(false);
  const [lastHapticTime, setLastHapticTime] = useState(0);

  // Audio Context Ref for offline synthetic radar/compass ping
  const audioCtxRef = useRef(null);
  const compassDialRef = useRef(null);
  const isDraggingCompass = useRef(false);

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

  // Request iOS 13+ sensor permissions on first user gesture
  const requestCompassPermission = useCallback(async () => {
    if (
      typeof window !== 'undefined' &&
      typeof window.DeviceOrientationEvent !== 'undefined' &&
      typeof window.DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        const state = await window.DeviceOrientationEvent.requestPermission();
        if (state === 'granted') {
          setIsCompassActive(true);
        }
      } catch (err) {
        console.warn('[Compass] Permission request error:', err);
      }
    }
  }, []);

  // Listen to Smartphone Compass / Magnetometer with Circular Smoothing Filter
  useEffect(() => {
    let smoothX = null;
    let smoothY = null;
    let animFrameId = null;
    let targetRawHeading = null;
    let hasAbsolute = false;
    let sensorEventCount = 0;

    const updateFilter = () => {
      if (targetRawHeading !== null) {
        const targetRad = (targetRawHeading * Math.PI) / 180;
        const targetX = Math.cos(targetRad);
        const targetY = Math.sin(targetRad);

        if (smoothX === null || smoothY === null) {
          smoothX = targetX;
          smoothY = targetY;
        } else {
          // Circular unit vector smoothing: alpha factor 0.28 gives immediate snappy response with zero jitter
          const alphaFactor = 0.28;
          smoothX = smoothX + (targetX - smoothX) * alphaFactor;
          smoothY = smoothY + (targetY - smoothY) * alphaFactor;
        }

        const smoothedDeg = ((Math.atan2(smoothY, smoothX) * 180) / Math.PI + 360) % 360;
        const rounded = Math.round(smoothedDeg);

        setDeviceHeading((prev) => {
          if (Math.abs(rounded - prev) >= 1) {
            return rounded;
          }
          return prev;
        });

        sensorEventCount++;
        if (sensorEventCount >= 2) {
          setIsCompassActive(true);
        }
      }
      animFrameId = requestAnimationFrame(updateFilter);
    };

    const handleAbsoluteOrientation = (e) => {
      const h = extractCompassHeading(e);
      if (h !== null) {
        hasAbsolute = true;
        targetRawHeading = h;
      }
    };

    const handleStandardOrientation = (e) => {
      if (hasAbsolute) return;
      const h = extractCompassHeading(e);
      if (h !== null) {
        targetRawHeading = h;
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('deviceorientationabsolute', handleAbsoluteOrientation, true);
      window.addEventListener('deviceorientation', handleStandardOrientation, true);
      animFrameId = requestAnimationFrame(updateFilter);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceorientationabsolute', handleAbsoluteOrientation, true);
        window.removeEventListener('deviceorientation', handleStandardOrientation, true);
      }
      if (animFrameId) cancelAnimationFrame(animFrameId);
    };
  }, []);

  // Continuous auto-sweep rotation demo loop
  useEffect(() => {
    if (!isAutoSweeping) return;
    const interval = setInterval(() => {
      setManualHeading((prev) => (prev + 2) % 360);
    }, 40);
    return () => clearInterval(interval);
  }, [isAutoSweeping]);

  // Touch & Pointer Dragging around the Compass Bezel
  const getAngleFromPointer = (e) => {
    if (!compassDialRef.current) return null;
    const rect = compassDialRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    if (clientX === undefined || clientY === undefined || Number.isNaN(clientX) || Number.isNaN(clientY)) return null;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    // 0 deg is North (top, dy < 0)
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return (Math.round(deg) + 360) % 360;
  };

  const handlePointerDownDial = (e) => {
    isDraggingCompass.current = true;
    setHeadingMode('manual');
    setIsAutoSweeping(false);
    const angle = getAngleFromPointer(e);
    if (angle !== null) {
      setManualHeading(angle);
    }
  };

  const handlePointerMoveDial = (e) => {
    if (!isDraggingCompass.current) return;
    const angle = getAngleFromPointer(e);
    if (angle !== null) {
      setManualHeading(angle);
    }
  };

  const handlePointerUpDial = () => {
    isDraggingCompass.current = false;
  };

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

  const radarItems = useMemo(() => radarData?.radar_items || [], [radarData]);
  const summary = useMemo(() => radarData?.summary || {
    urgent_casualties: 0,
    total_casualties: 0,
    operational_shelters: 0,
    active_peers: 0
  }, [radarData]);

  // Synchronize with external selectedTarget updates (e.g. from SafePlace or nearest casualty)
  useEffect(() => {
    if (selectedTarget) {
      const targetId = selectedTarget.id || selectedTarget.entity_id;
      if (targetId) {
        setSelectedTargetId(targetId);
      }
    }
  }, [selectedTarget]);

  // Build unified destinations list with live relative geodesics
  const destinationOptions = useMemo(() => {
    const list = [...radarItems];
    const uLat = userLocation?.lat ?? 28.7041;
    const uLon = userLocation?.lon ?? 77.1025;

    // Check if user is near Delhi operations zone (< 50 km) or remote/testing emulator
    const isNearDelhi = distM(uLat, uLon, 28.7041, 77.1025) < 50000;

    // If external target passed (e.g. from SafePlace reroute or casualty), inject it at the top
    if (selectedTarget) {
      const targetId = selectedTarget.id || selectedTarget.entity_id || 'selected_target';
      if (!list.some((item) => item.id === targetId)) {
        const tLoc = selectedTarget.location || (selectedTarget.lat != null && selectedTarget.lon != null ? { lat: selectedTarget.lat, lon: selectedTarget.lon } : null) || { lat: uLat + 0.005, lon: uLon - 0.004 };
        const d = Math.round(distM(uLat, uLon, tLoc.lat, tLoc.lon));
        const b = bearingDeg(uLat, uLon, tLoc.lat, tLoc.lon);
        list.unshift({
          id: targetId,
          name: selectedTarget.name || selectedTarget.title || 'Selected Facility',
          category: selectedTarget.category || (selectedTarget.kind === 'incident' ? 'casualty' : selectedTarget.kind === 'hazard' ? 'hazard' : 'shelter'),
          distance_m: d,
          bearing_deg: b,
          cardinal: cardinalDirection(b),
          walk_time_min: Math.max(1, Math.round(d / 75)),
          location: tLoc,
          triage_level: selectedTarget.status === 'Operational' ? 'safe_green' : (selectedTarget.severity === 'red' ? 'immediate_red' : 'hazard_warning'),
          text: selectedTarget.text || (Array.isArray(selectedTarget.facilities) ? selectedTarget.facilities.join(', ') : 'Rerouted safe location')
        });
      }
    }

    // Baseline facilities: realistically positioned near userLocation
    const baseline = [
      {
        id: 'priority_casualty',
        name: 'Urgent Casualty (Fracture & Trauma SOS)',
        category: 'casualty',
        location: isNearDelhi ? { lat: 28.7085, lon: 77.1002 } : { lat: uLat + 0.0035, lon: uLon - 0.0022 },
        triage_level: 'immediate_red',
        text: 'Survivor unable to walk unassisted, severe fracture requiring splinting & rapid evacuation.'
      },
      {
        id: 'shelter_alpha',
        name: 'Shelter Alpha (Central High - Safe Haven)',
        category: 'shelter',
        location: isNearDelhi ? { lat: 28.7120, lon: 77.0980 } : { lat: uLat + 0.0062, lon: uLon - 0.0048 },
        triage_level: 'safe_green',
        text: 'Verified safe high-ground shelter with food, emergency surgery & power generator.'
      },
      {
        id: 'water_point_4',
        name: 'Clean Water Depot (North Gate Tanker 4)',
        category: 'resource',
        location: isNearDelhi ? { lat: 28.7060, lon: 77.1080 } : { lat: uLat + 0.0028, lon: uLon + 0.0041 },
        triage_level: 'safe_green',
        text: 'Drinkable water distribution depot guarded by emergency relief corps.'
      },
      {
        id: 'cp_17',
        name: 'Checkpoint CP-17 (North Bridge)',
        category: 'hazard',
        location: isNearDelhi ? { lat: 28.7041, lon: 77.1065 } : { lat: uLat + 0.0005, lon: uLon + 0.0032 },
        triage_level: 'hazard_warning',
        text: 'Caution: Submerged entrance & downed live wires. Exercise caution.'
      }
    ].map((item) => {
      const d = Math.round(distM(uLat, uLon, item.location.lat, item.location.lon));
      const b = bearingDeg(uLat, uLon, item.location.lat, item.location.lon);
      return {
        ...item,
        distance_m: d,
        bearing_deg: b,
        cardinal: cardinalDirection(b),
        walk_time_min: Math.max(1, Math.round(d / 75))
      };
    });

    baseline.forEach((b) => {
      if (!list.some((item) => item.id === b.id)) {
        list.push(b);
      }
    });

    return list;
  }, [radarItems, selectedTarget, userLocation]);

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

  // Current heading to use: device magnetometer if sensor active, else manual dial
  const currentHeading = headingMode === 'sensor' && isCompassActive ? deviceHeading : manualHeading;

  // Real-time geodesic metrics between userLocation and activeTarget.location
  const liveTargetMetrics = useMemo(() => {
    if (!activeTarget) {
      return { bearing: 0, distance: 0, cardinal: 'N' };
    }
    const tLoc = activeTarget.location || (activeTarget.lat != null && activeTarget.lon != null ? { lat: activeTarget.lat, lon: activeTarget.lon } : null);
    const uLat = userLocation?.lat;
    const uLon = userLocation?.lon;

    if (!tLoc || tLoc.lat == null || tLoc.lon == null || uLat == null || uLon == null) {
      return {
        bearing: activeTarget.bearing_deg ?? 0,
        distance: activeTarget.distance_m ?? 0,
        cardinal: activeTarget.cardinal || 'N'
      };
    }

    const d = Math.round(distM(uLat, uLon, tLoc.lat, tLoc.lon));
    const b = bearingDeg(uLat, uLon, tLoc.lat, tLoc.lon);
    const c = cardinalDirection(b);
    return { bearing: b, distance: d, cardinal: c };
  }, [activeTarget, userLocation]);

  const targetBearing = liveTargetMetrics.bearing;
  const targetDistance = liveTargetMetrics.distance;
  const targetCardinal = liveTargetMetrics.cardinal;

  // Relative Bearing: Difference between device heading and target bearing
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
    if (!isAligned && angularError <= 10) {
      setIsAligned(true);
    } else if (isAligned && angularError >= 15) {
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
        navigator.vibrate([40, 50, 40]);
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
    <div className="flex flex-col gap-2.5 sm:gap-3 text-slate-900 dark:text-slate-100">
      {/* Sleek, Simplified Tactical Radar & Destination Header */}
      <div className="bg-[#f0f5fa] dark:bg-[#0b1626] border border-[#cfe1f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-3.5 shadow-xs transition-all">
        <div className="flex items-center justify-between gap-2 mb-2">
          {/* Title and Status */}
          <div className="flex items-center gap-1.5">
            <div className="h-6 w-6 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-xs shrink-0">
              <Navigation size={13} />
            </div>
            <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <span>Radar Map</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Offline Active" />
            </h2>
          </div>

          {/* Right Action Menu: GPS Pill, Options and Refresh */}
          <div className="flex items-center gap-1">
            {userLocation?.lat != null && (
              <button
                type="button"
                onClick={onRefreshGps}
                title="Your current GPS coordinates. Tap to refresh."
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg border border-[#cbdbe9] dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-mono font-semibold hover:border-cyan-500 transition-colors"
              >
                <MapPin size={10} className="text-cyan-600 dark:text-cyan-400" />
                <span>{userLocation.lat.toFixed(3)}, {userLocation.lon.toFixed(3)}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 transition-all ${
                showSettings
                  ? 'bg-slate-900 text-white dark:bg-cyan-500 dark:text-slate-950 border-transparent shadow-xs'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-[#cbdbe9] dark:border-slate-800 hover:bg-[#edf5fb] dark:hover:bg-slate-800'
              }`}
              title="Toggle gyro and audio settings"
            >
              <Settings2 size={12} />
              <span>Options</span>
              <ChevronDown size={11} className={`transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`} />
            </button>

            <button
              type="button"
              onClick={fetchRadar}
              disabled={loading}
              className="p-1 rounded-lg border border-[#cbdbe9] dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-[#edf5fb] dark:hover:bg-slate-800 transition-colors"
              title="Refresh local radar"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Streamlined Destination Selector Bar */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-red-500">
            <MapPin size={14} />
          </div>
          <select
            value={selectedTargetId}
            onChange={(e) => handleSelectDestination(e.target.value)}
            className="w-full appearance-none py-1.5 pl-8 pr-8 rounded-xl border border-[#cbd5e1] dark:border-slate-700 bg-white dark:bg-[#07111e] text-slate-900 dark:text-slate-100 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer shadow-xs"
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
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400">
            <ChevronDown size={14} />
          </div>
        </div>

        {/* Quick Facility Target Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 mt-2 no-scrollbar">
          {destinationOptions.slice(0, 5).map((dest) => {
            const isSelected = selectedTargetId === dest.id;
            const isCas = dest.category === 'casualty';
            const isShelter = dest.category === 'shelter';
            return (
              <button
                key={dest.id}
                type="button"
                onClick={() => handleSelectDestination(dest.id)}
                className={`text-[10.5px] px-2.5 py-1 rounded-lg border font-bold shrink-0 flex items-center gap-1 transition-all ${
                  isSelected
                    ? 'bg-cyan-600 text-white border-cyan-500 shadow-xs ring-1 ring-cyan-400'
                    : isCas
                    ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/60 hover:border-red-400'
                    : isShelter
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60 hover:border-emerald-400'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-[#cbdbe9] dark:border-slate-800 hover:border-cyan-500'
                }`}
              >
                <span>{isCas ? '🆘' : isShelter ? '🏥' : dest.category === 'resource' ? '💧' : '📍'}</span>
                <span className="truncate max-w-[130px]">{dest.name.split('(')[0].trim()}</span>
              </button>
            );
          })}
        </div>

        {/* Collapsible Secondary Controls Drawer */}
        {showSettings && (
          <div className="mt-2 pt-2 border-t border-[#dbe6f0] dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 animate-in fade-in">
            <div className="flex items-center gap-1.5">
              <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                isCompassActive
                  ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-400/40 dark:border-emerald-500/20'
                  : 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-400/40 dark:border-amber-500/20'
              }`}>
                {isCompassActive ? 'SENSOR ACTIVE' : 'TOUCH SIMULATOR'}
              </span>

              <button
                type="button"
                onClick={() => setAudioEnabled(!audioEnabled)}
                className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 transition-all ${
                  audioEnabled
                    ? 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-400 border-cyan-400/40'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-400 border-[#cbdbe9] dark:border-slate-800'
                }`}
                title={audioEnabled ? 'Audio ping active' : 'Turn on audio ping beacon'}
              >
                {audioEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
                <span>Ping Sound</span>
              </button>
            </div>

            {activeTarget && (
              <span className="text-[10px] font-mono text-cyan-800 dark:text-cyan-400 font-bold ml-auto">
                Locked: {activeTarget.name} ({targetDistance}m · {targetCardinal})
              </span>
            )}
          </div>
        )}
      </div>

      {/* TOP VIEW: Interactive Tactical Map */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-4 shadow-xs text-slate-900 dark:text-slate-100">
        {/* Map Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
          <div className="flex flex-wrap gap-1">
            {[
              ['all', 'All'],
              ['sos', 'SOS'],
              ['hazard', 'Hazards'],
              ['resource', 'Safe Spots']
            ].map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => setMapFilter(f)}
                className={`text-[11px] px-2.5 py-0.5 rounded-lg border font-bold transition-all ${
                  mapFilter === f
                    ? 'bg-slate-900 text-white dark:bg-cyan-500 dark:text-slate-950 border-transparent shadow-xs'
                    : 'border-[#cbdbe9] dark:border-slate-800 bg-[#e6f0f7] dark:bg-slate-900 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-[#d9e8f4]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            {filteredMapItems.length} points
          </div>
        </div>

        {/* Map Canvas */}
        <div className="relative rounded-xl overflow-hidden border border-[#e8e4db] dark:border-slate-800">
          <MapPanel
            center={userLocation}
            items={filteredMapItems}
            peers={peers}
            selected={activeTarget?.location || userLocation}
            onSelect={onSelectLocation}
            onMarker={(item) => {
              if (!item) return;
              const matched = destinationOptions.find(
                (d) => d.id === item.id || d.name === item.entity_id || d.name?.includes(item.entity_id || '')
              );
              if (matched) {
                handleSelectDestination(matched.id);
              } else {
                const newTarget = {
                  id: item.id || item.entity_id || `marker_${Date.now()}`,
                  name: item.title || item.name || item.entity_id || 'Tapped Map Marker',
                  category: item.kind === 'incident' ? 'casualty' : item.kind === 'hazard' ? 'hazard' : 'resource',
                  location: item.location || { lat: item.lat, lon: item.lon },
                  text: item.text || item.summary || 'Selected map location'
                };
                setSelectedTargetId(newTarget.id);
                playChirp(newTarget.category === 'casualty' ? 1200 : 800);
                if (onNavigateTarget) onNavigateTarget(newTarget);
              }
            }}
          />

          {/* Compass Rose Mini Watermark overlay on map */}
          <div className="absolute top-2.5 right-2.5 bg-slate-900/80 backdrop-blur-md border border-slate-700/60 rounded-lg px-2 py-0.5 text-[10px] font-mono text-cyan-300 font-bold flex items-center gap-1 shadow-sm">
            <Compass size={11} className="text-cyan-400" />
            <span>N {String(Math.round(currentHeading)).padStart(3, '0')}°</span>
          </div>
        </div>
      </div>

      {/* JUST BELOW THE MAP: Working 360° Compass Pointer & Live Azimuth Dial */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          {/* Compass SVG Housing & Interactive Bezel */}
          <div className="flex flex-col items-center justify-center shrink-0 w-full lg:w-auto">
            <div
              ref={compassDialRef}
              onPointerDown={handlePointerDownDial}
              onPointerMove={handlePointerMoveDial}
              onPointerUp={handlePointerUpDial}
              onPointerLeave={handlePointerUpDial}
              onClick={requestCompassPermission}
              className="relative w-[260px] h-[260px] sm:w-[300px] sm:h-[300px] flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none"
              title="Touch and drag to rotate compass, or move phone to use live gyroscope"
            >
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
                    className={isCompassActive && headingMode === 'sensor' ? 'transition-none' : 'transition-transform duration-300 ease-out'}
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
                  {activeTarget ? `${targetDistance}m` : '0m'}
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
                  {targetCardinal}
                </text>
              </svg>
            </div>

            {/* Compass Control Toolbar: Quick Turns, Target Lock, Auto Sweep */}
            <div className="mt-3 w-full max-w-[320px] flex flex-col gap-2">
              <div className="grid grid-cols-4 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setHeadingMode('manual');
                    setIsAutoSweeping(false);
                    setManualHeading((prev) => (prev - 45 + 360) % 360);
                  }}
                  className="py-1 px-1.5 rounded-lg border border-[#cbdbe9] dark:border-slate-800 bg-[#f0f5fa] dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-[11px] font-mono font-bold hover:border-cyan-500 transition-all active:scale-95"
                  title="Turn left 45 degrees"
                >
                  -45°
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setHeadingMode('manual');
                    setIsAutoSweeping(false);
                    setManualHeading(0);
                  }}
                  className="py-1 px-1.5 rounded-lg border border-[#cbdbe9] dark:border-slate-800 bg-[#f0f5fa] dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-[11px] font-mono font-bold hover:border-cyan-500 transition-all active:scale-95"
                  title="Face North (0 degrees)"
                >
                  0° N
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setHeadingMode('manual');
                    setIsAutoSweeping(false);
                    setManualHeading((prev) => (prev + 45) % 360);
                  }}
                  className="py-1 px-1.5 rounded-lg border border-[#cbdbe9] dark:border-slate-800 bg-[#f0f5fa] dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-[11px] font-mono font-bold hover:border-cyan-500 transition-all active:scale-95"
                  title="Turn right 45 degrees"
                >
                  +45°
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setHeadingMode('manual');
                    setIsAutoSweeping(false);
                    setManualHeading(targetBearing);
                    playChirp(1200);
                    if (typeof navigator !== 'undefined' && navigator.vibrate) {
                      navigator.vibrate([40, 50, 40]);
                    }
                  }}
                  className="py-1 px-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center justify-center gap-0.5 transition-all shadow-xs active:scale-95"
                  title="Instantly face locked destination azimuth"
                >
                  <Crosshair size={11} />
                  <span>Align</span>
                </button>
              </div>

              {/* Secondary Demo Tools: Mode Switcher & Auto Sweep */}
              <div className="flex items-center justify-between gap-1.5 bg-[#f0f5fa] dark:bg-slate-900/80 p-1.5 rounded-xl border border-[#cbdbe9] dark:border-slate-800 text-[11px] font-mono">
                <button
                  type="button"
                  onClick={() => {
                    setIsAutoSweeping(false);
                    setHeadingMode((prev) => (prev === 'sensor' ? 'manual' : 'sensor'));
                    if (headingMode === 'manual') {
                      requestCompassPermission();
                    }
                  }}
                  className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
                    headingMode === 'sensor' && isCompassActive
                      ? 'bg-emerald-500 text-slate-950 font-black shadow-xs'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                  title="Switch between live gyroscope sensor and manual touch drag"
                >
                  {headingMode === 'sensor' && isCompassActive ? '📱 Gyro Live' : '✋ Touch Mode'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setHeadingMode('manual');
                    setIsAutoSweeping((prev) => !prev);
                  }}
                  className={`px-2 py-0.5 rounded-lg font-bold flex items-center gap-1 transition-all ${
                    isAutoSweeping
                      ? 'bg-amber-500 text-slate-950 font-black animate-pulse'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-[#cbdbe9] dark:border-slate-700'
                  }`}
                  title="Run continuous 360-degree rotation demo"
                >
                  <RotateCw size={11} className={isAutoSweeping ? 'animate-spin' : ''} />
                  <span>{isAutoSweeping ? 'Sweeping...' : 'Auto-Sweep'}</span>
                </button>

                <span className="text-[10px] text-cyan-600 dark:text-cyan-400 font-bold ml-auto tabular-nums">
                  {Math.round(currentHeading)}°
                </span>
              </div>
            </div>
          </div>

          {/* Locked Target Navigation Telemetry & Alignment Guide */}
          <div className="flex-1 min-w-0 w-full flex flex-col gap-2.5">
            {/* Live Alignment Action Banner with FIXED HEIGHT */}
            <div className="w-full font-mono h-[38px] min-h-[38px] flex items-center justify-center">
              {isAligned ? (
                <div className="w-full h-full rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs animate-pulse px-2.5">
                  <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                  <span className="truncate">ON TARGET · PROCEED STRAIGHT</span>
                </div>
              ) : turnRightAngle > 0 ? (
                <div className="w-full h-full rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-900 dark:text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 px-2.5">
                  <ArrowRight size={15} className="text-amber-600 shrink-0" />
                  <span className="truncate tabular-nums">TURN RIGHT {Math.round(turnRightAngle)}° TO ALIGN</span>
                </div>
              ) : (
                <div className="w-full h-full rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-900 dark:text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 px-2.5">
                  <ArrowLeft size={15} className="text-amber-600 shrink-0" />
                  <span className="truncate tabular-nums">TURN LEFT {Math.round(turnLeftAngle)}° TO ALIGN</span>
                </div>
              )}
            </div>

            {/* Target Card Details */}
            {activeTarget ? (
              <div
                className={`p-3 sm:p-3.5 rounded-xl border transition-all shadow-xs ${
                  activeTarget.category === 'casualty'
                    ? 'bg-red-50/80 dark:bg-red-950/20 border-red-300 dark:border-red-500/60'
                    : activeTarget.category === 'shelter'
                    ? 'bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-500/60'
                    : 'bg-[#f0f5fa] dark:bg-slate-900/60 border-[#dbe6f0] dark:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-2 mb-2">
                  <div
                    className={`p-1.5 rounded-lg shrink-0 ${
                      activeTarget.category === 'casualty'
                        ? 'bg-red-600 text-white'
                        : activeTarget.category === 'shelter'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-cyan-600 text-white'
                    }`}
                  >
                    {activeTarget.category === 'casualty' ? (
                      <HeartPulse size={16} className="animate-pulse" />
                    ) : activeTarget.category === 'shelter' ? (
                      <ShieldCheck size={16} />
                    ) : activeTarget.category === 'resource' ? (
                      <Droplets size={16} />
                    ) : (
                      <MapPin size={16} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded-full ${
                          activeTarget.category === 'casualty'
                            ? 'bg-red-600 text-white animate-pulse'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {activeTarget.category === 'casualty' ? 'PRIORITY CASUALTY' : 'SAFE DESTINATION'}
                      </span>
                      <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300">
                        Azimuth {String(targetBearing).padStart(3, '0')}° ({targetCardinal})
                      </span>
                    </div>
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate mt-0.5">
                      {activeTarget.name}
                    </h3>
                  </div>
                </div>

                {/* Metrics Matrix */}
                <div className="grid grid-cols-3 gap-1.5 bg-[#f8fafc] dark:bg-slate-950/80 p-2 rounded-lg border border-[#dbe6f0] dark:border-slate-800 text-center font-mono text-[11px] mb-2">
                  <div>
                    <span className="text-[9px] text-slate-500 uppercase block font-medium">Distance</span>
                    <strong className="text-xs font-black text-slate-900 dark:text-cyan-400">{targetDistance} m</strong>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 uppercase block font-medium">Bearing</span>
                    <strong className="text-xs font-black text-slate-900 dark:text-cyan-400">{targetBearing}° {targetCardinal}</strong>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 uppercase block font-medium">Walk</span>
                    <strong className="text-xs font-black text-slate-900 dark:text-cyan-400">~{Math.max(1, Math.round(targetDistance / 75))} min</strong>
                  </div>
                </div>

                {/* Situation text / Description */}
                {activeTarget.text && (
                  <p className="text-[11px] text-slate-800 dark:text-slate-300 bg-[#f8fafc] dark:bg-slate-950/60 p-2 rounded-lg border border-[#dbe6f0] dark:border-slate-800/80 leading-relaxed mb-2 font-medium">
                    {activeTarget.text}
                  </p>
                )}

                {/* 1-Tap Action Buttons */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (onNavigateTarget && activeTarget.location) {
                        onNavigateTarget(activeTarget);
                      }
                      playChirp(1000);
                    }}
                    className="flex-1 py-1.5 px-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-xs transition-all active:scale-98"
                  >
                    <Navigation size={13} />
                    <span>Center Map on Target</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => playChirp(activeTarget.category === 'casualty' ? 1400 : 900)}
                    className="py-1.5 px-2.5 rounded-lg border border-[#cbdbe9] dark:border-slate-700 hover:border-cyan-500 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1 transition-all active:scale-98"
                  >
                    <Volume2 size={13} className="text-cyan-600 dark:text-cyan-400" />
                    <span>Ping</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-dashed border-[#cbdbe9] dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                Select a target destination from the dropdown above to point the compass and view tactical telemetry.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
