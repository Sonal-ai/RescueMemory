export const GPS_FRESH_MS = 30000;
export const GPS_WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 30000,
  interval: 5000, minimumUpdateInterval: 1000, enableLocationFallback: true };

export function gpsPosition(position, source, now = Date.now()) {
  const lat = position?.coords?.latitude, lon = position?.coords?.longitude, timestamp = position?.timestamp;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    throw new Error('[gps.fix/INVALID_COORDINATES] GPS returned invalid coordinates.');
  if (!Number.isFinite(timestamp) || timestamp <= 0 || now - timestamp > GPS_FRESH_MS || timestamp > now + 5000)
    throw new Error('[gps.fix/STALE_FIX] GPS returned an old or invalid measurement. Waiting for a fresh fix.');
  const measured = name => Number.isFinite(position.coords[name]) ? position.coords[name] : null;
  return { lat, lon, timestamp, source, accuracy: measured('accuracy'), speed: measured('speed'), heading: measured('heading') };
}

export const formatCoordinates = (fix, digits = 5) => Number.isFinite(fix?.lat) && Number.isFinite(fix?.lon)
  ? `${fix.lat.toFixed(digits)}, ${fix.lon.toFixed(digits)}` : 'Location unavailable';

export function gpsStatusText(state, now = Date.now()) {
  const point = state.fix ? ` (${formatCoordinates(state.fix)})` : '';
  const accuracy = state.fix?.accuracy != null ? ` · accuracy ±${Math.round(state.fix.accuracy)} m` : '';
  if (state.status === 'live') return `Live GPS${point}${accuracy} · updating automatically`;
  if (state.status === 'locating') return state.fix ? `Last GPS fix${point} · refreshing location…` : 'Locating with GPS…';
  if (state.status === 'stale') return `Last GPS fix${point} · ${Math.max(0, Math.round((now - state.fix.timestamp) / 1000))}s old · waiting for a fresh fix`;
  return `${state.fix ? `Last GPS fix${point}. ` : ''}${state.error || 'GPS unavailable. Enable location services and allow location permission.'}`;
}

export async function hardwareLocationWatch(onUpdate, onError, { nativeAvailable, loadNative, geolocation, now = Date.now }) {
  const report = error => onError?.(new Error(`[gps.watch/${error?.code ?? 'UNAVAILABLE'}] ${error?.message || String(error)}`));
  const receive = source => (position, error) => {
    if (error) { report(error); return; }
    try { onUpdate(gpsPosition(position, source, now())); } catch (invalid) { onError?.(invalid); }
  };
  let nativeFailure;
  if (nativeAvailable()) {
    try {
      const { Geolocation } = await loadNative();
      const permission = await Geolocation.checkPermissions();
      if (permission.location !== 'granted') await Geolocation.requestPermissions();
      const id = await Geolocation.watchPosition(GPS_WATCH_OPTIONS, receive('native_gps'));
      return () => Geolocation.clearWatch({ id });
    } catch (error) { nativeFailure = error; }
  }
  if (geolocation?.watchPosition) {
    const id = geolocation.watchPosition(receive('web_gps'), report, GPS_WATCH_OPTIONS);
    return () => geolocation.clearWatch(id);
  }
  report(nativeFailure || new Error('Location services are unavailable. Allow GPS/location access on this device.'));
  return () => {};
}

// One screen owner follows fixes on all its tabs. Generations prevent a late
// callback or delayed watch setup from reviving a stopped screen/watch.
export function createLocationTracker({ watch, getCurrent, onChange, onFix = () => {}, now = Date.now,
  schedule = setInterval, cancel = clearInterval }) {
  let state = { fix: null, status: 'locating', error: null }, generation = 0, cleanup, timer, stopped = false;
  const emit = patch => { state = { ...state, ...patch }; onChange(state); };
  const release = stop => Promise.resolve().then(() => stop?.()).catch(error => console.warn('[GPS cleanup]', error.message));
  const accept = (fix, token) => {
    if (stopped || token !== generation || fix?.isFallback || fix?.isCached || !Number.isFinite(fix?.timestamp) || fix.timestamp <= 0) return;
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || Math.abs(fix.lat) > 90 || Math.abs(fix.lon) > 180) return;
    if (now() - fix.timestamp > GPS_FRESH_MS || fix.timestamp > now() + 5000) { emit({ status: state.fix ? 'stale' : 'error', error: 'GPS returned an old measurement. Waiting for a fresh fix.' }); return; }
    if (state.fix && fix.timestamp < state.fix.timestamp) return;
    emit({ fix, status: 'live', error: null });
    Promise.resolve().then(() => onFix(fix)).catch(error => console.warn('[GPS publication]', error.message));
  };
  const fail = (error, token) => { if (!stopped && token === generation) emit({ status: 'error', error: error?.message || String(error) }); };
  async function start() {
    stopped = false; const token = ++generation;
    await release(cleanup); cleanup = undefined;
    if (stopped || token !== generation) return;
    emit({ status: 'locating', error: null });
    if (!timer) timer = schedule(() => {
      if (!stopped && state.fix && now() - state.fix.timestamp > GPS_FRESH_MS) {
        if (state.status === 'live' || state.status === 'stale') emit({ status: 'stale' });
        else emit({}); // Keep the displayed age advancing without hiding an error.
      }
    }, 5000);
    try {
      const stop = await watch(fix => accept(fix, token), error => fail(error, token));
      if (stopped || token !== generation) await release(stop); else cleanup = stop;
    } catch (error) { fail(error, token); }
  }
  async function refresh() {
    await start(); const token = generation;
    if (stopped) return;
    try { accept(await getCurrent(), token); } catch (error) { if (state.status !== 'live') fail(error, token); }
  }
  function stop() { stopped = true; generation++; cancel(timer); timer = undefined; const last = cleanup; cleanup = undefined; return release(last); }
  return { start, refresh, stop, getState: () => state };
}
