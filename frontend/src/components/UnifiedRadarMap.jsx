import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Compass,
  Droplets,
  HeartPulse,
  MapPin,
  Navigation,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getSurvivalRadar, distM, bearingDeg, cardinalDirection, watchNativeOrWebLocation } from '../api';
import MapPanel from '../MapPanel';

const COMPASS_SIZE = 220;
const COMPASS_CENTER = COMPASS_SIZE / 2;
const COMPASS_RADIUS = 88;

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
  const [lastHapticTime, setLastHapticTime] = useState(0);

  // Live Physical GPS Streaming State for Walking Navigation
  const [liveCoords, setLiveCoords] = useState(() => ({
    lat: userLocation?.lat ?? 28.7041,
    lon: userLocation?.lon ?? 77.1025
  }));
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [isLiveWalking, setIsLiveWalking] = useState(false);
  const [totalMetersWalked, setTotalMetersWalked] = useState(0);

  // Keep a fixed physical world anchor for baseline demo facilities so they remain stationary on the ground
  const baselineAnchorRef = useRef(null);
  if (!baselineAnchorRef.current) {
    baselineAnchorRef.current = {
      lat: userLocation?.lat ?? 28.7041,
      lon: userLocation?.lon ?? 77.1025
    };
  }

  // Update liveCoords if parent explicitly overrides location significantly (>5m)
  useEffect(() => {
    if (userLocation?.lat != null && userLocation?.lon != null) {
      setLiveCoords((prev) => {
        if (!prev) return { lat: userLocation.lat, lon: userLocation.lon };
        const delta = distM(prev.lat, prev.lon, userLocation.lat, userLocation.lon);
        if (delta > 5) {
          return { lat: userLocation.lat, lon: userLocation.lon };
        }
        return prev;
      });
    }
  }, [userLocation]);

  // Continuous Hardware GPS Satellite streaming hook
  useEffect(() => {
    let cleanup = null;
    let isSubscribed = true;

    const startStreamingGps = async () => {
      try {
        const unsub = await watchNativeOrWebLocation(
          (pos) => {
            if (!isSubscribed) return;
            const newLat = pos.lat;
            const newLon = pos.lon;
            const acc = pos.accuracy ? Math.round(pos.accuracy) : null;

            setLiveCoords((prev) => {
              if (prev?.lat != null && prev?.lon != null) {
                const step = distM(prev.lat, prev.lon, newLat, newLon);
                if (step >= 0.4) {
                  setTotalMetersWalked((w) => Math.round(w + step));
                }
              }
              return { lat: newLat, lon: newLon };
            });

            setGpsAccuracy(acc);
            setIsLiveWalking(true);

            if (onSelectLocation) {
              onSelectLocation({ lat: newLat, lon: newLon, accuracy: acc });
            }
          },
          (err) => {
            console.warn('[Radar] GPS streaming notice:', err);
          }
        );
        cleanup = unsub;
      } catch (err) {
        console.warn('[Radar] Failed to start GPS watcher:', err);
      }
    };

    startStreamingGps();

    return () => {
      isSubscribed = false;
      if (typeof cleanup === 'function') {
        cleanup();
      }
    };
  }, [onSelectLocation]);

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

  // Listen to Smartphone Compass / Magnetometer with Circular Smoothing & Deadband Filter
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
          // Circular unit vector smoothing: alpha factor 0.12 provides smooth marine-compass damping without erratic deflection
          const alphaFactor = 0.12;
          smoothX = smoothX + (targetX - smoothX) * alphaFactor;
          smoothY = smoothY + (targetY - smoothY) * alphaFactor;
        }

        const smoothedDeg = ((Math.atan2(smoothY, smoothX) * 180) / Math.PI + 360) % 360;
        const rounded = Math.round(smoothedDeg);

        // Deadband filter: ignore noisy micro-variations (< 2 degrees) to stop rapid vibration
        setDeviceHeading((prev) => {
          const diff = Math.abs(((rounded - prev + 540) % 360) - 180);
          if (diff >= 2) {
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

  // Fetch Radar Signals from Qdrant Edge Memory
  const locLat = liveCoords?.lat ?? userLocation?.lat ?? 28.7041;
  const locLon = liveCoords?.lon ?? userLocation?.lon ?? 77.1025;

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

  const handleManualRefreshGps = useCallback(async () => {
    if (onRefreshGps) {
      await onRefreshGps();
    }
    if (liveCoords?.lat && liveCoords?.lon) {
      baselineAnchorRef.current = { lat: liveCoords.lat, lon: liveCoords.lon };
    }
    fetchRadar();
  }, [onRefreshGps, liveCoords, fetchRadar]);

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
    const uLat = liveCoords?.lat ?? userLocation?.lat ?? 28.7041;
    const uLon = liveCoords?.lon ?? userLocation?.lon ?? 77.1025;

    // Use initial physical anchor for synthetic/baseline facilities so they remain FIXED on the ground
    const aLat = baselineAnchorRef.current?.lat ?? uLat;
    const aLon = baselineAnchorRef.current?.lon ?? uLon;

    // Check if anchor is near Delhi operations zone (< 50 km)
    const isAnchorDelhi = distM(aLat, aLon, 28.7041, 77.1025) < 50000;

    // If external target passed (e.g. from SafePlace reroute or casualty), inject it at the top
    if (selectedTarget) {
      const targetId = selectedTarget.id || selectedTarget.entity_id || 'selected_target';
      if (!list.some((item) => item.id === targetId)) {
        const tLoc = selectedTarget.location || (selectedTarget.lat != null && selectedTarget.lon != null ? { lat: selectedTarget.lat, lon: selectedTarget.lon } : null) || { lat: aLat + 0.0015, lon: aLon - 0.0012 };
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
          text: selectedTarget.text || selectedTarget.description || selectedTarget.summary || (Array.isArray(selectedTarget.facilities) ? selectedTarget.facilities.join(', ') : 'Rerouted safe location')
        });
      }
    }

    // Baseline facilities: realistically anchored at fixed physical world coordinates near the starting position
    const baseline = [
      {
        id: 'priority_casualty',
        name: 'Urgent Casualty (Fracture & Trauma SOS)',
        category: 'casualty',
        location: isAnchorDelhi ? { lat: 28.7085, lon: 77.1002 } : { lat: aLat + 0.0018, lon: aLon - 0.0012 },
        triage_level: 'immediate_red',
        text: 'Survivor unable to walk unassisted, severe fracture requiring splinting & rapid evacuation.'
      },
      {
        id: 'water_point_4',
        name: 'Clean Water Depot (North Gate Tanker 4)',
        category: 'resource',
        location: isAnchorDelhi ? { lat: 28.7060, lon: 77.1080 } : { lat: aLat + 0.0012, lon: aLon + 0.0021 },
        triage_level: 'safe_green',
        text: 'Drinkable water distribution depot with verified emergency purification supply guarded by relief corps.'
      },
      {
        id: 'shelter_alpha',
        name: 'Shelter Alpha (Central High - Safe Haven)',
        category: 'shelter',
        location: isAnchorDelhi ? { lat: 28.7120, lon: 77.0980 } : { lat: aLat + 0.0035, lon: aLon - 0.0028 },
        triage_level: 'safe_green',
        text: 'Verified safe high-ground shelter with food, emergency surgery & power generator.'
      },
      {
        id: 'cp_17',
        name: 'Checkpoint CP-17 (North Bridge)',
        category: 'hazard',
        location: isAnchorDelhi ? { lat: 28.7041, lon: 77.1065 } : { lat: aLat + 0.0006, lon: aLon + 0.0010 },
        triage_level: 'hazard_warning',
        text: 'Caution: Submerged entrance & downed live wires. Exercise caution and follow northern detour.'
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
  }, [radarItems, selectedTarget, liveCoords, userLocation]);

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
    // Default 2: Clean Water Resource
    const firstResource = destinationOptions.find((i) => i.category === 'resource');
    if (firstResource) return firstResource;
    // Default 3: Nearest Safe Shelter
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

  // Current heading from smoothed device magnetometer
  const currentHeading = deviceHeading;

  // Real-time geodesic metrics between live walking GPS and activeTarget.location
  const liveTargetMetrics = useMemo(() => {
    if (!activeTarget) {
      return { bearing: 0, distance: 0, cardinal: 'N' };
    }
    const tLoc = activeTarget.location || (activeTarget.lat != null && activeTarget.lon != null ? { lat: activeTarget.lat, lon: activeTarget.lon } : null);
    const uLat = liveCoords?.lat ?? userLocation?.lat;
    const uLon = liveCoords?.lon ?? userLocation?.lon;

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
  }, [activeTarget, liveCoords, userLocation]);

  const targetBearing = liveTargetMetrics.bearing;
  const targetDistance = liveTargetMetrics.distance;
  const targetCardinal = liveTargetMetrics.cardinal;

  // Dedicated emergency situation description resolver
  const targetDescription = useMemo(() => {
    if (!activeTarget) return '';
    return (
      activeTarget.text ||
      activeTarget.description ||
      activeTarget.summary ||
      activeTarget.message ||
      activeTarget.details ||
      (Array.isArray(activeTarget.facilities) && activeTarget.facilities.length > 0
        ? `Available emergency facilities: ${activeTarget.facilities.join(', ')}`
        : activeTarget.category === 'resource'
        ? 'Drinkable fresh water depot with emergency distribution and water purification relief.'
        : activeTarget.category === 'casualty'
        ? 'Urgent casualty SOS requiring immediate clinical assistance and stretcher extraction.'
        : activeTarget.category === 'shelter'
        ? 'Verified emergency evacuation safe haven with emergency shelter and medical facilities.'
        : 'Emergency tactical location.')
    );
  }, [activeTarget]);

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
    if (!isAligned && angularError <= 12) {
      setIsAligned(true);
    } else if (isAligned && angularError >= 18) {
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
      playChirp(chosen.category === 'casualty' ? 1200 : chosen.category === 'resource' ? 950 : 800);
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
    <div className="flex flex-col gap-3 text-slate-900 dark:text-slate-100">
      {/* Sleek Tactical Radar & Destination Header */}
      <div className="bg-[#f0f5fa] dark:bg-[#0b1626] border border-[#cfe1f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs transition-all">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          {/* Title and Status */}
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-xs shrink-0">
              <Navigation size={13} />
            </div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <span>Radar & Compass</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Sensor Active" />
            </h2>
          </div>

          {/* Right Action Menu: GPS Pill, Options and Refresh */}
          <div className="flex items-center gap-1.5">
            {userLocation?.lat != null && (
              <button
                type="button"
                onClick={onRefreshGps}
                title="Your current GPS coordinates. Tap to refresh."
                className="inline-flex items-center gap-1 text-[11px] sm:text-xs px-2 py-0.5 rounded-lg border border-[#cbdbe9] dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-mono font-semibold hover:border-cyan-500 transition-colors"
              >
                <MapPin size={11} className="text-cyan-600 dark:text-cyan-400" />
                <span>{userLocation.lat.toFixed(3)}, {userLocation.lon.toFixed(3)}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className={`px-2 py-0.5 rounded-lg border text-xs font-bold flex items-center gap-1 transition-all ${
                showSettings
                  ? 'bg-slate-900 text-white dark:bg-cyan-500 dark:text-slate-950 border-transparent shadow-xs'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-[#cbdbe9] dark:border-slate-800 hover:bg-[#edf5fb] dark:hover:bg-slate-800'
              }`}
              title="Toggle audio ping settings"
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
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Streamlined Destination Selector Bar */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-red-500">
            <MapPin size={15} />
          </div>
          <select
            value={selectedTargetId}
            onChange={(e) => handleSelectDestination(e.target.value)}
            className="w-full appearance-none py-2 pl-8 pr-8 rounded-xl border border-[#cbd5e1] dark:border-slate-700 bg-white dark:bg-[#07111e] text-slate-900 dark:text-slate-100 text-[13px] sm:text-sm font-bold focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer shadow-xs"
          >
            {destinationOptions.map((dest) => {
              const isCas = dest.category === 'casualty';
              const isResource = dest.category === 'resource';
              const isShelter = dest.category === 'shelter';
              const icon = isCas ? '🆘' : isResource ? '💧' : isShelter ? '🏥' : '📍';
              return (
                <option key={dest.id} value={dest.id}>
                  {icon} {dest.name} — {dest.distance_m}m {dest.cardinal} ({dest.bearing_deg}°) {isCas ? '· IMMEDIATE HELP' : isResource ? '· FRESH WATER' : ''}
                </option>
              );
            })}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400">
            <ChevronDown size={15} />
          </div>
        </div>

        {/* Quick Facility Target Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 mt-2.5 no-scrollbar">
          {destinationOptions.slice(0, 5).map((dest) => {
            const isSelected = selectedTargetId === dest.id;
            const isCas = dest.category === 'casualty';
            const isResource = dest.category === 'resource';
            const isShelter = dest.category === 'shelter';
            return (
              <button
                key={dest.id}
                type="button"
                onClick={() => handleSelectDestination(dest.id)}
                className={`text-xs px-2.5 py-1 rounded-lg border font-bold shrink-0 flex items-center gap-1 transition-all ${
                  isSelected
                    ? 'bg-cyan-600 text-white border-cyan-500 shadow-xs ring-1 ring-cyan-400'
                    : isCas
                    ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/60 hover:border-red-400'
                    : isResource
                    ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900/60 hover:border-sky-400'
                    : isShelter
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60 hover:border-emerald-400'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-[#cbdbe9] dark:border-slate-800 hover:border-cyan-500'
                }`}
              >
                <span>{isCas ? '🆘' : isResource ? '💧' : isShelter ? '🏥' : '📍'}</span>
                <span className="truncate max-w-[140px]">{dest.name.split('(')[0].trim()}</span>
              </button>
            );
          })}
        </div>

        {/* Collapsible Secondary Options Drawer */}
        {showSettings && (
          <div className="mt-2.5 pt-2 border-t border-[#dbe6f0] dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 animate-in fade-in">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                isCompassActive
                  ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-400/40 dark:border-emerald-500/20'
                  : 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-400/40 dark:border-amber-500/20'
              }`}>
                {isCompassActive ? 'SENSOR ACTIVE' : 'CALIBRATING SENSOR...'}
              </span>

              <button
                type="button"
                onClick={() => setAudioEnabled(!audioEnabled)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all ${
                  audioEnabled
                    ? 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-400 border-cyan-400/40'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-400 border-[#cbdbe9] dark:border-slate-800'
                }`}
                title={audioEnabled ? 'Audio ping active' : 'Turn on audio ping beacon'}
              >
                {audioEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                <span>Audio Ping</span>
              </button>
            </div>

            {activeTarget && (
              <span className="text-xs font-mono text-cyan-800 dark:text-cyan-400 font-bold ml-auto">
                Locked: {activeTarget.name.split('(')[0].trim()} ({targetDistance}m · {targetCardinal})
              </span>
            )}
          </div>
        )}
      </div>

      {/* TACTICAL TWO-COLUMN GRID: MAP (LEFT) & COMPASS/TELEMETRY (RIGHT) */}
      <div className="grid lg:grid-cols-12 gap-3 sm:gap-4 items-stretch">
        {/* LEFT COLUMN: Interactive Tactical Map */}
        <div className="lg:col-span-7 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs text-slate-900 dark:text-slate-100 flex flex-col justify-between">
          {/* Map Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div className="flex flex-wrap gap-1.5">
              {[
                ['all', 'All Points'],
                ['sos', 'SOS Casualties'],
                ['hazard', 'Hazards'],
                ['resource', 'Safe Resources']
              ].map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setMapFilter(f)}
                  className={`text-xs px-2.5 py-1 rounded-lg border font-bold transition-all cursor-pointer ${
                    mapFilter === f
                      ? 'bg-slate-900 text-white dark:bg-cyan-500 dark:text-slate-950 border-transparent shadow-xs'
                      : 'border-[#cbdbe9] dark:border-slate-800 bg-[#e6f0f7] dark:bg-slate-900 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-[#d9e8f4]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono font-medium">
              {filteredMapItems.length} locations
            </div>
          </div>

          {/* Map Canvas */}
          <div className="relative rounded-xl overflow-hidden border border-[#e8e4db] dark:border-slate-800 bg-[#091927] flex items-center justify-center">
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
                    category: item.kind === 'incident' ? 'casualty' : item.kind === 'hazard' ? 'hazard' : item.kind === 'resource' ? 'resource' : 'shelter',
                    location: item.location || { lat: item.lat, lon: item.lon },
                    text: item.text || item.summary || item.description || 'Selected map location'
                  };
                  setSelectedTargetId(newTarget.id);
                  playChirp(newTarget.category === 'casualty' ? 1200 : 800);
                  if (onNavigateTarget) onNavigateTarget(newTarget);
                }
              }}
            />

            {/* Compass Rose Mini Watermark overlay on map */}
            <div className="absolute top-2.5 right-2.5 bg-slate-900/85 backdrop-blur-md border border-slate-700/60 rounded-lg px-2 py-0.5 text-[11px] font-mono text-cyan-300 font-bold flex items-center gap-1 shadow-sm">
              <Compass size={12} className="text-cyan-400" />
              <span>N {String(Math.round(currentHeading)).padStart(3, '0')}°</span>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Compass Navigation & Target Situation Card */}
        <div className="lg:col-span-5 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs flex flex-col justify-between gap-3">
          {/* Live Alignment Action Banner */}
          <div className="w-full font-mono h-[34px] min-h-[34px] flex items-center justify-center">
            {isAligned ? (
              <div className="w-full h-full rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs animate-pulse px-3">
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                <span className="truncate">ON TARGET · PROCEED STRAIGHT</span>
              </div>
            ) : turnRightAngle > 0 ? (
              <div className="w-full h-full rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-900 dark:text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 px-3">
                <ArrowRight size={15} className="text-amber-600 shrink-0" />
                <span className="truncate tabular-nums">TURN RIGHT {Math.round(turnRightAngle)}° TO ALIGN</span>
              </div>
            ) : (
              <div className="w-full h-full rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-900 dark:text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 px-3">
                <ArrowLeft size={15} className="text-amber-600 shrink-0" />
                <span className="truncate tabular-nums">TURN LEFT {Math.round(turnLeftAngle)}° TO ALIGN</span>
              </div>
            )}
          </div>

          {/* Compass Dial & Telemetry Row */}
          <div className="flex items-center justify-between gap-3 py-0.5">
            {/* Compass SVG Dial */}
            <div className="flex flex-col items-center justify-center shrink-0">
              <div
                onClick={requestCompassPermission}
                className="relative w-[150px] h-[150px] flex items-center justify-center select-none cursor-pointer"
                title="Live 360° Compass Navigation"
              >
                <svg
                  width={150}
                  height={150}
                  viewBox={`0 0 ${COMPASS_SIZE} ${COMPASS_SIZE}`}
                  className="select-none drop-shadow-md"
                >
                  <defs>
                    <linearGradient id="compassRing" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#0284c7" />
                      <stop offset="100%" stopColor="#0f172a" />
                    </linearGradient>
                    <filter id="needleGlow" x="-30%" y="-30%" width="160%" height="160%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  <circle cx={COMPASS_CENTER} cy={COMPASS_CENTER} r={COMPASS_RADIUS + 16} fill="#091424" stroke="#334155" strokeWidth="2" />
                  <circle cx={COMPASS_CENTER} cy={COMPASS_CENTER} r={COMPASS_RADIUS + 11} fill="#030712" stroke="#0e7490" strokeWidth="1" strokeDasharray="3 3" />
                  <circle cx={COMPASS_CENTER} cy={COMPASS_CENTER} r={COMPASS_RADIUS} fill="#060e1a" stroke="#1e293b" strokeWidth="1.5" />

                  {Array.from({ length: 36 }).map((_, i) => {
                    const deg = i * 10;
                    const isMajor = deg % 30 === 0;
                    const isCardinal = deg % 90 === 0;
                    const tickLen = isCardinal ? 11 : isMajor ? 7 : 3.5;
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

                  <text x={COMPASS_CENTER} y={COMPASS_CENTER - COMPASS_RADIUS + 15} textAnchor="middle" fill="#ef4444" fontSize="13" fontWeight="900" fontFamily="monospace">N</text>
                  <text x={COMPASS_CENTER + COMPASS_RADIUS - 13} y={COMPASS_CENTER + 4} textAnchor="middle" fill="#38bdf8" fontSize="11" fontWeight="bold" fontFamily="monospace">E</text>
                  <text x={COMPASS_CENTER} y={COMPASS_CENTER + COMPASS_RADIUS - 6} textAnchor="middle" fill="#38bdf8" fontSize="11" fontWeight="bold" fontFamily="monospace">S</text>
                  <text x={COMPASS_CENTER - COMPASS_RADIUS + 13} y={COMPASS_CENTER + 4} textAnchor="middle" fill="#38bdf8" fontSize="11" fontWeight="bold" fontFamily="monospace">W</text>

                  <line x1={COMPASS_CENTER - 20} y1={COMPASS_CENTER} x2={COMPASS_CENTER + 20} y2={COMPASS_CENTER} stroke="#0e7490" strokeWidth="0.8" opacity="0.3" />
                  <line x1={COMPASS_CENTER} y1={COMPASS_CENTER - 20} x2={COMPASS_CENTER} y2={COMPASS_CENTER + 20} stroke="#0e7490" strokeWidth="0.8" opacity="0.3" />

                  {activeTarget && (
                    <g
                      transform={`rotate(${needleAngle} ${COMPASS_CENTER} ${COMPASS_CENTER})`}
                      filter="url(#needleGlow)"
                      className="transition-transform duration-200 ease-out"
                    >
                      <polygon
                        points={`${COMPASS_CENTER},${COMPASS_CENTER - COMPASS_RADIUS + 12} ${COMPASS_CENTER - 9},${COMPASS_CENTER - 14} ${COMPASS_CENTER},${COMPASS_CENTER - 7} ${COMPASS_CENTER + 9},${COMPASS_CENTER - 14}`}
                        fill={isAligned ? '#10b981' : activeTarget.category === 'resource' ? '#06b6d4' : '#ef4444'}
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                      <line
                        x1={COMPASS_CENTER}
                        y1={COMPASS_CENTER}
                        x2={COMPASS_CENTER}
                        y2={COMPASS_CENTER - COMPASS_RADIUS + 12}
                        stroke={isAligned ? '#10b981' : activeTarget.category === 'resource' ? '#06b6d4' : '#ef4444'}
                        strokeWidth="3.5"
                        strokeLinecap="round"
                      />
                      <polygon
                        points={`${COMPASS_CENTER},${COMPASS_CENTER + 24} ${COMPASS_CENTER - 5},${COMPASS_CENTER + 10} ${COMPASS_CENTER + 5},${COMPASS_CENTER + 10}`}
                        fill="#475569"
                      />
                      <circle
                        cx={COMPASS_CENTER}
                        cy={COMPASS_CENTER - COMPASS_RADIUS + 12}
                        r="5.5"
                        fill="none"
                        stroke={isAligned ? '#10b981' : activeTarget.category === 'resource' ? '#06b6d4' : '#ef4444'}
                        strokeWidth="2"
                        className={isAligned ? 'animate-pulse' : ''}
                      />
                    </g>
                  )}

                  <circle cx={COMPASS_CENTER} cy={COMPASS_CENTER} r="26" fill="#091424" stroke="#1e293b" strokeWidth="2" />
                  <circle cx={COMPASS_CENTER} cy={COMPASS_CENTER} r="22" fill="#030712" />

                  <text
                    x={COMPASS_CENTER}
                    y={COMPASS_CENTER - 2}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="11"
                    fontWeight="900"
                    fontFamily="monospace"
                  >
                    {activeTarget ? `${targetDistance}m` : '0m'}
                  </text>
                  <text
                    x={COMPASS_CENTER}
                    y={COMPASS_CENTER + 10}
                    textAnchor="middle"
                    fill={isAligned ? '#10b981' : '#38bdf8'}
                    fontSize="8.5"
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {targetCardinal}
                  </text>
                </svg>
              </div>

              <div className="mt-0.5 text-center font-mono text-[10px] text-slate-500 dark:text-slate-400">
                <span>Heading: </span>
                <strong className="text-cyan-600 dark:text-cyan-400">{Math.round(currentHeading)}° {cardinalDirection(currentHeading)}</strong>
              </div>
            </div>

            {/* Metrics Matrix */}
            <div className="flex-1 flex flex-col gap-1.5 min-w-0 font-mono">
              <div className="grid grid-cols-2 gap-1.5 text-center">
                <div className="bg-[#f8fafc] dark:bg-slate-950/80 p-2 rounded-xl border border-[#dbe6f0] dark:border-slate-800">
                  <span className="text-[9px] text-slate-500 uppercase block font-semibold">Distance</span>
                  <strong className="text-xs sm:text-sm font-black text-slate-900 dark:text-cyan-400">{targetDistance} m</strong>
                </div>
                <div className="bg-[#f8fafc] dark:bg-slate-950/80 p-2 rounded-xl border border-[#dbe6f0] dark:border-slate-800">
                  <span className="text-[9px] text-slate-500 uppercase block font-semibold">Azimuth</span>
                  <strong className="text-xs sm:text-sm font-black text-slate-900 dark:text-cyan-400">{targetBearing}° {targetCardinal}</strong>
                </div>
              </div>

              <div className="bg-[#f8fafc] dark:bg-slate-950/80 p-1.5 rounded-xl border border-[#dbe6f0] dark:border-slate-800 text-center">
                <span className="text-[9px] text-slate-500 uppercase block font-semibold">Est. Walk Time</span>
                <strong className="text-xs sm:text-sm font-black text-slate-900 dark:text-cyan-400">~{Math.max(1, Math.round(targetDistance / 75))} min</strong>
              </div>
            </div>
          </div>

          {/* Target Card Details */}
          {activeTarget ? (
            <div
              className={`p-2.5 sm:p-3 rounded-xl border transition-all shadow-xs ${
                activeTarget.category === 'casualty'
                  ? 'bg-red-50/90 dark:bg-red-950/30 border-red-300 dark:border-red-500/70'
                  : activeTarget.category === 'resource'
                  ? 'bg-sky-50/90 dark:bg-sky-950/30 border-sky-300 dark:border-sky-500/70'
                  : activeTarget.category === 'shelter'
                  ? 'bg-emerald-50/90 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-500/70'
                  : 'bg-[#f0f5fa] dark:bg-slate-900/60 border-[#dbe6f0] dark:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span
                  className={`text-[9.5px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                    activeTarget.category === 'casualty'
                      ? 'bg-red-600 text-white animate-pulse'
                      : activeTarget.category === 'resource'
                      ? 'bg-sky-600 text-white'
                      : activeTarget.category === 'shelter'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-600 text-white'
                  }`}
                >
                  {activeTarget.category === 'casualty'
                    ? '🆘 PRIORITY CASUALTY / SOS'
                    : activeTarget.category === 'resource'
                    ? '💧 SAFE RESOURCE'
                    : activeTarget.category === 'shelter'
                    ? '🏥 SAFE SHELTER'
                    : '⚠️ HAZARD ALERT'}
                </span>
                <span className="text-[11px] font-mono font-bold text-slate-600 dark:text-slate-400">
                  {targetBearing}° ({targetCardinal})
                </span>
              </div>

              <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white truncate">
                {activeTarget.name}
              </h3>

              <p className="text-[11px] sm:text-xs text-slate-800 dark:text-slate-200 leading-snug line-clamp-2 mt-1">
                {targetDescription}
              </p>

              {/* 1-Tap Action Buttons */}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (onNavigateTarget && activeTarget.location) {
                      onNavigateTarget(activeTarget);
                    }
                    playChirp(1000);
                  }}
                  className="flex-1 py-1.5 px-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-xs transition-all active:scale-98 cursor-pointer"
                >
                  <Navigation size={13} />
                  <span>Center Target</span>
                </button>

                <button
                  type="button"
                  onClick={() => playChirp(activeTarget.category === 'casualty' ? 1400 : 900)}
                  className="py-1.5 px-3 rounded-lg border border-[#cbdbe9] dark:border-slate-700 hover:border-cyan-500 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1 transition-all active:scale-98 cursor-pointer"
                >
                  <Volume2 size={13} className="text-cyan-600 dark:text-cyan-400" />
                  <span>Ping</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl border border-dashed border-[#cbdbe9] dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
              Select a target destination from the dropdown above to point the compass and view tactical telemetry.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
