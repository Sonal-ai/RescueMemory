import { useEffect, useState } from 'react';
import { CheckSquare, Square, Droplet, AlertCircle, Route, ArrowLeft, ShieldCheck, HeartPulse, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, recommendAlternativeLocal, getNativeOrWebLocation } from '../api';
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

        // Build list of operational shelters filtered by active needs
        let rawFacilities = [
          {
            id: 'shelter_alpha',
            name: 'Shelter Alpha (Central High)',
            type: 'Community Hall',
            dist_m: 510,
            walk_min: 7,
            status: 'Operational',
            facilities: ['Water', 'Food', 'Shelter', '300 Beds'],
            lat: 28.7120,
            lon: 77.0980,
          },
          {
            id: 'clinic_beta',
            name: 'Clinic Beta (West District)',
            type: 'Primary Clinic',
            dist_m: 530,
            walk_min: 7,
            status: 'Operational',
            facilities: ['Medical', 'Water', 'Resuscitation'],
            lat: 28.7090,
            lon: 77.0940,
          },
          {
            id: 'water_tanker_4',
            name: 'Water Tanker 4 (North Gate)',
            type: 'Municipal Tanker',
            dist_m: 560,
            walk_min: 8,
            status: 'Operational',
            facilities: ['Water', 'Clean Supply'],
            lat: 28.7060,
            lon: 77.1080,
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
              lat: 28.7100,
              lon: 77.1000,
            });
          }
        }

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
      setCenter({ lat: Number(pos.lat.toFixed(4)), lon: Number(pos.lon.toFixed(4)) });
    } catch (err) {
      console.warn('GPS unavailable:', err);
    }
  };

  const handleNavigate = (shelter) => {
    navigate('/compass', { state: { target: shelter } });
  };

  return (
    <div className="min-h-screen bg-[#050914] text-white font-sans flex flex-col">
      {/* TOP HEADER */}
      <header className="flex justify-between items-center px-6 sm:px-10 py-5 border-b border-slate-800 bg-[#091122]">
        <div className="flex items-center gap-6">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            title="Back to Crisis HUD"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <ShieldCheck className="text-emerald-400 w-7 h-7" />
              Find a Safe Location
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 font-mono mt-0.5">
              Qdrant Edge Vector Rerouting · 100% Offline Satellite Trilateration
            </p>
          </div>
        </div>
        <div className="bg-emerald-950/60 border border-emerald-700/80 text-emerald-400 px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2">
          <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse"></div>
          OFFLINE VECTOR BRAIN
        </div>
      </header>

      {/* MAIN CONTENT */}
      <div className="flex-grow p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: Interactive Filters */}
        <div className="lg:col-span-3 bg-[#0f172a] border border-slate-800 rounded-2xl p-6 flex flex-col">
          <h3 className="text-xl font-bold mb-6 text-slate-100 flex items-center justify-between">
            <span>Filter Criteria</span>
            {loading && <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />}
          </h3>

          <div className="mb-6">
            <h4 className="text-xs text-slate-400 font-bold tracking-widest uppercase mb-4">YOUR NEEDS</h4>
            <div className="space-y-3">
              {[
                ['water', 'Water & Purification', Droplet],
                ['medical', 'Medical & First Aid', HeartPulse],
                ['shelter', 'Shelter & Beds', ShieldCheck],
                ['food', 'Food & Ration Packs', Square],
              ].map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => toggleNeed(key)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left text-sm transition-all ${
                    needs[key]
                      ? 'bg-emerald-950/40 border-emerald-500 text-emerald-200 font-semibold'
                      : 'bg-[#07111e] border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {needs[key] ? (
                    <CheckSquare className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-600 shrink-0" />
                  )}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <h4 className="text-xs text-slate-400 font-bold tracking-widest uppercase mb-4">AVOID HAZARDS</h4>
            <div className="space-y-3">
              {[
                ['flooded', 'Flooded areas & deep water'],
                ['electrical', 'Downed electrical wires'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => toggleAvoid(key)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left text-sm transition-all ${
                    avoid[key]
                      ? 'bg-rose-950/40 border-rose-500 text-rose-200 font-semibold'
                      : 'bg-[#07111e] border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {avoid[key] ? (
                    <CheckSquare className="w-5 h-5 text-rose-400 shrink-0" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-600 shrink-0" />
                  )}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-auto pt-4 border-t border-slate-800">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-xs text-slate-400 font-bold tracking-widest uppercase">WALKING RADIUS</h4>
              <button onClick={acquireGps} className="text-xs text-cyan-400 hover:underline font-mono">
                GPS
              </button>
            </div>
            <div className="flex justify-between items-end mb-2">
              <span className="text-2xl font-bold font-mono text-cyan-300">
                {radiusKm} <span className="text-sm text-slate-400">km</span>
              </span>
              <span className="text-slate-400 text-xs font-mono">~{Math.round(radiusKm * 14)} min walk</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="5.0"
              step="0.5"
              value={radiusKm}
              onChange={(e) => setRadiusKm(parseFloat(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
          </div>
        </div>

        {/* MIDDLE COLUMN: Dynamic Shelter Cards */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <h4 className="text-xs text-slate-400 font-bold tracking-widest uppercase">
            SUGGESTED SAFE SHELTERS ({shelters.length})
          </h4>

          {shelters.map((shelter, idx) => (
            <div
              key={shelter.id}
              className={`bg-[#0f172a] border rounded-2xl p-5 transition-all shadow-md ${
                idx === 0
                  ? 'border-cyan-500 shadow-cyan-900/20 bg-gradient-to-br from-[#0f172a] to-[#071325]'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-lg font-bold text-slate-100">{shelter.name}</h3>
                <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-700/60 px-2.5 py-0.5 rounded-full text-xs font-bold">
                  {shelter.status}
                </span>
              </div>
              <p className="text-slate-400 text-xs mb-3 font-mono">
                {shelter.type} · {shelter.dist_m} m away · ~{shelter.walk_min} min walk
              </p>
              <div className="flex gap-1.5 mb-4 flex-wrap">
                {shelter.facilities.map((fac) => (
                  <span
                    key={fac}
                    className="bg-slate-800 text-slate-300 border border-slate-700 px-3 py-1 rounded-full text-xs font-medium"
                  >
                    {fac}
                  </span>
                ))}
              </div>
              <button
                onClick={() => handleNavigate(shelter)}
                className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm py-3 rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-cyan-900/30"
              >
                <Route className="w-4 h-4" /> Navigate on Compass HUD
              </button>
            </div>
          ))}

          {/* Exclusion Warning (Negative Vector output) */}
          {excluded && (
            <div className="bg-rose-950/40 border border-rose-800 rounded-2xl p-4 flex items-center gap-3 text-rose-300 text-xs">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>
                <strong>{excluded.name || excluded.entity_id || 'CP-17'} Excluded:</strong> {excluded.hazard || 'Flooded entrance, live electrical wires detected.'} Rerouted to nearest safe facility automatically.
              </span>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Map View */}
        <div className="lg:col-span-5 bg-[#0b1120] border border-slate-800 rounded-2xl overflow-hidden min-h-[400px] flex flex-col">
          <div className="p-3 border-b border-slate-800 bg-[#07111e] flex justify-between items-center">
            <span className="text-xs font-bold font-mono text-cyan-300 uppercase tracking-wider">
              TACTICAL FIELD MAP
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              Center: {center.lat.toFixed(4)}, {center.lon.toFixed(4)}
            </span>
          </div>
          <div className="flex-1 p-3">
            <MapPanel center={center} items={mapItems} onMarker={(item) => handleNavigate(item)} />
          </div>
        </div>
      </div>
    </div>
  );
}