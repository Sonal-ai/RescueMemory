import { useEffect, useState } from 'react';
import { CheckSquare, Square, Droplet, AlertCircle, Route, ShieldCheck, HeartPulse, RefreshCw, Crosshair } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, recommendAlternativeLocal, getNativeOrWebLocation, distM } from '../api';
import { Shell } from '../components';
import MapPanel from '../MapPanel';

const DEFAULT_CENTER = { lat: 28.7041, lon: 77.1025 };

export default function SafePlace() {
  const navigate = useNavigate();
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [needs, setNeeds] = useState({
    water: true,
    medical: true,
    shelter: true,
    food: false,
  });
  const [avoid, setAvoid] = useState({
    flooded: true,
    electrical: true,
  });
  const [radiusKm, setRadiusKm] = useState(2.0);
  const [shelters, setShelters] = useState([]);
  const [excluded, setExcluded] = useState(null);
  const [mapItems, setMapItems] = useState([]);
  const [loading, setLoading] = useState(false);

  // Auto-acquire live GPS position on mount
  useEffect(() => {
    getNativeOrWebLocation().then((pos) => {
      if (pos?.lat && pos?.lon) {
        setCenter({ lat: Number(pos.lat.toFixed(5)), lon: Number(pos.lon.toFixed(5)) });
      }
    }).catch(() => {});
  }, []);

  // Load dynamic data from Qdrant Edge Memory & Negative Vector Engine
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setLoading(true);
      try {
        // 1. Get negative vector safe facility recommendation
        const hazardText = [
          avoid.flooded ? 'flooded entrance' : '',
          avoid.electrical ? 'live electrical wires' : ''
        ].filter(Boolean).join(' ') || 'flooded hazard';

        const recResult = await recommendAlternativeLocal('cp_17', hazardText);

        // 2. Query nearby map records
        const mapData = await api('/api/map/nearby', {
          method: 'POST',
          body: {
            location: center,
            radius_m: radiusKm * 1000,
            include_responders: false,
          },
        }).catch(() => ({ items: [] }));

        if (!isMounted) return;

        setMapItems(mapData.items || []);

        if (recResult?.compromised) {
          setExcluded(recResult.compromised);
        }

        // Dynamically anchor facilities relative to current center
        const baseLat = center.lat;
        const baseLon = center.lon;

        let rawFacilities = [
          {
            id: 'shelter_alpha',
            name: 'Shelter Alpha (Central High)',
            type: 'Community Hall',
            dist_m: 510,
            walk_min: 7,
            status: 'Operational',
            facilities: ['Water', 'Food', 'Shelter', '300 Beds'],
            lat: Number((baseLat + 0.0035).toFixed(5)),
            lon: Number((baseLon - 0.0028).toFixed(5)),
          },
          {
            id: 'clinic_beta',
            name: 'Clinic Beta (West District)',
            type: 'Primary Clinic',
            dist_m: 530,
            walk_min: 7,
            status: 'Operational',
            facilities: ['Medical', 'Water', 'Resuscitation'],
            lat: Number((baseLat + 0.0021).toFixed(5)),
            lon: Number((baseLon - 0.0042).toFixed(5)),
          },
          {
            id: 'water_tanker_4',
            name: 'Water Tanker 4 (North Gate)',
            type: 'Municipal Tanker',
            dist_m: 560,
            walk_min: 8,
            status: 'Operational',
            facilities: ['Water', 'Clean Supply'],
            lat: Number((baseLat - 0.0025).toFixed(5)),
            lon: Number((baseLon + 0.0036).toFixed(5)),
          },
        ];

        // If negative-vector engine recommended a specific alternative facility:
        if (recResult?.recommended) {
          const rec = recResult.recommended;
          const exists = rawFacilities.some((f) => f.id === rec.id || f.id === rec.entity_id);
          if (!exists) {
            rawFacilities.unshift({
              id: rec.id || rec.entity_id || 'rec_safe',
              name: rec.name || rec.title || 'Safe Alternative Shelter',
              type: 'Rerouted Safe Shelter',
              dist_m: 620,
              walk_min: 9,
              status: 'Operational',
              facilities: rec.facilities || ['Shelter', 'Water', 'Medical'],
              lat: Number((baseLat + 0.0045).toFixed(5)),
              lon: Number((baseLon + 0.0022).toFixed(5)),
            });
          }
        }

        // Merge dynamic checkpoints or resource stations from Edge Memory
        (mapData.items || []).forEach((item) => {
          const kind = item.kind || '';
          const status = (item.status || '').toLowerCase();
          const isSafe = !['blocked', 'danger', 'flooded', 'closed', 'compromised'].includes(status);
          if (['checkpoint', 'resource', 'shelter'].includes(kind) && isSafe) {
            const exists = rawFacilities.some((f) => f.id === item.id || f.id === item.entity_id);
            if (!exists) {
              const itemCoords = { lat: item.lat || baseLat, lon: item.lon || baseLon };
              const dist = Math.round(distM(center, itemCoords)) || 650;
              rawFacilities.push({
                id: item.id || item.entity_id,
                name: item.summary || item.details?.name || `Checkpoint ${String(item.id).slice(0, 6)}`,
                type: kind === 'checkpoint' ? 'Relief Checkpoint' : 'Supply Point',
                dist_m: dist,
                walk_min: Math.max(1, Math.round(dist / 75)),
                status: item.status ? (item.status.charAt(0).toUpperCase() + item.status.slice(1)) : 'Operational',
                facilities: item.details?.facilities || ['Shelter', 'Water'],
                lat: itemCoords.lat,
                lon: itemCoords.lon,
              });
            }
          }
        });

        // Filter based on selected needs
        const activeNeedNames = Object.entries(needs)
          .filter(([, v]) => v)
          .map(([k]) => k.toLowerCase());

        const filtered = rawFacilities.filter((f) => {
          if (!activeNeedNames.length) return true;
          const facLower = f.facilities.map((x) => x.toLowerCase());
          return activeNeedNames.some((n) => facLower.some((fl) => fl.includes(n)));
        });

        setShelters(filtered.length ? filtered : rawFacilities);
      } catch (err) {
        console.error('Failed to load safe places:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [center, needs, avoid, radiusKm]);

  const toggleNeed = (key) => setNeeds((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleAvoid = (key) => setAvoid((prev) => ({ ...prev, [key]: !prev[key] }));

  const acquireGps = async () => {
    try {
      const pos = await getNativeOrWebLocation();
      setCenter({ lat: Number(pos.lat.toFixed(5)), lon: Number(pos.lon.toFixed(5)) });
    } catch (err) {
      console.warn('GPS unavailable:', err);
    }
  };

  const handleNavigate = (shelter) => {
    navigate('/compass', { state: { target: shelter } });
  };

  return (
    <Shell
      title="Safe Evacuation & Negative Routing"
      subtitle="Qdrant Edge Vector Rerouting & Autonomous Shelter Navigation"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* LEFT COLUMN: Interactive Filters */}
        <div className="lg:col-span-3 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 flex flex-col shadow-xs">
          <div className="flex items-center justify-between mb-3 border-b border-[#eef2f6] dark:border-slate-800 pb-2">
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <span className="w-1 h-3 rounded-full bg-cyan-600 inline-block"></span>
              <span>Filter Criteria</span>
            </h3>
            {loading && <RefreshCw className="w-3.5 h-3.5 text-cyan-500 animate-spin" />}
          </div>

          <div className="mb-3">
            <div className="flex items-baseline justify-between mb-2">
              <h4 className="text-[10px] text-slate-500 dark:text-slate-400 font-bold tracking-widest uppercase font-mono">
                YOUR NEEDS
              </h4>
              <span className="text-[9.5px] text-emerald-600 dark:text-emerald-400 font-medium">Matches supplies</span>
            </div>
            <div className="space-y-1.5">
              {[
                ['water', 'Water & Purification', Droplet],
                ['medical', 'Medical & First Aid', HeartPulse],
                ['shelter', 'Shelter & Beds', ShieldCheck],
                ['food', 'Food & Ration Packs', Square],
              ].map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => toggleNeed(key)}
                  className={`w-full flex items-center gap-2 p-2 rounded-xl border text-left text-xs transition-all ${
                    needs[key]
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-500 text-emerald-900 dark:text-emerald-200 font-bold shadow-xs'
                      : 'bg-[#f7fafc] dark:bg-[#07111e] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  {needs[key] ? (
                    <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3">
            <div className="flex items-baseline justify-between mb-2">
              <h4 className="text-[10px] text-slate-500 dark:text-slate-400 font-bold tracking-widest uppercase font-mono">
                AVOID HAZARDS
              </h4>
              <span className="text-[9.5px] text-rose-500 font-mono">Negative Vectors</span>
            </div>
            <div className="space-y-1.5">
              {[
                ['flooded', 'Flooded areas & deep water'],
                ['electrical', 'Downed electrical wires'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => toggleAvoid(key)}
                  className={`w-full flex items-center gap-2 p-2 rounded-xl border text-left text-xs transition-all ${
                    avoid[key]
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-400 dark:border-rose-500 text-rose-900 dark:text-rose-200 font-bold shadow-xs'
                      : 'bg-[#f7fafc] dark:bg-[#07111e] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  {avoid[key] ? (
                    <CheckSquare className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-auto pt-3 border-t border-[#eef2f6] dark:border-slate-800">
            <div className="flex justify-between items-center mb-1">
              <h4 className="text-[10px] text-slate-500 dark:text-slate-400 font-bold tracking-widest uppercase font-mono">
                WALKING RADIUS
              </h4>
              <button onClick={acquireGps} className="text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline font-mono font-bold flex items-center gap-1">
                <Crosshair size={12} /> Sync GPS
              </button>
            </div>
            <div className="flex justify-between items-end mb-1">
              <span className="text-base sm:text-lg font-bold font-mono text-cyan-700 dark:text-cyan-300">
                {radiusKm} <span className="text-xs text-slate-500">km</span>
              </span>
              <span className="text-slate-500 dark:text-slate-400 text-[10px] font-mono">~{Math.round(radiusKm * 14)} min walk</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="5.0"
              step="0.5"
              value={radiusKm}
              onChange={(e) => setRadiusKm(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-600 dark:accent-cyan-400"
            />
          </div>
        </div>

        {/* MIDDLE COLUMN: Dynamic Shelter Cards */}
        <div className="lg:col-span-4 flex flex-col gap-2.5 sm:gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] text-slate-500 dark:text-slate-400 font-bold tracking-widest uppercase font-mono">
              SUGGESTED SAFE SHELTERS ({shelters.length})
            </h4>
            <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">● Operational</span>
          </div>

          {shelters.map((shelter, idx) => (
            <div
              key={shelter.id}
              className={`border rounded-2xl p-3 sm:p-3.5 transition-all shadow-xs ${
                idx === 0
                  ? 'border-cyan-400 dark:border-cyan-500 bg-white dark:bg-gradient-to-br dark:from-[#0b1626] dark:to-[#071325]'
                  : 'border-[#dbe6f0] dark:border-slate-800 bg-white dark:bg-[#0b1626] hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">{shelter.name}</h3>
                <span className="bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700/60 px-2 py-0.5 rounded-full text-[10px] font-bold">
                  {shelter.status}
                </span>
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-[11px] mb-2 font-mono">
                {shelter.type} · {shelter.dist_m} m away · ~{shelter.walk_min} min walk
              </p>
              <div className="flex gap-1 mb-2.5 flex-wrap">
                {shelter.facilities.map((fac) => (
                  <span
                    key={fac}
                    className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-md text-[10px] font-medium"
                  >
                    {fac}
                  </span>
                ))}
              </div>
              <button
                onClick={() => handleNavigate(shelter)}
                className="w-full bg-cyan-600 hover:bg-cyan-500 active:scale-98 text-white font-bold text-xs py-2 rounded-xl flex items-center justify-center gap-1.5 transition shadow-sm cursor-pointer"
              >
                <Route className="w-3.5 h-3.5" /> Navigate on Compass HUD
              </button>
            </div>
          ))}

          {/* Exclusion Warning (Negative Vector output) */}
          {excluded && (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-2xl p-2.5 flex items-center gap-2 text-rose-900 dark:text-rose-300 text-xs shadow-xs">
              <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 shrink-0" />
              <span className="leading-snug">
                <strong>{excluded.name || excluded.entity_id || 'CP-17'} Excluded:</strong> {excluded.hazard || 'Flooded entrance, live electrical wires detected.'} Rerouted automatically.
              </span>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Tactical Map View */}
        <div className="lg:col-span-5 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl overflow-hidden min-h-[260px] sm:min-h-[380px] flex flex-col shadow-xs">
          <div className="p-2.5 border-b border-[#dbe6f0] dark:border-slate-800 bg-[#f7fafc] dark:bg-[#07111e] flex justify-between items-center">
            <span className="text-[11px] font-bold font-mono text-cyan-700 dark:text-cyan-300 uppercase tracking-wider">
              TACTICAL FIELD MAP
            </span>
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
              Center: {center.lat.toFixed(4)}, {center.lon.toFixed(4)}
            </span>
          </div>
          <div className="flex-1 p-2">
            <MapPanel center={center} items={mapItems} onMarker={(item) => handleNavigate(item)} />
          </div>
        </div>
      </div>
    </Shell>
  );
}