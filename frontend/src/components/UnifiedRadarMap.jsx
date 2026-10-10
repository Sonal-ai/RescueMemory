import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Compass,
  MapPin,
  Navigation,
  RefreshCw,
} from 'lucide-react';
import { getSurvivalRadar, distM, bearingDeg, cardinalDirection } from '../api';
import MapPanel from '../MapPanel';
import { radarDestinationLabel, radarDestinationOption } from '../brain/radarLabels.js';
import { savedShelters, targetMeasurements } from '../brain/survivorReports.js';

const COMPASS_SIZE = 220;
const COMPASS_CENTER = COMPASS_SIZE / 2;
const COMPASS_RADIUS = 88;
const nativeCompass = registerPlugin('CompassHeading');

/**
 * Only absolute browser orientation may be used as a north reference.
 */
function extractCompassHeading(e) {
  // 1. iOS Safari CoreMotion: direct hardware-fused true heading (0-360 clockwise from North)
  if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
    return Number(e.webkitCompassHeading);
  }

  // 2. Android Chrome / W3C DeviceOrientationEvent:
  // e.alpha is the counter-clockwise rotation in degrees around the Z-axis (0 to 360).
  // Clockwise compass heading from North is (360 - e.alpha) % 360.
  if (e.absolute === true && e.alpha !== null && e.alpha !== undefined && !Number.isNaN(e.alpha)) {
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
  userLocation = null,
  gpsLive = false,
  items = [],
  peers = [],
  onSelectLocation = null,
  onNavigateTarget = null,
  onRefreshGps = null,
  selectedTarget = null
}) {
  const [radarData, setRadarData] = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState(() => {
    return selectedTarget?.id || selectedTarget?.entity_id || '';
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mapFilter, setMapFilter] = useState('all');

  // Device orientation / heading state (0 = North, 90 = East, 180 = South, 270 = West)
  const [deviceHeading, setDeviceHeading] = useState(null);
  const [isCompassActive, setIsCompassActive] = useState(false);
  const [compassReference, setCompassReference] = useState('');
  const [lastHapticTime, setLastHapticTime] = useState(0);

  // The survivor screen owns GPS on every tab; this view uses the same fix.
  const liveCoords = userLocation;
  const isLiveWalking = gpsLive;
  const [totalMetersWalked, setTotalMetersWalked] = useState(0);
  const previousFix = useRef(null);
  useEffect(() => {
    if (!gpsLive || !userLocation) return;
    const previous = previousFix.current;
    if (previous && userLocation.timestamp >= previous.timestamp) {
      const step = distM(previous.lat, previous.lon, userLocation.lat, userLocation.lon);
      if (step >= 0.4) setTotalMetersWalked(walked => Math.round(walked + step));
    }
    previousFix.current = userLocation;
  }, [userLocation, gpsLive]);

  // Request iOS 13+ sensor permissions on first user gesture
  const requestCompassPermission = useCallback(async () => {
    if (
      typeof window !== 'undefined' &&
      typeof window.DeviceOrientationEvent !== 'undefined' &&
      typeof window.DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        const state = await window.DeviceOrientationEvent.requestPermission();
        if (state !== 'granted') setIsCompassActive(false);
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
    let lastSensorAt = 0;
    let nativeListener = null;
    let disposed = false;
    const androidNative = Capacitor.getPlatform() === 'android';

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
          const diff = prev === null ? 360 : Math.abs(((rounded - prev + 540) % 360) - 180);
          if (diff >= 2) {
            return rounded;
          }
          return prev;
        });

        if (sensorEventCount >= 2 && Date.now() - lastSensorAt < 3000) setIsCompassActive(true);
        else if (lastSensorAt && Date.now() - lastSensorAt >= 3000) setIsCompassActive(false);
      }
      animFrameId = requestAnimationFrame(updateFilter);
    };

    const handleAbsoluteOrientation = (e) => {
      const h = extractCompassHeading(e);
      if (h !== null) {
        hasAbsolute = true;
        targetRawHeading = h;
        sensorEventCount++;
        lastSensorAt = Date.now();
        setCompassReference(e.webkitCompassHeading != null ? 'true' : 'magnetic');
      }
    };

    const handleStandardOrientation = (e) => {
      if (hasAbsolute) return;
      const h = extractCompassHeading(e);
      if (h !== null) {
        targetRawHeading = h;
        sensorEventCount++;
        lastSensorAt = Date.now();
        setCompassReference(e.webkitCompassHeading != null ? 'true' : 'magnetic');
      }
    };

    if (typeof window !== 'undefined') {
      if (androidNative) {
        nativeCompass.addListener('heading', ({ degrees, reference }) => {
          if (disposed || !Number.isFinite(degrees)) return;
          targetRawHeading = ((degrees % 360) + 360) % 360;
          sensorEventCount++;
          lastSensorAt = Date.now();
          setCompassReference(reference === 'true' ? 'true' : 'magnetic');
        }).then(listener => {
          if (disposed) listener.remove();
          else nativeListener = listener;
        }).then(() => disposed ? null : nativeCompass.start()).catch(() => {
          if (!disposed) setIsCompassActive(false);
        });
      } else {
        window.addEventListener('deviceorientationabsolute', handleAbsoluteOrientation, true);
        window.addEventListener('deviceorientation', handleStandardOrientation, true);
      }
      animFrameId = requestAnimationFrame(updateFilter);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceorientationabsolute', handleAbsoluteOrientation, true);
        window.removeEventListener('deviceorientation', handleStandardOrientation, true);
      }
      disposed = true;
      nativeListener?.remove();
      if (androidNative) nativeCompass.stop().catch(() => {});
      if (animFrameId) cancelAnimationFrame(animFrameId);
    };
  }, []);

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android' || !Number.isFinite(userLocation?.lat)
        || !Number.isFinite(userLocation?.lon)) return;
    nativeCompass.updateLocation({ lat: userLocation.lat, lon: userLocation.lon }).catch(() => {});
  }, [userLocation?.lat, userLocation?.lon]);

  // Fetch Radar Signals from Qdrant Edge Memory
  const locLat = liveCoords?.lat;
  const locLon = liveCoords?.lon;

  const fetchRadar = useCallback(async () => {
    if (!Number.isFinite(locLat) || !Number.isFinite(locLon)) { setRadarData(null); return; }
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
    window.addEventListener('rescue:reports-changed', fetchRadar);
    return () => { clearInterval(interval); window.removeEventListener('rescue:reports-changed', fetchRadar); };
  }, [fetchRadar]);

  const handleManualRefreshGps = useCallback(async () => {
    if (onRefreshGps) {
      await onRefreshGps();
    }
    fetchRadar();
  }, [onRefreshGps, fetchRadar]);

  const radarItems = useMemo(() => radarData?.radar_items || [], [radarData]);
  const shelters = useMemo(() => savedShelters(items), [items]);
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
    for (const shelter of shelters) {
      if (!list.some(item => item.id === shelter.id || (shelter.entity_id && (item.entity_id === shelter.entity_id || item.name === shelter.entity_id))))
        list.push(shelter);
    }
    const uLat = liveCoords?.lat ?? userLocation?.lat;
    const uLon = liveCoords?.lon ?? userLocation?.lon;

    // If external target passed (e.g. from SafePlace reroute or casualty), inject it at the top
    if (selectedTarget && Number.isFinite(uLat) && Number.isFinite(uLon)) {
      const targetId = selectedTarget.id || selectedTarget.entity_id || 'selected_target';
      const tLoc = selectedTarget.location || (selectedTarget.lat != null && selectedTarget.lon != null ? { lat: selectedTarget.lat, lon: selectedTarget.lon } : null);
      if (tLoc && Number.isFinite(tLoc.lat) && Number.isFinite(tLoc.lon) && !list.some((item) => item.id === targetId)) {
        const d = Math.round(distM(uLat, uLon, tLoc.lat, tLoc.lon));
        const b = bearingDeg(uLat, uLon, tLoc.lat, tLoc.lon);
        list.unshift({
          id: targetId,
          name: selectedTarget.name || selectedTarget.title || 'Selected Facility',
          category: selectedTarget.category || (['incident', 'sos'].includes(selectedTarget.kind) ? 'casualty' : selectedTarget.kind === 'hazard' ? 'hazard' : 'shelter'),
          distance_m: d,
          bearing_deg: b,
          cardinal: cardinalDirection(b),
          walk_time_min: null,
          location: tLoc,
          triage_level: selectedTarget.triage_level || 'informational',
          status: selectedTarget.status || null,
          text: selectedTarget.text || selectedTarget.description || selectedTarget.summary || (Array.isArray(selectedTarget.facilities) ? selectedTarget.facilities.join(', ') : 'Rerouted safe location')
        });
      }
    }

    return list;
  }, [radarItems, shelters, selectedTarget, liveCoords, userLocation]);

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
  const currentHeading = isCompassActive ? deviceHeading : null;

  // Real-time geodesic metrics between live walking GPS and activeTarget.location
  const liveTargetMetrics = useMemo(() => {
    const tLoc = activeTarget?.location || (activeTarget?.lat != null && activeTarget?.lon != null ? { lat: activeTarget.lat, lon: activeTarget.lon } : null);
    return targetMeasurements(liveCoords || userLocation, tLoc);
  }, [activeTarget, liveCoords, userLocation]);

  const targetBearing = liveTargetMetrics.bearing;
  const targetDistance = liveTargetMetrics.distance;
  const targetCardinal = liveTargetMetrics.cardinal;
  const hasTargetFix = Number.isFinite(targetDistance);
  const hasTargetDirection = Number.isFinite(targetBearing);

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
        ? 'Reported resource. Description unavailable.'
        : activeTarget.category === 'casualty'
        ? 'Reported SOS. Description unavailable.'
        : activeTarget.category === 'shelter'
        ? 'Reported shelter. Description unavailable.'
        : 'Emergency tactical location.')
    );
  }, [activeTarget]);

  // Relative Bearing: Difference between device heading and target bearing
  const relativeAngle = currentHeading === null || !hasTargetDirection ? null : ((targetBearing - currentHeading + 360) % 360);

  // Maintain continuous smooth needle rotation (prevents 360° flip spins)
  const [needleAngle, setNeedleAngle] = useState(0);
  useEffect(() => {
    if (relativeAngle === null) return;
    setNeedleAngle((prev) => {
      let delta = (relativeAngle - (prev % 360) + 540) % 360 - 180;
      return prev + delta;
    });
  }, [relativeAngle]);

  // Alignment Calculation with Hysteresis (prevents edge flickering between aligned and turning)
  const [isAligned, setIsAligned] = useState(false);
  const angularError = relativeAngle === null ? null : Math.abs(((relativeAngle + 180) % 360) - 180);

  useEffect(() => {
    if (currentHeading === null || !hasTargetDirection) {
      setIsAligned(false);
    } else if (!isAligned && angularError <= 12) {
      setIsAligned(true);
    } else if (isAligned && angularError >= 18) {
      setIsAligned(false);
    }
  }, [angularError, isAligned, currentHeading, hasTargetDirection]);

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
      if (onNavigateTarget && chosen.location) {
        onNavigateTarget(chosen);
      }
    }
  };

  // Filtered items for MapPanel
  const filteredMapItems = useMemo(() => {
    const list = [...(Array.isArray(items) ? items : [])];
    for (const d of destinationOptions) {
      if (!list.some((it) => it.id === d.id || it.entity_id === d.id)) {
        list.push({
          id: d.id,
          entity_id: d.id,
          title: d.name,
          kind: d.category === 'casualty' ? 'incident' : d.category === 'hazard' ? 'hazard' : d.category === 'resource' ? 'resource' : 'checkpoint',
          severity: d.severity || null,
          status: d.status || null,
          location: d.location,
          text: d.text
        });
      }
    }
    if (mapFilter === 'all') return list;
    if (mapFilter === 'sos') return list.filter((i) => i.kind === 'incident' || i.severity === 'red');
    if (mapFilter === 'hazard') return list.filter((i) => i.kind === 'hazard');
    if (mapFilter === 'resource') return list.filter((i) => i.kind === 'resource' || i.kind === 'checkpoint');
    return list;
  }, [items, destinationOptions, mapFilter]);

  return (
    <div className="radar-view flex min-w-0 flex-col gap-3 text-slate-900 dark:text-slate-100">
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
            </h2>
          </div>

          {/* Compact refresh control; shared header carries GPS and mesh status. */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleManualRefreshGps}
              disabled={loading}
              className="p-1 rounded-lg border border-[#cbdbe9] dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-[#edf5fb] dark:hover:bg-slate-800 transition-colors"
              title="Refresh local radar"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        {error && <p role="alert" className="mb-2 break-words text-xs text-amber-700 dark:text-amber-300">Radar update unavailable: {error}</p>}

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
            {!destinationOptions.length && <option value="">No reported destinations</option>}
            {destinationOptions.map((dest) => {
              const isCas = dest.category === 'casualty';
              const isResource = dest.category === 'resource';
              const isShelter = dest.category === 'shelter';
              const icon = isCas ? '🆘' : isResource ? '💧' : isShelter ? '🏥' : '📍';
              return (
                <option key={dest.id} value={dest.id}>
                  {icon} {radarDestinationOption(dest)}
                </option>
              );
            })}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400">
            <ChevronDown size={15} />
          </div>
        </div>

        {/* Quick Facility Target Chips */}
        <div className="radar-facility-chips flex items-center gap-1.5 overflow-x-auto pb-0.5 mt-2.5 no-scrollbar">
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
                <span className="truncate max-w-[140px]">{radarDestinationLabel(dest)}</span>
              </button>
            );
          })}
        </div>

      </div>

      {shelters.length > 0 && <section className="rounded-2xl border border-emerald-200 bg-white p-3 dark:border-emerald-900 dark:bg-[#0b1626]" aria-label="Saved shelters">
        <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Saved shelters ({shelters.length})</h3>
        <div className="mt-2 space-y-2">
          {shelters.map(shelter => <button type="button" key={shelter.id} onClick={() => handleSelectDestination(shelter.id)} className="block w-full rounded-xl border border-slate-200 p-2 text-left dark:border-slate-700">
            <p className="text-sm font-semibold">{shelter.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{shelter.location ? `${shelter.location.lat.toFixed(5)}, ${shelter.location.lon.toFixed(5)}` : 'Shelter coordinates unavailable'} · {shelter.prototype_confirmed ? 'Saved locally · publication pending' : shelter.imported ? 'Received report' : 'Saved report'}</p>
            <p className="mt-1 break-words text-xs">{shelter.text}</p>
          </button>)}
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{userLocation ? 'Select a shelter for direction and distance. The map shows your current area.' : 'GPS unavailable · shelters remain saved. Enable location for map positions, distance and direction.'}</p>
      </section>}

      {/* TACTICAL TWO-COLUMN GRID: MAP (LEFT) & COMPASS/TELEMETRY (RIGHT) */}
      <div className="grid lg:grid-cols-12 gap-3 sm:gap-4 items-stretch">
        {/* LEFT COLUMN: Interactive Tactical Map */}
        <div className="radar-map-card min-w-0 lg:col-span-7 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs text-slate-900 dark:text-slate-100 flex flex-col justify-between">
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
          <div className="radar-map-canvas relative min-w-0 w-full rounded-xl overflow-hidden border border-[#e8e4db] dark:border-slate-800 bg-[#091927]">
            {userLocation ? <MapPanel
              center={liveCoords || userLocation}
              items={filteredMapItems}
              peers={peers}
              selected={activeTarget?.location || (liveCoords || userLocation)}
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
                  if (onNavigateTarget) onNavigateTarget(newTarget);
                }
              }}
            /> : <div className="radar-map-placeholder flex min-h-48 flex-col items-center justify-center gap-2 bg-[linear-gradient(90deg,transparent_95%,#174057_96%),linear-gradient(transparent_95%,#174057_96%)] bg-[length:32px_32px] p-4 text-center text-cyan-200"><MapPin size={24} /><p className="text-sm font-semibold">Locating with GPS…</p><p className="text-xs">Compass and nearby phones remain available.</p><button type="button" onClick={handleManualRefreshGps} className="rounded-lg border border-cyan-500 px-3 py-1 text-xs font-bold">Retry GPS</button></div>}

            {/* Compass Rose Mini Watermark overlay on map */}
            <div className="absolute top-2.5 right-2.5 bg-slate-900/85 backdrop-blur-md border border-slate-700/60 rounded-lg px-2 py-0.5 text-[11px] font-mono text-cyan-300 font-bold flex items-center gap-1 shadow-sm">
              <Compass size={12} className="text-cyan-400" />
              <span>{currentHeading === null ? 'N —' : `N ${String(Math.round(currentHeading)).padStart(3, '0')}°`}</span>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Compass Navigation & Target Situation Card */}
        <div className="min-w-0 lg:col-span-5 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs flex flex-col justify-between gap-3">
          {/* Live Alignment Action Banner */}
          <div className="w-full font-mono h-[34px] min-h-[34px] flex items-center justify-center">
            {!userLocation ? (
              <div className="w-full h-full rounded-xl bg-cyan-500/10 border border-cyan-500/40 text-cyan-900 dark:text-cyan-300 font-bold text-xs flex items-center justify-center px-3">Waiting for GPS · heading still available</div>
            ) : !activeTarget ? (
              <div className="w-full h-full rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-900 dark:text-amber-300 font-bold text-xs flex items-center justify-center px-3">
                Select a destination to start guidance
              </div>
            ) : !hasTargetDirection ? (
              <div className="w-full h-full rounded-xl bg-cyan-500/10 border border-cyan-500/40 text-cyan-900 dark:text-cyan-300 font-bold text-xs flex items-center justify-center px-3">{hasTargetFix ? 'At reported coordinates · direction unavailable' : 'Destination coordinates unavailable'}</div>
            ) : currentHeading === null ? (
              <div className="w-full h-full rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-900 dark:text-amber-300 font-bold text-xs flex items-center justify-center px-3">
                Compass unavailable · move phone in a figure eight
              </div>
            ) : isAligned ? (
              <div className="w-full h-full rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs animate-pulse px-3">
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                <span className="truncate">ON TARGET · PROCEED STRAIGHT</span>
              </div>
            ) : turnRightAngle > 0 ? (
              <div className="w-full h-full rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-900 dark:text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 px-3">
                <ArrowRight size={15} className="text-amber-600 shrink-0" />
                <span className="truncate tabular-nums">Turn right {Math.round(turnRightAngle)}°</span>
              </div>
            ) : (
              <div className="w-full h-full rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-900 dark:text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 px-3">
                <ArrowLeft size={15} className="text-amber-600 shrink-0" />
                <span className="truncate tabular-nums">Turn left {Math.round(turnLeftAngle)}°</span>
              </div>
            )}
          </div>

          {/* Compass Dial & Telemetry Row */}
          <div className="survivor-compass-row flex items-center justify-between gap-3 py-0.5">
            {/* Compass SVG Dial */}
            <div className="survivor-compass-dial flex flex-col items-center justify-center shrink-0">
              <div
                onClick={requestCompassPermission}
                className="relative w-[200px] h-[200px] max-w-[68vw] max-h-[68vw] flex items-center justify-center select-none cursor-pointer"
                title="Live 360° Compass Navigation"
              >
                <svg
                  width="100%"
                  height="100%"
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

                  <g transform={`rotate(${-Number(currentHeading || 0)} ${COMPASS_CENTER} ${COMPASS_CENTER})`} className="transition-transform duration-200 ease-out">
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
                  </g>

                  <line x1={COMPASS_CENTER - 20} y1={COMPASS_CENTER} x2={COMPASS_CENTER + 20} y2={COMPASS_CENTER} stroke="#0e7490" strokeWidth="0.8" opacity="0.3" />
                  <line x1={COMPASS_CENTER} y1={COMPASS_CENTER - 20} x2={COMPASS_CENTER} y2={COMPASS_CENTER + 20} stroke="#0e7490" strokeWidth="0.8" opacity="0.3" />

                  {hasTargetDirection && currentHeading !== null && (
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
                    {hasTargetFix ? `${targetDistance}m` : '—'}
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
                    {hasTargetDirection ? targetCardinal : '—'}
                  </text>
                </svg>
              </div>

              <div className="mt-0.5 text-center font-mono text-[10px] text-slate-500 dark:text-slate-400">
                <span>Heading: </span>
                <strong className="text-cyan-600 dark:text-cyan-400">{currentHeading === null ? 'Calibrating…' : `${Math.round(currentHeading)}° ${cardinalDirection(currentHeading)} · ${compassReference === 'true' ? 'true north' : 'magnetic north'}`}</strong>
              </div>
            </div>

            {/* Metrics Matrix */}
            <div className="flex-1 flex flex-col gap-1.5 min-w-0 font-mono">
              <div className="grid grid-cols-2 gap-1.5 text-center">
                <div className="bg-[#f8fafc] dark:bg-slate-950/80 p-2 rounded-xl border border-[#dbe6f0] dark:border-slate-800">
                  <div className="flex items-center justify-between px-0.5 mb-0.5">
                    <span className="text-[9px] text-slate-500 uppercase block font-semibold">Distance</span>
                    {isLiveWalking && (
                      <span className="text-[8px] font-mono font-black px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 animate-pulse">
                        LIVE
                      </span>
                    )}
                  </div>
                  <strong className="text-xs sm:text-sm font-black text-slate-900 dark:text-cyan-400 tabular-nums">{hasTargetFix ? `${targetDistance} m` : '—'}</strong>
                </div>
                <div className="bg-[#f8fafc] dark:bg-slate-950/80 p-2 rounded-xl border border-[#dbe6f0] dark:border-slate-800">
                  <span className="text-[9px] text-slate-500 uppercase block font-semibold mb-0.5">Azimuth</span>
                  <strong className="text-xs sm:text-sm font-black text-slate-900 dark:text-cyan-400 tabular-nums">{hasTargetDirection ? `${targetBearing}° ${targetCardinal}` : '—'}</strong>
                </div>
              </div>

              <div className="bg-[#f8fafc] dark:bg-slate-950/80 p-1.5 rounded-xl border border-[#dbe6f0] dark:border-slate-800 text-center flex items-center justify-around">
                <div>
                  <span className="text-[9px] text-slate-500 uppercase block font-semibold">Reported status</span>
                  <strong className="text-xs sm:text-sm font-black text-slate-900 dark:text-cyan-400 tabular-nums">{activeTarget?.status || 'Not reported'}</strong>
                </div>
                {totalMetersWalked > 0 && (
                  <div className="border-l border-[#dbe6f0] dark:border-slate-800 pl-3">
                    <span className="text-[9px] text-emerald-600 dark:text-emerald-400 uppercase block font-semibold">Walked</span>
                    <strong className="text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-400 tabular-nums">{totalMetersWalked} m</strong>
                  </div>
                )}
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
                    : activeTarget.category === 'hazard' ? 'HAZARD ALERT' : 'NEARBY PHONE'}
                </span>
                <span className="text-[11px] font-mono font-bold text-slate-600 dark:text-slate-400">
                  {hasTargetDirection ? `${targetBearing}° (${targetCardinal})` : 'Direction unavailable'}
                </span>
              </div>

              <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white truncate">
                {radarDestinationLabel(activeTarget)}
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
                  }}
                  className="flex-1 py-1.5 px-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-xs transition-all active:scale-98 cursor-pointer"
                >
                  <Navigation size={13} />
                  <span>Center Target</span>
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
