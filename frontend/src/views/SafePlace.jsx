import { useEffect, useState, useCallback } from 'react';
import {
  CheckSquare,
  Square,
  Droplet,
  AlertCircle,
  Route,
  ShieldCheck,
  HeartPulse,
  RefreshCw,
  Crosshair,
  PlusCircle,
  X,
  CheckCircle2,
  Building
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  getDeviceId,
  recommendAlternativeLocal,
  getNativeOrWebLocation,
  invalidateApiCache
} from '../api';
import { Shell } from '../components';
import MapPanel from '../MapPanel';
import useLiveGps from '../hooks/useLiveGps.js';
import { coordinates, loadDashboardFeed } from '../brain/adminData.js';
import { getAllLocalReports } from '../brain/offlineStorage.js';
import { currentSurvivorReports, reportedFacilities } from '../brain/survivorReports.js';

const emptyShelter = () => ({ name: '', type: 'Community Shelter', facilities: [], capacity: '', notes: '', lat: '', lon: '' });

export default function SafePlace() {
  const navigate = useNavigate();
  const gps = useLiveGps();
  const center = gps.fix;
  const [needs, setNeeds] = useState({
    water: false,
    medical: false,
    shelter: false,
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

  // New Safe Place Registration Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [newShelter, setNewShelter] = useState(emptyShelter);

  // Load dynamic data from Qdrant Edge Memory & Negative Vector Engine
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const local = await getAllLocalReports();
      setMapItems(currentSurvivorReports(local));
      setShelters(reportedFacilities(local, center, needs, radiusKm * 1000));
      const feed = await loadDashboardFeed(api, false, local);
      const records = currentSurvivorReports(feed.items, await getAllLocalReports());
      setMapItems(records);
      setShelters(reportedFacilities(records, center, needs, radiusKm * 1000));
      const hazard = records.find(report => report.id && (report.kind === 'hazard'
        || ['danger', 'blocked', 'flooded', 'compromised'].includes(report.status)));
      setExcluded(null);
      if (hazard && (avoid.flooded || avoid.electrical)) {
        const result = await recommendAlternativeLocal(hazard.entity_id || hazard.id, hazard.text || hazard.status).catch(() => null);
        if (result?.compromised) setExcluded(result.compromised);
      }

    } catch (err) {
      console.error('Failed to load safe places:', err);
    } finally {
      setLoading(false);
    }
  }, [center, needs, avoid, radiusKm]);

  useEffect(() => {
    loadData();
    window.addEventListener('rescue:reports-changed', loadData);
    return () => window.removeEventListener('rescue:reports-changed', loadData);
  }, [loadData]);

  const toggleNeed = (key) => setNeeds((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleAvoid = (key) => setAvoid((prev) => ({ ...prev, [key]: !prev[key] }));

  const acquireGps = async () => {
    try { await gps.refresh(); } catch (error) { setToastMessage(error.message); }
  };

  const handleNavigate = (shelter) => {
    if (!coordinates(shelter.location || shelter)) { setToastMessage('This report has no valid coordinates.'); return; }
    navigate('/compass', { state: { target: shelter } });
  };

  // Submit Handler: Register new safe place
  const handleAddSafePlace = async (e) => {
    e.preventDefault();
    if (!newShelter.name.trim()) return;
    setSubmitting(true);
    try {
      const location = coordinates(newShelter);
      if (!location) throw new Error('Enter the actual facility coordinates or use GPS.');
      const entityId = `safe_${crypto.randomUUID()}`;
      const result = await api('/api/reports', {
        method: 'POST',
        admin: true,
        body: {
          kind: 'checkpoint',
          entity_id: entityId,
          status: 'operational',
          severity: 'green',
          visibility: 'public',
          text: `${newShelter.name.trim()} (${newShelter.type}). Facilities: ${newShelter.facilities.join(', ') || 'Not reported'}. Capacity: ${newShelter.capacity || 'Not reported'}. Notes: ${newShelter.notes || 'Not reported'}`,
          location,
          reporter_id: getDeviceId(),
          verified: true,
        }
      });
      invalidateApiCache();
      setShowAddModal(false);
      setToastMessage(`Shelter "${newShelter.name}" saved${result.queued ? " locally · publication pending" : ""}.`);
      setNewShelter(emptyShelter());
      await loadData();
    } catch (err) {
      alert(`Failed to add safe place: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell
      title="Safe Evacuation & Negative Routing"
      subtitle="Qdrant Edge Vector Rerouting & Autonomous Shelter Navigation"
    >
      {/* TOAST MESSAGE */}
      {toastMessage && (
        <div role="status" className="mb-3 p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-950/40 text-emerald-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage('')} className="p-1 text-emerald-300 hover:text-white cursor-pointer" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {/* TOP HEADER ACTION BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 p-2 sm:p-2.5 rounded-2xl shadow-xs">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <ShieldCheck size={18} />
          </div>
          <div>
            <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
              Reported Shelters & Supply Points
            </h2>
            <p className="text-[10px] text-slate-500 font-mono">
              Saved and received facility reports
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setNewShelter((prev) => ({ ...prev, lat: center?.lat ?? '', lon: center?.lon ?? '' }));
              setShowAddModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs transition cursor-pointer"
          >
            <PlusCircle size={14} />
            <span>Add Safe Haven</span>
          </button>
        </div>
      </div>

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
                  className={`w-full flex items-center gap-2 p-2 rounded-xl border text-left text-xs transition-all cursor-pointer ${
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
                  className={`w-full flex items-center gap-2 p-2 rounded-xl border text-left text-xs transition-all cursor-pointer ${
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
              <button onClick={acquireGps} className="text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline font-mono font-bold flex items-center gap-1 cursor-pointer">
                <Crosshair size={12} /> Sync GPS
              </button>
            </div>
            <div className="flex justify-between items-end mb-1">
              <span className="text-base sm:text-lg font-bold font-mono text-cyan-700 dark:text-cyan-300">
                {radiusKm} <span className="text-xs text-slate-500">km</span>
              </span>
              <span className="text-slate-500 dark:text-slate-400 text-[10px] font-mono">Search range</span>
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
              REPORTED SHELTERS & SUPPLIES ({shelters.length})
            </h4>
            <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">Saved reports</span>
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
                  {shelter.status || 'Not reported'}
                </span>
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-[11px] mb-2 font-mono">
                {shelter.type} · {shelter.dist_m == null ? 'Distance unavailable' : `${shelter.dist_m} m straight line`}
              </p>
              <div className="flex gap-1 mb-2.5 flex-wrap">
                {(shelter.facilities || []).map((fac) => (
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
                <strong>{excluded.name || excluded.entity_id || excluded.id || 'Reported location'} excluded:</strong> {excluded.hazard || excluded.text || 'Hazard details unavailable.'}
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
              {center ? `Center: ${center.lat.toFixed(4)}, ${center.lon.toFixed(4)}` : 'GPS unavailable'}
            </span>
          </div>
          <div className="flex-1 p-2">
            <MapPanel center={center} items={mapItems} onMarker={(item) => handleNavigate(item)} />
          </div>
        </div>
      </div>

      {/* MODAL: REGISTER NEW SAFE HAVEN */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-lg bg-white dark:bg-[#0b1626] border border-emerald-500/30 rounded-3xl p-5 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <PlusCircle size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Register New Safe Haven
                  </h3>
                  <p className="text-[10px] text-slate-500 font-mono">
                Save the facility details for sharing when a connection is available
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddSafePlace} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Safe Haven Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. North Gate Community Center, St. Jude Clinic"
                  value={newShelter.name}
                  onChange={(e) => setNewShelter({ ...newShelter, name: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                    Facility Type
                  </label>
                  <select
                    value={newShelter.type}
                    onChange={(e) => setNewShelter({ ...newShelter, type: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  >
                    <option value="Community Shelter">Community Shelter</option>
                    <option value="Primary Clinic">Primary Clinic / Trauma Tent</option>
                    <option value="Municipal Tanker">Clean Water Tanker</option>
                    <option value="Supply Distribution">Food & Ration Cache</option>
                    <option value="High Ground Safe Point">High Ground Safe Point</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                    Estimated Capacity / Beds
                  </label>
                  <input
                    type="text"
                    placeholder="Enter the reported capacity"
                    value={newShelter.capacity}
                    onChange={(e) => setNewShelter({ ...newShelter, capacity: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Available Facilities & Supplies
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {['Water', 'Medical', 'Shelter', 'Food', 'Generator', 'Security'].map((fac) => {
                    const isChecked = newShelter.facilities.includes(fac);
                    return (
                      <button
                        type="button"
                        key={fac}
                        onClick={() => {
                          const updated = isChecked
                            ? newShelter.facilities.filter((f) => f !== fac)
                            : [...newShelter.facilities, fac];
                          setNewShelter({ ...newShelter, facilities: updated });
                        }}
                        className={`p-2 rounded-xl border text-left text-xs font-semibold flex items-center justify-between cursor-pointer transition ${
                          isChecked
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-800 dark:text-emerald-300'
                            : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400'
                        }`}
                      >
                        <span>{fac}</span>
                        <span className={`w-2 h-2 rounded-full ${isChecked ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Operational Details & Access Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Accessible via South Gate. Clean drinking water available. Electric power generator operational."
                  value={newShelter.notes}
                  onChange={(e) => setNewShelter({ ...newShelter, notes: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[10px] font-mono font-bold uppercase text-slate-500">
                    Location Coordinates
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const pos = await getNativeOrWebLocation({ allowCached: false });
                        if (coordinates(pos)) {
                          setNewShelter({
                            ...newShelter,
                            lat: pos.lat,
                            lon: pos.lon,
                          });
                        }
                      } catch (error) { setToastMessage(error.message); }
                    }}
                    className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Crosshair size={11} /> Use Current GPS
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[9px] font-mono text-slate-400">LATITUDE</span>
                    <input
                      type="number"
                      step="0.0001"
                      required
                      value={newShelter.lat}
                      onChange={(e) => setNewShelter({ ...newShelter, lat: e.target.value })}
                      className="w-full p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <span className="text-[9px] font-mono text-slate-400">LONGITUDE</span>
                    <input
                      type="number"
                      step="0.0001"
                      required
                      value={newShelter.lon}
                      onChange={(e) => setNewShelter({ ...newShelter, lon: e.target.value })}
                      className="w-full p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                >
                  {submitting ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={14} />
                  )}
                  <span>{submitting ? 'Registering...' : 'Register Safe Haven'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Shell>
  );
}
