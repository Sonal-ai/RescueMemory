import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Award,
  Building,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CloudUpload,
  Cross,
  Crosshair,
  Database,
  Eye,
  FileCheck,
  GitBranch,
  HeartPulse,
  Info,
  MapPin,
  Navigation,
  PlusCircle,
  Radio,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Trash2,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  api,
  formatTime,
  setting,
  saveSetting,
  getNativeOrWebLocation,
  getDiscoveredPeers,
  updateDeviceLocation,
  distM,
  bearingDeg,
  cardinalDirection,
  invalidateApiCache,
  onOnlineModeChange,
  isOnlineMode,
  triggerAutoSync,
  getDeviceId
} from '../api';
import { Shell, Card, Empty } from '../components';
import MapPanel from '../MapPanel';
import MeshSyncScanner from '../components/MeshSyncScanner';
import { CLOUD_COLLECTIONS, displayCloudCount, cloudMirrorSummary } from '../brain/cloudInspector.js';
import { offlineCloudResult } from '../brain/cloudApi.js';

import { coordinates, equipmentInventory, dashboardSummary, loadDashboardFeed } from '../brain/adminData.js';

export default function AdminPortal({ initialTab = 'hq' }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Active Role Tab: 'volunteer' | 'hq' | 'inspector'
  const [activeTab, setActiveTab] = useState(() => {
    if (location.pathname === '/volunteer') return 'volunteer';
    if (location.pathname === '/command') return 'inspector';
    return initialTab || 'hq';
  });

  useEffect(() => {
    if (location.pathname === '/volunteer') setActiveTab('volunteer');
    else if (location.pathname === '/command') setActiveTab('inspector');
    else if (location.pathname === '/hq' || location.pathname === '/admin') setActiveTab('hq');
  }, [location.pathname]);

  const handleSelectTab = (tab) => {
    setActiveTab(tab);
    if (tab === 'volunteer' && location.pathname !== '/volunteer') navigate('/volunteer');
    else if (tab === 'hq' && location.pathname !== '/hq' && location.pathname !== '/admin') navigate('/hq');
    else if (tab === 'inspector' && location.pathname !== '/command') navigate('/command');
  };

  const [center, setCenter] = useState(null);
  const [health, setHealth] = useState(null);
  const [sync, setSync] = useState(null);
  const [events, setEvents] = useState([]);
  const [cloudStatus, setCloudStatus] = useState(null);
  const [peers, setPeers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [gpsError, setGpsError] = useState('');
  const [feedState, setFeedState] = useState(null);

  // Tab 1 (Volunteer) Specific States
  const [triageFilter, setTriageFilter] = useState('all');
  const [myMissions, setMyMissions] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('rescue.my_missions') || '[]');
    } catch {
      return [];
    }
  });
  const [equipment, setEquipment] = useState(() => {
    try { return equipmentInventory(JSON.parse(localStorage.getItem('rescue.equipment') || 'null')); }
    catch { return equipmentInventory(null); }
  });

  // Tab 2 (Command HQ) Specific States
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [showHazardVerifyModal, setShowHazardVerifyModal] = useState(false);
  const [verifyHazardInput, setVerifyHazardInput] = useState({ entity_id: '', status: '', severity: '', text: '' });
  const [showProtocolModal, setShowProtocolModal] = useState(false);
  const [protocolInput, setProtocolInput] = useState({ id: '', title: '', summary: '', keywords: '', steps: '', warnings: '', source: '', reviewer: '' });
  const [showSafeHavenModal, setShowSafeHavenModal] = useState(false);
  const [safeHavenInput, setSafeHavenInput] = useState({ name: '', type: 'Community Shelter', facilities: [], capacity: '', notes: '', lat: '', lon: '' });

  // Tab 3 (Cloud Inspector) Specific States
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [recordJourney, setRecordJourney] = useState(null);
  const [cloudCollection, setCloudCollection] = useState(CLOUD_COLLECTIONS[0].name);
  const [cloudPage, setCloudPage] = useState(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [cloudRefresh, setCloudRefresh] = useState(0);
  const [journeyError, setJourneyError] = useState('');
  const cloudGeneration = useRef(0), selectionGeneration = useRef(0);
  const dataLoading = useRef(false);
  const dataGeneration = useRef(0);

  // Ensure default demo admin credentials
  useEffect(() => {
    if (!setting('adminKey')) {
      saveSetting('adminKey', 'rescue-admin-key-2026');
    }
    if (!setting('responderKey')) {
      saveSetting('responderKey', 'rescue-responder-shared-key-2026');
    }
  }, []);

  // Sync tab with URL if user lands on /volunteer or /command
  useEffect(() => {
    if (location.pathname === '/volunteer') setActiveTab('volunteer');
    else if (location.pathname === '/command') setActiveTab('inspector');
    else if (location.pathname === '/hq') setActiveTab('hq');
  }, [location.pathname]);

  // Admin locations must be a current GPS fix; legacy anchor/cache is not evidence.
  const refreshLocation = useCallback(async () => {
    try {
      const pos = await getNativeOrWebLocation({ allowCached: false, allowFallback: false });
      const loc = coordinates(pos);
      if (!loc) throw new Error('No confirmed GPS coordinates received.');
      setCenter(loc); setGpsError('');
      updateDeviceLocation({ ...loc, status: 'responder_active' }).catch(() => {});
      return loc;
    } catch (err) { setGpsError(err.message); return null; }
  }, []);
  useEffect(() => { refreshLocation(); }, [refreshLocation]);

  // Primary SWR Data Fetcher: Fast & Cached
  const loadData = useCallback(async (forceRefresh = false) => {
    if (dataLoading.current) return;
    dataLoading.current = true;
    const generation = ++dataGeneration.current;
    setLoading(true);
    try {
      const [h, s, feed, cloudInfo, disc] = await Promise.all([
        api('/health', { preferCache: !forceRefresh, cacheTtl: 10000 }).catch(() => null),
        api('/api/sync/status', { preferCache: !forceRefresh, cacheTtl: 10000 }).catch(() => null),
        loadDashboardFeed(api, forceRefresh),
        api('/api/sync/cloud-status', { admin: true, noCache: true }).catch(err => ({ connected: false, counts_verified: false, error: err.message })),
        getDiscoveredPeers().catch(err => ({ peers: [], error: err.message })),
      ]);
      if (generation !== dataGeneration.current) return;
      setHealth(h); setSync(s); setCloudStatus(cloudInfo);
      setPeers(disc?.peers || []);
      setFeedState({ ...feed, peerError: disc?.error });
      setEvents(feed.items);
    } catch (err) {
      if (generation === dataGeneration.current) setError(err.message);
    } finally {
      if (generation === dataGeneration.current) {
        dataLoading.current = false;
        setLoading(false);
      }
    }
  }, []);

  // Poll in background every 15s without interrupting user actions
  useEffect(() => {
    loadData(false);
    const timer = setInterval(() => loadData(false), 15000);
    return () => clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    const refreshConnection = () => {
      // Results started before a mode change must not overwrite the new state.
      dataGeneration.current++;
      dataLoading.current = false;
      if (!isOnlineMode() || navigator.onLine === false) setCloudStatus(offlineCloudResult('/api/sync/cloud-status'));
      loadData(true);
      setCloudRefresh(value => value + 1);
    };
    const unsubscribe = onOnlineModeChange(refreshConnection);
    window.addEventListener('online', refreshConnection);
    window.addEventListener('offline', refreshConnection);
    return () => {
      unsubscribe();
      window.removeEventListener('online', refreshConnection);
      window.removeEventListener('offline', refreshConnection);
    };
  }, [loadData]);

  useEffect(() => {
    if (activeTab !== 'inspector') return;
    let cancelled = false;
    const generation = ++cloudGeneration.current;
    selectionGeneration.current++;
    const fetchPage = async () => {
      setCloudLoading(true); setCloudError(''); setCloudPage(null);
      setSelectedRecord(null); setRecordJourney(null); setJourneyError('');
      try {
        const result = await api(`/api/sync/cloud-records?collection=${encodeURIComponent(cloudCollection)}&limit=50`, { admin: true, noCache: true });
        if (!Array.isArray(result.items) || result.source !== 'qdrant_cloud') throw new Error('Cloud record page was not confirmed.');
        if (!cancelled && generation === cloudGeneration.current) setCloudPage(result);
      } catch (err) { if (!cancelled) setCloudError(err.message); }
      finally { if (!cancelled) setCloudLoading(false); }
    };
    const first = setTimeout(fetchPage, 0);
    return () => { cancelled = true; clearTimeout(first); cloudGeneration.current++; };
  }, [activeTab, cloudCollection, cloudRefresh]);
  const loadMoreCloud = async () => {
    if (cloudLoading || cloudPage?.next_offset == null) return;
    setCloudLoading(true); setCloudError('');
    const collection = cloudCollection;
    const generation = cloudGeneration.current;
    try {
      const result = await api(`/api/sync/cloud-records?collection=${encodeURIComponent(collection)}&limit=50&offset=${encodeURIComponent(cloudPage.next_offset)}`, { admin: true, noCache: true });
      if (!Array.isArray(result.items) || result.source !== 'qdrant_cloud') throw new Error('Cloud record page was not confirmed.');
      if (generation !== cloudGeneration.current) return;
      setCloudPage(previous => previous?.collection === collection ? { ...result, items: Array.from(new Map([...previous.items, ...result.items].map(item => [item.point_id, item])).values()) } : previous);
    } catch (err) { if (generation === cloudGeneration.current) setCloudError(err.message); }
    finally { if (generation === cloudGeneration.current) setCloudLoading(false); }
  };

  // Tab 1 Action: Claim / Dispatch Mission
  const claimMission = (casualty) => {
    const updated = Array.from(new Set([...myMissions, casualty.id]));
    setMyMissions(updated);
    localStorage.setItem('rescue.my_missions', JSON.stringify(updated));
    setMessage(`Dispatched to casualty #${casualty.id.slice(0, 8)}. Mission logged in active missions.`);
  };

  // Tab 1 Action: Mark Rescued & Evacuated
  const markRescued = async (casualty) => {
    setWorking('rescue');
    try {
      await api('/api/reports', {
        method: 'POST',
        admin: true,
        body: {
          kind: 'incident',
          text: `Casualty #${casualty.id.slice(0, 8)} evacuated & marked evacuated by responder.`,
          entity_id: casualty.entity_id || casualty.id,
          status: 'rescued_transported',
          severity: 'green',
          visibility: 'responders',
          reporter_id: getDeviceId(),
          location: coordinates(casualty.location),
        }
      });
      const updated = myMissions.filter((id) => id !== casualty.id);
      setMyMissions(updated);
      localStorage.setItem('rescue.my_missions', JSON.stringify(updated));
      invalidateApiCache();
      setMessage('Evacuation update saved.');
      await loadData(true);
    } catch (err) {
      setError(`Failed to update casualty: ${err.message}`);
    } finally {
      setWorking('');
    }
  };

  // Tab 2 Action: Verify Hazard & HMAC Sign
  const handleVerifyHazard = async (e) => {
    e.preventDefault();
    setWorking('hazard');
    setError('');
    setMessage('');
    try {
      const res = await api('/api/reports', {
        method: 'POST',
        admin: true,
        body: {
          kind: 'hazard',
          entity_id: verifyHazardInput.entity_id,
          status: verifyHazardInput.status,
          text: verifyHazardInput.text,
          severity: verifyHazardInput.severity,
          visibility: 'public',
          location: center,
          reporter_id: getDeviceId(),
          verified: true,
        }
      });
      setShowHazardVerifyModal(false);
      invalidateApiCache();
      setMessage(`Hazard report saved for #${verifyHazardInput.entity_id}${res.event?.authority_tag ? ' with a server authority signature' : ''}.`);
      await loadData(true);
    } catch (err) {
      setError(`Verification failed: ${err.message}`);
    } finally {
      setWorking('');
    }
  };

  // Tab 2 Action: Publish Signed Protocol
  const handlePublishProtocol = async (e) => {
    e.preventDefault();
    setWorking('protocol');
    setError('');
    setMessage('');
    try {
      const body = {
        ...protocolInput,
        steps: protocolInput.steps.split('\n').map((s) => s.trim()).filter(Boolean),
        warnings: protocolInput.warnings.split('\n').map((s) => s.trim()).filter(Boolean),
        reviewer: protocolInput.reviewer.trim(),
        source: protocolInput.source.trim(),
      };
      const res = await api('/api/guides/publish', { method: 'POST', admin: true, body });
      setShowProtocolModal(false);
      invalidateApiCache();
      setMessage(`Protocol #${res.id || protocolInput.id} published${res.auth_tag ? ' with a server signature' : ''}.`);
      await loadData(true);
    } catch (err) {
      setError(`Publish failed: ${err.message}`);
    } finally {
      setWorking('');
    }
  };

  // Tab 2 Action: Register Verified Safe Haven
  const handleRegisterSafeHaven = async (e) => {
    e.preventDefault();
    setWorking('shelter');
    setError('');
    setMessage('');
    try {
      const loc = coordinates(safeHavenInput);
      if (!loc) throw new Error('Enter valid facility coordinates or use current GPS.');
      const entityId = `shelter_${crypto.randomUUID()}`;
      const res = await api('/api/reports', {
        method: 'POST',
        admin: true,
        body: {
          kind: 'checkpoint',
          entity_id: entityId,
          status: 'operational',
          severity: 'green',
          visibility: 'public',
          text: `${safeHavenInput.name.trim()} (${safeHavenInput.type}). Facilities: ${safeHavenInput.facilities.join(', ') || 'Not reported'}. Capacity: ${safeHavenInput.capacity.trim() || 'Not reported'}. Notes: ${safeHavenInput.notes.trim() || 'Not reported'}`,
          location: loc,
          reporter_id: getDeviceId(),
          verified: true,
        }
      });
      setShowSafeHavenModal(false);
      invalidateApiCache();
      setMessage(`Safe haven "${safeHavenInput.name}" saved${res.event?.authority_tag ? ' with a server authority signature' : ''}.`);
      await loadData(true);
    } catch (err) {
      setError(`Failed to register safe haven: ${err.message}`);
    } finally {
      setWorking('');
    }
  };

  // Tab 3 Action: Mirror to Qdrant Cloud
  const handleCloudMirror = async () => {
    setWorking('mirror');
    setError('');
    setMessage('');
    try {
      const res = await api('/api/sync/cloud-mirror', { method: 'POST', admin: true });
      setMessage(cloudMirrorSummary(res));
      setCloudRefresh(value => value + 1);
      invalidateApiCache();
      await loadData(true);
    } catch (err) {
      setError(`Cloud sync notice: ${err.message}`);
    } finally {
      setWorking('');
    }
  };

  // Tab 3 Action: Reset Database to 0
  const handleResetDb = async () => {
    if (!window.confirm('Are you sure you want to RESET all database shards and Qdrant Cloud to 0 points? This prepares a clean slate.')) {
      return;
    }
    setWorking('reset');
    setError('');
    setMessage('');
    try {
      await api('/api/admin/reset-all', { method: 'POST', admin: true });
      invalidateApiCache();
      setMyMissions([]);
      localStorage.setItem('rescue.my_missions', '[]');
      setSelectedRecord(null); setRecordJourney(null); setCloudRefresh(value => value + 1);
      setMessage('Database reset finished. Refreshing verified counts.');
      await loadData(true);
    } catch (err) {
      setError(`Reset failed: ${err.message}`);
    } finally {
      setWorking('');
    }
  };

  // Cloud payloads and verified relay receipts are separate evidence.
  const inspectRecord = async (point) => {
    const generation = ++selectionGeneration.current;
    const rec = { ...point.payload, point_id: point.point_id };
    setSelectedRecord(rec); setRecordJourney(null); setJourneyError('');
    if (!rec.id) { setJourneyError('No event ID or relay receipts available for this cloud point.'); return; }
    try { const result = await api(`/api/provenance/${encodeURIComponent(rec.id)}`, { responder: true, noCache: true }); if (generation === selectionGeneration.current) setRecordJourney(result); }
    catch (err) { if (generation === selectionGeneration.current) setJourneyError(`Relay receipts unavailable: ${err.message}`); }
  };

  // Latest stored state per entity; a red hazard is not a medical casualty.
  const { casualties, hazards, havens, redCount, yellowCount, rescuedCount } = dashboardSummary(events);
  const openSafeHavens = havens.length;
  const countLabel = value => feedState?.complete ? value : 'Unavailable';
  const filteredCasualties = casualties.filter(c => {
    const isRescued = c.status === 'rescued_transported';
    if (triageFilter === 'red') return c.severity === 'red' && !isRescued;
    if (triageFilter === 'yellow') return c.severity === 'yellow' && !isRescued;
    if (triageFilter === 'rescued') return isRescued;
    return true;
  });

  const currentShards = cloudStatus?.connected ? cloudStatus.shards || {} : {};
  const totalPoints = cloudStatus?.connected ? displayCloudCount(cloudStatus.total_points) : 'Unavailable';


  return (
    <Shell
      title="Tactical Command & Operations Portal"
      subtitle="Role-Based Incident Response, Autonomous Mesh Relay & Qdrant Cloud Telemetry"
    >
      {/* GLOBAL TOAST ALERTS */}
      {error && (
        <div role="alert" className="mb-3 p-2.5 rounded-xl border border-red-500/30 bg-red-950/40 text-red-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-red-400 shrink-0" />
            <span className="line-clamp-2">{error}</span>
          </div>
          <button onClick={() => setError('')} className="p-1 text-red-300 hover:text-white cursor-pointer" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {message && (
        <div role="status" className="mb-3 p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-950/40 text-emerald-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            <span>{message}</span>
          </div>
          <button onClick={() => setMessage('')} className="p-1 text-emerald-300 hover:text-white cursor-pointer" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {feedState?.errors?.length > 0 && <div role="alert" className="mb-3 p-2.5 rounded-xl border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs">Report feed incomplete: {feedState.errors.join(' · ')}. Available records remain visible; totals are unavailable.</div>}
      {feedState?.peerError && <p role="alert" className="mb-3 text-xs text-amber-600 dark:text-amber-400">Discovery unavailable: {feedState.peerError}</p>}
      {/* TOP ROLE SWITCHER TABS */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 p-1.5 rounded-2xl shadow-xs">
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleSelectTab('volunteer')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'volunteer'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <Stethoscope size={14} />
            <span>Field Responders & Medics</span>
            {redCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-white text-rose-600 font-black">
                {redCount}
              </span>
            )}
          </button>

          <button
            onClick={() => handleSelectTab('hq')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'hq'
                ? 'bg-cyan-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <Radio size={14} />
            <span>Command HQ & Sector Map</span>
          </button>

          <button
            onClick={() => handleSelectTab('inspector')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'inspector'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <Zap size={14} />
            <span>Qdrant Cloud & Vector Shards</span>
          </button>
        </div>

        {/* Global Refresh Button */}
        <button
          onClick={() => { loadData(true); if (activeTab === 'inspector') setCloudRefresh(value => value + 1); }}
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin text-cyan-500' : ''} />
          <span>Refresh · Local feed ({feedState?.complete ? events.length : 'Unavailable'})</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: FIELD RESPONDERS & MEDICS                                          */}
      {/* ========================================================================= */}
      {activeTab === 'volunteer' && (
        <div className="space-y-3">
          {/* TOP STAT RIBBON */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-900/60 rounded-2xl p-2.5 sm:p-3">
              <div className="text-[10px] font-mono uppercase text-rose-700 dark:text-rose-400 font-bold">Immediate (Red)</div>
              <div className="text-2xl font-black font-mono text-rose-600 dark:text-rose-500">{countLabel(redCount)}</div>
              <div className="text-[10px] text-rose-600/80 dark:text-rose-400/80">Reports marked red</div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-900/60 rounded-2xl p-2.5 sm:p-3">
              <div className="text-[10px] font-mono uppercase text-amber-700 dark:text-amber-400 font-bold">Delayed (Yellow)</div>
              <div className="text-2xl font-black font-mono text-amber-600 dark:text-amber-500">{countLabel(yellowCount)}</div>
              <div className="text-[10px] text-amber-600/80 dark:text-amber-400/80">Reports marked yellow</div>
            </div>

            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-900/60 rounded-2xl p-2.5 sm:p-3">
              <div className="text-[10px] font-mono uppercase text-emerald-700 dark:text-emerald-400 font-bold">Rescued / Evacuated</div>
              <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-500">{countLabel(rescuedCount)}</div>
              <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">Reports marked evacuated</div>
            </div>

            <div className="bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-300 dark:border-cyan-900/60 rounded-2xl p-2.5 sm:p-3">
              <div className="text-[10px] font-mono uppercase text-cyan-700 dark:text-cyan-400 font-bold">Active Missions</div>
              <div className="text-2xl font-black font-mono text-cyan-600 dark:text-cyan-400">{myMissions.length}</div>
              <div className="text-[10px] text-cyan-600/80 dark:text-cyan-400/80">Assigned to My Unit</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
            {/* LEFT COLUMN: LIVE CASUALTY TRIAGE QUEUE (7 COLS) */}
            <div className="lg:col-span-7 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 flex flex-col shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-slate-800 mb-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-3.5 rounded-full bg-rose-600 inline-block"></span>
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                    Reported Casualty Queue
                  </h3>
                </div>

                <div className="flex items-center gap-1 text-xs">
                  {['all', 'red', 'yellow', 'rescued'].map((f) => (
                    <button
                      key={f}
                      onClick={() => setTriageFilter(f)}
                      className={`px-2 py-0.5 rounded-lg font-bold text-[11px] capitalize cursor-pointer transition-all ${
                        triageFilter === f
                          ? 'bg-rose-600 text-white'
                          : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Triage Queue List */}
              <div className="space-y-2 overflow-y-auto max-h-[500px] pr-1">
                {filteredCasualties.length > 0 ? (
                  filteredCasualties.map((c) => {
                    const isClaimed = myMissions.includes(c.id);
                    const isRescued = c.status === 'rescued_transported';
                    const cLoc = coordinates(c.location);
                    const dist = center && cLoc ? Math.round(distM(center, cLoc)) : null;
                    const card = dist === null ? null : cardinalDirection(bearingDeg(center, cLoc));
                    const walkMin = dist === null ? null : Math.max(1, Math.round(dist / 75));

                    return (
                      <div
                        key={c.id}
                        className={`p-3 rounded-2xl border transition-all ${
                          isRescued
                            ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-900/40'
                            : c.severity === 'red'
                            ? 'bg-rose-50/60 dark:bg-rose-950/30 border-rose-300 dark:border-rose-900/60'
                            : 'bg-amber-50/60 dark:bg-amber-950/30 border-amber-300 dark:border-amber-900/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-black uppercase ${
                                isRescued
                                  ? 'bg-emerald-200 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300'
                                  : c.severity === 'red'
                                  ? 'bg-rose-200 dark:bg-rose-900 text-rose-800 dark:text-rose-200 animate-pulse'
                                  : 'bg-amber-200 dark:bg-amber-900 text-amber-800 dark:text-amber-200'
                              }`}
                            >
                              {isRescued ? '✓ Evacuated' : c.severity === 'red' ? '🚨 Reported Red' : c.severity === 'yellow' ? '🟡 Reported Yellow' : c.severity === 'green' ? 'Reported Green' : 'Severity unreported'}
                            </span>
                            <span className="text-[11px] font-mono text-slate-500">
                              #{c.id.slice(0, 8)}
                            </span>
                          </div>

                          <div className="text-[11px] font-mono font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                            <Navigation size={11} className="text-cyan-500 rotate-45" />
                            <span>{dist === null ? 'Distance unavailable' : `${dist}m ${card} (~${walkMin} min estimated walk)`}</span>
                          </div>
                        </div>

                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2 leading-relaxed">
                          {c.text}
                        </p>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/80 text-[10px]">
                          <div className="flex items-center gap-2 font-mono text-slate-500">
                            <span>Origin: {c.origin_device || 'Unknown'}</span>
                            <span>·</span>
                            <span>{formatTime(c.observed_at)}</span>
                          </div>

                          {/* ACTION BUTTONS */}
                          <div className="flex items-center gap-1.5">
                            {!isRescued && (
                              <>
                                {!isClaimed ? (
                                  <button
                                    onClick={() => claimMission(c)}
                                    className="px-2.5 py-1 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold font-mono text-[10px] cursor-pointer shadow-xs active:scale-95"
                                  >
                                    🚑 Dispatch to Me
                                  </button>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-lg bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 font-mono font-bold">
                                    En Route
                                  </span>
                                )}

                                <button
                                  onClick={() => markRescued(c)}
                                  disabled={working === 'rescue'}
                                  className="px-2.5 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold font-mono text-[10px] cursor-pointer shadow-xs active:scale-95"
                                >
                                  🏥 Evacuate to Clinic
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <Empty icon={HeartPulse}>{feedState?.complete ? 'No casualties in this triage category.' : 'Report feed unavailable or incomplete.'}</Empty>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: EQUIPMENT LOCKER & MESH SYNC (5 COLS) */}
            <div className="lg:col-span-5 space-y-3">
              {/* Tactical Equipment Locker */}
              <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-3.5 rounded-full bg-cyan-600 inline-block"></span>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                      Tactical Equipment Locker
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400 font-bold">Operator inventory</span>
                </div>

                <div className="space-y-1.5 text-xs font-semibold">
                  {[
                    ['tourniquet', 'CAT Combat Windlass Tourniquet (Femoral bleed ready)'],
                    ['hemostatic_gauze', 'Hemostatic Gauze & Sterile Pressure Dressing'],
                    ['splint_stretcher', 'Compact Rigid Splint & Extraction Straps'],
                    ['water_purification', 'Chlorine Water Purification Disinfection Kit'],
                  ].map(([key, label]) => {
                    const active = equipment[key] === true;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          const updated = { ...equipment, [key]: !active };
                          setEquipment(updated);
                          localStorage.setItem('rescue.equipment', JSON.stringify(updated));
                        }}
                        className={`w-full p-2 rounded-xl border flex items-center justify-between text-left cursor-pointer transition-all ${
                          active
                            ? 'bg-cyan-50/60 dark:bg-cyan-950/30 border-cyan-300 dark:border-cyan-800/80 text-cyan-900 dark:text-cyan-200'
                            : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-400 line-through'
                        }`}
                      >
                        <span>{label}<small className="block font-normal">{equipment[key] === null ? 'Not reported — tap to confirm available' : active ? 'Reported available' : 'Reported unavailable'}</small></span>
                        <span className={`w-2 h-2 rounded-full ${active ? 'bg-cyan-500' : 'bg-slate-400'}`}></span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bluetooth BLE Mesh & Off-Grid Sync */}
              <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs">
                <MeshSyncScanner initialPeers={peers} onSyncComplete={() => loadData(true)} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: COMMAND HQ & STRATEGIC SECTOR MAP                                 */}
      {/* ========================================================================= */}
      {activeTab === 'hq' && (
        <div className="space-y-3">
          {/* EXECUTIVE DISASTER KPI STATUS */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-3 shadow-xs">
              <div className="text-[10px] font-mono uppercase text-slate-500 font-bold">Recorded Hazards</div>
              <div className="text-xl sm:text-2xl font-black font-mono text-rose-600 dark:text-rose-400">{countLabel(hazards.length)}</div>
              <div className="text-[10px] text-slate-500 font-mono">Latest hazard reports in local feed</div>
            </div>

            <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-3 shadow-xs">
              <div className="text-[10px] font-mono uppercase text-slate-500 font-bold">Casualties Logged</div>
              <div className="text-xl sm:text-2xl font-black font-mono text-slate-900 dark:text-slate-100">{countLabel(casualties.length)}</div>
              <div className="text-[10px] text-slate-500 font-mono">{countLabel(rescuedCount)} marked evacuated</div>
            </div>

            <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-3 shadow-xs">
              <div className="text-[10px] font-mono uppercase text-slate-500 font-bold">Verified Operational Facilities</div>
              <div className="text-xl sm:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">{countLabel(openSafeHavens)}</div>
              <div className="text-[10px] text-slate-500 font-mono">Latest reports marked verified & operational</div>
            </div>

            <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-3 shadow-xs">
              <div className="text-[10px] font-mono uppercase text-slate-500 font-bold">Detected Nearby Phones</div>
              <div className="text-xl sm:text-2xl font-black font-mono text-cyan-600 dark:text-cyan-400">{feedState && !feedState.peerError ? peers.length : 'Unavailable'}</div>
              <div className="text-[10px] text-slate-500 font-mono">Nearby discovery results</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
            {/* LEFT: STRATEGIC SECTOR MAP (7 COLS) */}
            <div className="lg:col-span-7 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-xs">
              <div className="p-2.5 bg-[#f7fafc] dark:bg-[#07111e] border-b border-[#dbe6f0] dark:border-slate-800 flex justify-between items-center">
                <span className="text-[11px] font-bold font-mono text-cyan-700 dark:text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Radio size={13} className="animate-pulse text-cyan-600" /> Strategic Sector Disaster Map
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  Schematic coordinate grid
                </span>
              </div>
              <div className="flex-1 p-2 min-h-[360px]">
                {center ? <MapPanel center={center} items={events.filter(e => coordinates(e.location))} peers={peers.filter(p => coordinates(p))} originLabel="YOU (RESPONDER)" /> : <Empty icon={MapPin}>Sector map needs a confirmed GPS fix.</Empty>}
                {gpsError && <p role="status" className="text-xs text-amber-600 dark:text-amber-400 mt-2">{gpsError}</p>}
                <button className="btn-secondary mt-2" onClick={refreshLocation}>Refresh GPS</button>
              </div>
            </div>

            {/* RIGHT: INCIDENT DIRECTIVES & VERIFICATION (5 COLS) */}
            <div className="lg:col-span-5 space-y-3">
              {/* 1-Click Hazard Verification Box */}
              <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-3.5 rounded-full bg-amber-500 inline-block"></span>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                      Hazard Verification & Authority Signer
                    </h3>
                  </div>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                  Sign official checkpoint directives with HMAC authority key to trigger immediate negative-vector avoidance across all survivor compasses.
                </p>

                <button
                  onClick={() => setShowHazardVerifyModal(true)}
                  className="w-full py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition"
                >
                  <ShieldCheck size={14} />
                  <span>Verify Checkpoint / Hazard</span>
                </button>
              </div>

              {/* Authority Survival Protocol Publisher */}
              <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-3.5 rounded-full bg-cyan-600 inline-block"></span>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                      Signed Protocol Publisher
                    </h3>
                  </div>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                  Broadcast authoritative emergency medical & evacuation procedures into on-device vector shards.
                </p>

                <button
                  onClick={() => setShowProtocolModal(true)}
                  className="w-full py-2 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition"
                >
                  <PlusCircle size={14} />
                  <span>Publish Signed Emergency Protocol</span>
                </button>
              </div>

              {/* Safe Haven & Shelter Registry */}
              <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-3.5 rounded-full bg-emerald-500 inline-block"></span>
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                      Safe Haven & Shelter Registry
                    </h3>
                  </div>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                  Designate and broadcast verified safe shelters, trauma clinics, or water points to steer evacuated civilians toward safety.
                </p>

                <button
                  onClick={() => setShowSafeHavenModal(true)}
                  className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition"
                >
                  <Building size={14} />
                  <span>Register New Safe Haven / Shelter</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: QDRANT CLOUD & VECTOR SHARDS                                      */}
      {/* ========================================================================= */}
      {activeTab === 'inspector' && (
        <div className="space-y-3">
          {/* TOP CLOUD STATUS KPI ROW */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="stat-card p-3 rounded-2xl border border-slate-800 bg-[#07111e] flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
                    <Zap size={16} />
                  </div>
                  <div>
                    <div className="text-xl font-black text-slate-100 font-mono">{totalPoints}</div>
                    <p className="text-[10px] text-slate-400 font-semibold uppercase">Cloud Vectors</p>
                  </div>
                </div>
                <span title={cloudStatus?.connected ? 'Cloud reachable' : 'Cloud unavailable'} className={`w-2 h-2 rounded-full ${cloudStatus?.connected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-2 pt-1.5 border-t border-slate-800">
                {cloudStatus?.connected ? cloudStatus.counts_verified ? 'Counts verified' : 'Some counts unavailable' : 'Cloud unavailable'}{cloudStatus?.checked_at ? ` · ${formatTime(cloudStatus.checked_at)}` : ''}
              </div>
            </div>

            <div className="stat-card p-3 rounded-2xl border border-slate-800 bg-[#07111e] flex flex-col justify-between">
              <div className="text-[10px] text-slate-400 font-mono uppercase font-bold">Vector Shards</div>
              <div className="grid grid-cols-2 gap-1 mt-1 text-[10px] font-mono">
                <span className="text-amber-400">📖 Guides: <strong>{displayCloudCount(currentShards.rescue_approved_guides)}</strong></span>
                <span className="text-cyan-400">🌐 Public: <strong>{displayCloudCount(currentShards.rescue_public_events)}</strong></span>
                <span className="text-rose-400">🚨 Responders: <strong>{displayCloudCount(currentShards.rescue_responder_events)}</strong></span>
                <span className="text-emerald-400">👥 Group: <strong>{displayCloudCount(currentShards.rescue_group_events)}</strong></span>
              </div>
            </div>

            <div className="stat-card p-3 rounded-2xl border border-slate-800 bg-[#07111e] flex flex-col justify-between">
              <div className="text-[10px] text-slate-400 font-mono uppercase font-bold">1-Tap Cloud Sync</div>
              <button
                onClick={handleCloudMirror}
                disabled={working === 'mirror'}
                className="mt-2 py-1.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
              >
                <RefreshCw size={12} className={working === 'mirror' ? 'animate-spin' : ''} />
                <span>{working === 'mirror' ? 'Syncing...' : 'Mirror to Cloud'}</span>
              </button>
            </div>

            <div className="stat-card p-3 rounded-2xl border border-slate-800 bg-[#07111e] flex flex-col justify-between">
              <div className="text-[10px] text-slate-400 font-mono uppercase font-bold">Database Reset</div>
              <button
                onClick={handleResetDb}
                disabled={working === 'reset'}
                className="mt-2 py-1.5 px-3 rounded-xl bg-rose-950/70 hover:bg-rose-900 text-rose-300 border border-rose-800/80 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
              >
                <Trash2 size={12} />
                <span>{working === 'reset' ? 'Wiping...' : 'Reset All to 0'}</span>
              </button>
            </div>
          </div>

          {(cloudStatus?.reason || cloudStatus?.error || Object.keys(cloudStatus?.count_errors || {}).length > 0) && <p role="alert" className="break-words text-xs text-amber-400">{cloudStatus.reason || cloudStatus.error || Object.values(cloudStatus.count_errors).join(' · ')}</p>}

          {/* MAIN PROVENANCE & FEED GRID */}
          <div className="grid xl:grid-cols-[1.1fr_0.9fr] gap-3 sm:gap-4">
            {/* LEFT: MEMORY FEED */}
            <Card title="Cloud Collection Records">
              <p className="mb-2 text-xs text-slate-400">This list reads the cloud collections counted above. The local report feed has {events.length} record(s); guides and group records are separate.</p>
              <div className="mb-3 flex flex-wrap gap-2">
                <select aria-label="Cloud collection" className="field min-w-0 flex-1" value={cloudCollection} onChange={e => setCloudCollection(e.target.value)}>
                  {CLOUD_COLLECTIONS.map(collection => <option key={collection.name} value={collection.name}>{collection.label} ({displayCloudCount(currentShards[collection.name])})</option>)}
                </select>
                <button className="rounded-xl border border-slate-700 px-3 py-2 text-xs" disabled={cloudLoading} onClick={() => setCloudRefresh(value => value + 1)}>Refresh records</button>
              </div>
              {cloudError && <p role="alert" className="mb-2 break-words text-xs text-amber-400">{cloudError}</p>}
              {cloudLoading && <p role="status" className="mb-2 text-xs text-slate-400">Reading cloud records…</p>}
              {cloudPage && <p className="mb-2 text-xs text-slate-400">Showing {cloudPage.items.length} loaded · Collection count: {displayCloudCount(currentShards[cloudCollection])} · Read {formatTime(cloudPage.checked_at)}</p>}
              {cloudPage && !cloudPage.items.length && <Empty icon={Database}>No records in this cloud collection.</Empty>}
              <div className="max-h-[460px] overflow-y-auto space-y-1.5 pr-1">
                {(cloudPage?.items || []).map((point) => {
                  const ev = point.payload;
                  const isSelected = selectedRecord?.point_id === point.point_id;
                  return (
                    <button
                      key={point.point_id}
                      onClick={() => inspectRecord(point)}
                      className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-cyan-500 bg-cyan-950/40'
                          : 'border-slate-800 bg-[#07111e] hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                        <span className="text-cyan-400 font-bold uppercase">{ev.kind || (cloudCollection === 'rescue_approved_guides' ? 'Guide' : 'Record')} · {ev.visibility || CLOUD_COLLECTIONS.find(c => c.name === cloudCollection)?.label}</span>
                        <span className="text-slate-500">{ev.observed_at ? formatTime(ev.observed_at) : 'Timestamp unavailable'}</span>
                      </div>
                      <p className="text-xs text-slate-200 line-clamp-2">{ev.text || ev.title || ev.summary || ev.id || point.point_id}</p>
                    </button>
                  );
                })}
              </div>
              {cloudPage?.next_offset != null && <button className="mt-3 rounded-xl border border-slate-700 px-3 py-2 text-xs" disabled={cloudLoading} onClick={loadMoreCloud}>Load more cloud records</button>}
            </Card>

            {/* RIGHT: CRYPTOGRAPHIC LINEAGE INSPECTOR */}
            <Card title="Cryptographic Provenance Lineage">
              {selectedRecord ? (
                <div className="space-y-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-[#07111e] border border-slate-800 font-mono text-[11px]">
                    <div className="text-slate-500 text-[10px] mb-0.5">SHA-256 Content Hash:</div>
                    <div className="text-emerald-400 font-bold truncate">{selectedRecord.content_hash || 'Content hash unavailable'}</div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[#07111e] border border-slate-800 text-[11px] font-mono space-y-1">
                    <div className="text-slate-400">Origin Device: <strong className="text-white">{selectedRecord.origin_device || 'Unknown'}</strong></div>
                    <div className="text-slate-400">Authority Verified: <strong className={selectedRecord.verified ? 'text-emerald-400' : 'text-slate-400'}>{selectedRecord.verified ? 'Record marked verified' : 'Not marked verified'}</strong></div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-[#07111e] border border-slate-800 font-mono text-[11px]">
                    <div className="text-slate-400 font-bold mb-1">Multi-Hop Relay Lineage:</div>
                    <div className="border-l-2 border-cyan-500 pl-2 space-y-1">
                      {recordJourney?.hops?.length ? recordJourney.hops.map((hop, index) => <div key={hop.id || index} className="break-words">{hop.from_node} → {hop.to_node}{hop.transport ? ` · ${hop.transport}` : ''}{hop.synced_at ? ` · ${formatTime(hop.synced_at)}` : ''}</div>) : <div className="text-slate-400">{journeyError || 'No confirmed relay receipts available.'}</div>}
                    </div>
                  </div>
                  <details className="rounded-xl border border-slate-800 p-2.5"><summary>Stored cloud payload</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(selectedRecord, null, 2)}</pre></details>
                </div>
              ) : (
                <Empty icon={GitBranch}>Select any record on the left to inspect its cryptographic SHA-256 hash and propagation trail.</Empty>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* MODAL: VERIFY HAZARD */}
      {showHazardVerifyModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-3xl p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-sm">Verify Checkpoint / Compromise Hazard</h3>
              <button onClick={() => setShowHazardVerifyModal(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleVerifyHazard} className="space-y-2.5 text-xs">
              <div>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">Checkpoint ID</label>
                <input
                  className="field w-full mt-1"
                  value={verifyHazardInput.entity_id}
                  onChange={(e) => setVerifyHazardInput({ ...verifyHazardInput, entity_id: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">Operational Status</label>
                <input
                  className="field w-full mt-1"
                  value={verifyHazardInput.status}
                  onChange={(e) => setVerifyHazardInput({ ...verifyHazardInput, status: e.target.value })}
                  placeholder="blocked, danger, flooded"
                  required
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">Reported Severity</label>
                <select className="field w-full mt-1" value={verifyHazardInput.severity} onChange={e => setVerifyHazardInput({ ...verifyHazardInput, severity: e.target.value })} required>
                  <option value="">Select reported severity</option>
                  <option value="red">Red</option><option value="yellow">Yellow</option><option value="green">Green</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">Situation Directives</label>
                <textarea
                  className="field w-full mt-1 min-h-16"
                  value={verifyHazardInput.text}
                  onChange={(e) => setVerifyHazardInput({ ...verifyHazardInput, text: e.target.value })}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={working === 'hazard'}
                className="btn-primary w-full py-2 font-bold text-xs cursor-pointer mt-2"
              >
                {working === 'hazard' ? 'Signing...' : 'Sign & Broadcast Verification'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PUBLISH PROTOCOL */}
      {showProtocolModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-3xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-sm">Publish Signed Emergency Protocol</h3>
              <button onClick={() => setShowProtocolModal(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handlePublishProtocol} className="space-y-2.5 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">Protocol ID</label>
                  <input
                    className="field w-full mt-1"
                    value={protocolInput.id}
                    onChange={(e) => setProtocolInput({ ...protocolInput, id: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">Keywords</label>
                  <input
                    className="field w-full mt-1"
                    value={protocolInput.keywords}
                    onChange={(e) => setProtocolInput({ ...protocolInput, keywords: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">Title</label>
                <input
                  className="field w-full mt-1"
                  value={protocolInput.title}
                  onChange={(e) => setProtocolInput({ ...protocolInput, title: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">Summary</label>
                <textarea
                  className="field w-full mt-1 min-h-14"
                  value={protocolInput.summary}
                  onChange={(e) => setProtocolInput({ ...protocolInput, summary: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">Action Steps (1 per line)</label>
                <textarea
                  className="field w-full mt-1 min-h-16"
                  value={protocolInput.steps}
                  onChange={(e) => setProtocolInput({ ...protocolInput, steps: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">Warnings</label>
                <textarea
                  className="field w-full mt-1 min-h-12"
                  value={protocolInput.warnings}
                  onChange={(e) => setProtocolInput({ ...protocolInput, warnings: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">Source
                  <input className="field w-full mt-1" value={protocolInput.source} onChange={e => setProtocolInput({ ...protocolInput, source: e.target.value })} placeholder="Document or source URL" minLength={2} required />
                </label>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-bold">Reviewer
                  <input className="field w-full mt-1" value={protocolInput.reviewer} onChange={e => setProtocolInput({ ...protocolInput, reviewer: e.target.value })} placeholder="Actual reviewer name" minLength={2} required />
                </label>
              </div>
              <button
                type="submit"
                disabled={working === 'protocol'}
                className="btn-primary w-full py-2 font-bold text-xs cursor-pointer mt-2"
              >
                {working === 'protocol' ? 'Signing...' : 'Sign & Publish to Local Shards'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REGISTER SAFE HAVEN */}
      {showSafeHavenModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="w-full max-w-lg bg-white dark:bg-[#0b1626] border border-emerald-500/30 rounded-3xl p-5 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <Building size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Register Verified Safe Haven
                  </h3>
                  <p className="text-[10px] text-slate-500 font-mono">
                    Broadcast official safe checkpoint to survivor compasses & Edge Memory
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSafeHavenModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRegisterSafeHaven} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Safe Haven / Shelter Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter the actual facility name"
                  value={safeHavenInput.name}
                  onChange={(e) => setSafeHavenInput({ ...safeHavenInput, name: e.target.value })}
                  className="field w-full"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                    Facility Type
                  </label>
                  <select
                    value={safeHavenInput.type}
                    onChange={(e) => setSafeHavenInput({ ...safeHavenInput, type: e.target.value })}
                    className="field w-full"
                  >
                    <option value="Community Shelter">Community Shelter</option>
                    <option value="Primary Clinic">Primary Clinic / Trauma Tent</option>
                    <option value="Clean Water Tanker">Clean Water Tanker</option>
                    <option value="Supply Distribution">Food & Ration Distribution</option>
                    <option value="High Ground Safe Point">High Ground Safe Point</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                    Capacity / Beds
                  </label>
                  <input
                    type="text"
                    placeholder="Enter confirmed capacity, if known"
                    value={safeHavenInput.capacity}
                    onChange={(e) => setSafeHavenInput({ ...safeHavenInput, capacity: e.target.value })}
                    className="field w-full"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Supplies & Capabilities
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {['Water', 'Medical', 'Shelter', 'Food', 'Generator', 'Security'].map((fac) => {
                    const isChecked = safeHavenInput.facilities.includes(fac);
                    return (
                      <button
                        type="button"
                        key={fac}
                        onClick={() => {
                          const updated = isChecked
                            ? safeHavenInput.facilities.filter((f) => f !== fac)
                            : [...safeHavenInput.facilities, fac];
                          setSafeHavenInput({ ...safeHavenInput, facilities: updated });
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
                  placeholder="Enter confirmed operational details"
                  value={safeHavenInput.notes}
                  onChange={(e) => setSafeHavenInput({ ...safeHavenInput, notes: e.target.value })}
                  className="field w-full"
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
                      const pos = await refreshLocation();
                      if (pos) setSafeHavenInput(previous => ({ ...previous, ...pos }));
                    }}
                    className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Crosshair size={11} /> Use Current GPS
                  </button>
                </div>
                {gpsError && <p role="alert" className="mb-2 text-xs text-amber-600 dark:text-amber-400">{gpsError}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[9px] font-mono text-slate-400">LATITUDE</span>
                    <input
                      type="number"
                      step="0.0001"
                      required
                      min="-90" max="90"
                      value={safeHavenInput.lat}
                      onChange={(e) => setSafeHavenInput({ ...safeHavenInput, lat: e.target.value })}
                      className="field w-full font-mono text-xs"
                    />
                  </div>
                  <div>
                    <span className="text-[9px] font-mono text-slate-400">LONGITUDE</span>
                    <input
                      type="number"
                      step="0.0001"
                      required
                      min="-180" max="180"
                      value={safeHavenInput.lon}
                      onChange={(e) => setSafeHavenInput({ ...safeHavenInput, lon: e.target.value })}
                      className="field w-full font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSafeHavenModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={working === 'shelter'}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                >
                  {working === 'shelter' ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Building size={14} />
                  )}
                  <span>{working === 'shelter' ? 'Broadcasting...' : 'Verify & Broadcast Safe Haven'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Shell>
  );
}
