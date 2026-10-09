import { useCallback, useEffect, useRef, useState } from 'react';
import { getNativeOrWebLocation, watchNativeOrWebLocation, updateDeviceLocation } from '../api.js';
import { publishMeshLocation } from '../brain/bleMesh.js';
import { createLocationTracker } from '../brain/locationTracking.js';

export default function useLiveGps() {
  const [state, setState] = useState({ fix: null, status: 'locating', error: null });
  const tracker = useRef(null), lastPresence = useRef(0);
  useEffect(() => {
    const owner = createLocationTracker({ watch: watchNativeOrWebLocation,
      getCurrent: () => getNativeOrWebLocation({ allowCached: false, allowFallback: false }),
      onChange: setState, onFix: async fix => {
        await publishMeshLocation(fix);
        if (Date.now() - lastPresence.current >= 10000) {
          lastPresence.current = Date.now();
          await updateDeviceLocation({ ...fix, status: 'survivor_active' });
        }
      } });
    tracker.current = owner;
    owner.start();
    const resume = () => { if (!document.hidden) owner.start(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    return () => { tracker.current = null; owner.stop(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('pageshow', resume); };
  }, []);
  const refresh = useCallback(() => tracker.current?.refresh(), []);
  return { ...state, refresh };
}
