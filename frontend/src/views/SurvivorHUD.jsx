import { useCallback, useEffect, useState } from 'react';
import {
  AlertOctagon,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Cross,
  Droplets,
  ExternalLink,
  Flame,
  LifeBuoy,
  MapPin,
  MessageCircle,
  Navigation,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Users,
  Wifi
} from 'lucide-react';
import {
  api,
  formatTime,
  saveSetting,
  setting,
  onBrainStatusChange,
  onSyncStateChange,
  getDiscoveredPeers,
  updateDeviceLocation,
  syncDiscoveredPeer
} from '../api';
import { Card, Empty, Shell } from '../components';
import MapPanel from '../MapPanel';

const DEFAULT_CENTER = { lat: 28.7041, lon: 77.1025 };
const TABS = [
  ['ask', 'Ask & Triage', MessageCircle],
  ['report', 'Report Incident', ShieldAlert],
  ['map', 'Nearby Map', MapPin],
  ['group', 'Group Relay', Users]
];

const QUICK_PROMPTS = [
  { label: "I can't walk & need help", text: "I can't walk and need help", icon: AlertOctagon, urgent: true },
  { label: "Safe drinking water", text: "Is drinking water safe to drink?", icon: Droplets, urgent: false },
  { label: "Nearest shelter & safe route", text: "Where is the nearest shelter and safe evacuation route?", icon: Navigation, urgent: false },
  { label: "Severe bleeding first aid", text: "How do I stop severe bleeding from an injury?", icon: LifeBuoy, urgent: false }
];

export default function SurvivorHUD() {
  const [tab, setTab] = useState('ask');
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [shareLocation, setShareLocation] = useState(true);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [pin, setPin] = useState(DEFAULT_CENTER);
  const [items, setItems] = useState([]);
  const [peers, setPeers] = useState([]);
  const [selectedPeer, setSelectedPeer] = useState(null);
  const [syncingPeer, setSyncingPeer] = useState(false);
  const [mapUpdatedAt, setMapUpdatedAt] = useState(null);
  const [selected, setSelected] = useState(null);
  const [alternativeRec, setAlternativeRec] = useState(null);
  const [loadingAltRec, setLoadingAltRec] = useState(false);
  const [report, setReport] = useState({
    kind: 'hazard',
    text: '',
    entity_id: '',
    status: 'danger',
    severity: 'yellow',
    visibility: 'public'
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [savingSos, setSavingSos] = useState(false);
  const [sosSuccess, setSosSuccess] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [joinToken, setJoinToken] = useState('');
  const [mapFilter, setMapFilter] = useState('all');
  const [isOfflineBrain, setIsOfflineBrain] = useState(false);
  const [syncInfo, setSyncInfo] = useState({ state: 'idle', pendingCount: 0 });

  const refreshPeers = useCallback(async () => {
    try {
      const res = await getDiscoveredPeers();
      if (res?.peers) {
        setPeers(res.peers);
      }
    } catch {
      // offline silent
    }
  }, []);

  useEffect(() => {
    const unsubBrain = onBrainStatusChange(setIsOfflineBrain);
    const unsubSync = onSyncStateChange(setSyncInfo);
    refreshPeers();
    const peerTimer = setInterval(refreshPeers, 6000);
    return () => {
      unsubBrain();
      unsubSync();
      clearInterval(peerTimer);
    };
  }, [refreshPeers]);

  const refreshMap = useCallback(async () => {
    try {
      const groupId = setting('groupId');
      const result = await api('/api/map/nearby', {
        method: 'POST',
        group: Boolean(groupId),
        body: {
          location: center,
          radius_m: 5000,
          ...(groupId ? { group_id: groupId } : {})
        }
      });
      setItems(result.items);
      setMapUpdatedAt(new Date());
    } catch (err) {
      setError(err.message);
    }
  }, [center]);

  useEffect(() => {
    refreshMap();
    const timer = setInterval(refreshMap, 30000);
    return () => clearInterval(timer);
  }, [refreshMap]);

  const handleSelectObservation = async (item) => {
    setSelected(item);
    setAlternativeRec(null);
    if (!item) return;
    const targetId = item.entity_id || (item.kind === 'checkpoint' ? item.id : null);
    if (targetId) {
      try {
        setLoadingAltRec(true);
        const entityData = await api(`/api/entities/${encodeURIComponent(targetId)}`);
        if (entityData?.alternative_recommendation) {
          setAlternativeRec(entityData.alternative_recommendation);
        } else if (item.status === 'danger' || item.status === 'blocked' || item.status === 'flooded') {
          const recData = await api('/api/checkpoints/recommend-alternative', {
            method: 'POST',
            body: { compromised_id: targetId, avoid_hazard: item.text || 'flooded hazard' }
          });
          if (recData?.recommended) {
            setAlternativeRec(recData.recommended);
          }
        }
      } catch (err) {
        console.error('Failed to load alternative recommendation:', err);
      } finally {
        setLoadingAltRec(false);
      }
    } else if (item.status === 'danger' || item.status === 'blocked' || item.status === 'flooded') {
      try {
        setLoadingAltRec(true);
        const recData = await api('/api/checkpoints/recommend-alternative', {
          method: 'POST',
          body: { compromised_id: 'cp_17', avoid_hazard: item.text || 'flooded hazard' }
        });
        if (recData?.recommended) {
          setAlternativeRec(recData.recommended);
        }
      } catch (err) {
      } finally {
        setLoadingAltRec(false);
      }
    }
  };

  const useGps = () => {
    if (!navigator.geolocation) {
      setError('GPS is unavailable in this browser. Tap the map to place a pin.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = { lat: position.coords.latitude, lon: position.coords.longitude };
        setCenter(location);
        setPin(location);
        setError('');
        setMessage('Updated your location to current GPS coordinates.');
        // Broadcast our updated GPS coordinates to nearby nodes over offline Wi-Fi
        updateDeviceLocation({
          lat: location.lat,
          lon: location.lon,
          status: 'survivor_active'
        }).catch(() => {});
      },
      () => setError('Location permission or secure HTTPS is required. Tap the map instead to set your location.'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSyncPeer = async (peer) => {
    setSyncingPeer(true);
    setMessage('');
    setError('');
    try {
      await syncDiscoveredPeer({
        peer_url: peer.url,
        scope: 'public'
      });
      setMessage(`Successfully synchronized memory with ${peer.node_id}!`);
      refreshMap();
      refreshPeers();
    } catch (err) {
      setError(`Sync with ${peer.node_id} failed: ${err.message}`);
    } finally {
      setSyncingPeer(false);
    }
  };

  const askQuestion = async (queryText = text) => {
    if (!queryText.trim()) return;
    setError('');
    setMessage('');
    setSosSuccess(false);
    setChatBusy(true);
    try {
      const groupId = setting('groupId');
      const result = await api('/api/chat', {
        method: 'POST',
        group: Boolean(groupId),
        body: {
          text: queryText,
          use_ai: useAi,
          survivor_id: setting('reporterId') || 'survivor-1',
          share_location: shareLocation,
          ...(shareLocation ? { location: pin } : {}),
          ...(groupId ? { group_id: groupId } : {})
        }
      });
      setAnswer(result);
      if (shareLocation) refreshMap();
    } catch (err) {
      setError(err.message);
    } finally {
      setChatBusy(false);
    }
  };

  const onFormSubmit = (event) => {
    event.preventDefault();
    askQuestion(text);
  };

  const handleQuickPrompt = (promptText) => {
    setText(promptText);
    askQuestion(promptText);
  };

  // 1-Tap Save to Local Database for Emergency SOS
  const saveSosToLocalDatabase = async (customText = null) => {
    setSavingSos(true);
    setError('');
    try {
      const sosText = customText || (answer?.suggested_action?.auto_report?.text || text || "Survivor cannot walk and requests immediate rescue assistance.");
      const result = await api('/api/reports', {
        method: 'POST',
        body: {
          kind: 'incident',
          visibility: 'responders',
          severity: 'red',
          status: 'needs_help',
          text: sosText.trim(),
          reporter_id: setting('reporterId') || 'survivor-1',
          location: pin,
          entity_id: null,
          group_id: null
        }
      });
      setSosSuccess(true);
      const evtId = (result.event?.id || result.event_id || 'saved').slice(0, 12);
      setMessage(`Emergency SOS successfully saved to local database (ID: ${evtId}…). Nearby responder nodes will receive this during local peer exchange.`);
      refreshMap();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSos(false);
    }
  };

  const followAction = (action) => {
    if (action.kind === 'sos') {
      setReport({
        kind: 'incident',
        text: action.prefill || text || '',
        entity_id: '',
        status: 'needs_help',
        severity: 'red',
        visibility: 'responders'
      });
      setTab('report');
      setMessage('Review your SOS report, confirm the location pin, and save to local memory.');
    } else if (action.kind === 'report') {
      setReport({
        kind: 'hazard',
        text: action.prefill || text || '',
        entity_id: '',
        status: 'reported',
        severity: 'yellow',
        visibility: 'public'
      });
      setTab('report');
      setMessage('Review and edit this observation before saving it to local memory.');
    } else if (action.kind === 'map') {
      setTab('map');
      refreshMap();
    }
  };

  const submitReport = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const groupId = setting('groupId');
      const visibility = report.kind === 'incident' ? 'responders' : report.visibility;
      const result = await api('/api/reports', {
        method: 'POST',
        group: visibility === 'group',
        body: {
          ...report,
          visibility,
          text: report.text.trim(),
          reporter_id: setting('reporterId') || 'survivor-1',
          location: pin,
          entity_id: report.entity_id.trim() || null,
          group_id: visibility === 'group' ? groupId : null
        }
      });
      const evtId = (result.event?.id || result.event_id || 'saved').slice(0, 12);
      setMessage(result.duplicate
        ? 'This observation is already stored in local memory.'
        : `Saved to local memory (ID: ${evtId}…).`);
      setReport({ ...report, text: '' });
      refreshMap();
    } catch (err) {
      setError(err.message);
    }
  };

  const createGroup = async () => {
    try {
      const result = await api('/api/groups', { method: 'POST', body: { name: groupName } });
      saveSetting('groupId', result.group_id);
      saveSetting('groupToken', result.token);
      setMessage(`Group created. Share ID ${result.group_id} and its token privately with members.`);
    } catch (err) {
      setError(err.message);
    }
  };

  const joinGroup = async () => {
    try {
      await api('/api/groups/join', {
        method: 'POST',
        body: { group_id: joinId, name: groupName || joinId, token: joinToken }
      });
      saveSetting('groupId', joinId);
      saveSetting('groupToken', joinToken);
      setMessage(`Joined group ${joinId}.`);
      refreshMap();
    } catch (err) {
      setError(err.message);
    }
  };

  const filteredItems = items.filter((item) => {
    if (mapFilter === 'all') return true;
    if (mapFilter === 'sos') return item.kind === 'incident' || item.kind === 'presence';
    if (mapFilter === 'hazard') return item.kind === 'hazard' || item.kind === 'checkpoint';
    if (mapFilter === 'resource') return item.kind === 'resource';
    return true;
  });

  return (
    <Shell
      title="Disaster Assistance & Local Memory"
      subtitle="Ask for guidance or report observations. Operates completely offline using Qdrant Edge in-process memory."
    >
      {/* Navigation Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        {TABS.map(([id, label, Icon]) => {
          const isActive = tab === id;
          return (
            <button
              key={id}
              onClick={() => { setTab(id); setError(''); setMessage(''); }}
              className={`rounded-xl border px-3 py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                isActive
                  ? 'bg-red-500/20 border-red-500 text-red-500 shadow-sm'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              <Icon size={17} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Brain Connectivity & Outbox Status Indicator */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          {isOfflineBrain ? (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
              </span>
              <span className="text-xs font-semibold text-amber-300">
                Standalone Phone Brain Active
              </span>
              <span className="text-xs text-slate-400 hidden sm:inline">
                • 100% On-Device Vector Engine (Zero Net / No Server Needed)
              </span>
            </>
          ) : (
            <>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-semibold text-emerald-400">
                Connected to Field Hub
              </span>
              <span className="text-xs text-slate-400 hidden sm:inline">
                • Qdrant Edge Node & Peer Relay Active
              </span>
            </>
          )}
        </div>

        {syncInfo.pendingCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
            <RefreshCw size={12} className={syncInfo.state === 'syncing' ? 'animate-spin' : ''} />
            <span>
              {syncInfo.state === 'syncing' ? 'Auto-syncing to Hub...' : `${syncInfo.pendingCount} report(s) in offline outbox`}
            </span>
          </div>
        )}
      </div>

      {/* Global Status & Alerts */}
      {error && (
        <div role="alert" className="mb-5 p-4 rounded-xl border border-red-800 bg-red-950/40 text-red-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TriangleAlert size={18} className="shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError('')} className="text-xs text-red-300 hover:underline">Dismiss</button>
        </div>
      )}
      {message && (
        <div role="status" className="mb-5 p-4 rounded-xl border border-emerald-800 bg-emerald-950/40 text-emerald-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />
            <span>{message}</span>
          </div>
          <button onClick={() => setMessage('')} className="text-xs text-emerald-300 hover:underline">Dismiss</button>
        </div>
      )}

      {/* TAB 1: ASK & TRIAGE */}
      {tab === 'ask' && (
        <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-5">
          <Card title="Ask Local Memory or Report Distress">
            <form onSubmit={onFormSubmit} className="space-y-4">
              <div className="relative">
                <textarea
                  className="field min-h-32 text-base leading-relaxed pr-10"
                  placeholder="Ask in your own words... e.g. 'I can't walk and need help', 'Where is safe water?', 'Is north shelter open?'"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  required
                  minLength={2}
                />
              </div>

              {/* Quick Prompt Pills */}
              <div>
                <p className="text-xs text-slate-400 font-medium mb-2">Suggested quick prompts:</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_PROMPTS.map((q) => {
                    const Icon = q.icon;
                    return (
                      <button
                        type="button"
                        key={q.text}
                        onClick={() => handleQuickPrompt(q.text)}
                        className={`text-xs py-1.5 px-3 rounded-lg border flex items-center gap-1.5 font-medium transition-all ${
                          q.urgent
                            ? 'border-red-800/80 bg-red-950/30 text-red-300 hover:bg-red-900/40 hover:border-red-600'
                            : 'btn-secondary'
                        }`}
                      >
                        <Icon size={13} className={q.urgent ? 'text-red-400' : 'text-cyan-400'} />
                        {q.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Context Strip: Location & Optional AI Enhancement */}
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <MapPin size={15} className="text-cyan-400 shrink-0" />
                  <span>Pin: {pin.lat.toFixed(4)}, {pin.lon.toFixed(4)}</span>
                  <button type="button" onClick={useGps} className="text-cyan-300 hover:underline flex items-center gap-1 ml-1">
                    <Cross size={13} /> GPS
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shareLocation}
                      onChange={(e) => setShareLocation(e.target.checked)}
                      className="rounded"
                    />
                    <span>Attach Location</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer" title="Enable optional Gemini generation if online and API key configured">
                    <input
                      type="checkbox"
                      checked={useAi}
                      onChange={(e) => setUseAi(e.target.checked)}
                      className="rounded"
                    />
                    <span className="flex items-center gap-1">
                      <Sparkles size={13} className="text-cyan-400" /> Cloud AI
                    </span>
                  </label>
                </div>
              </div>

              {/* Submit Button */}
              <button
                disabled={chatBusy}
                className="btn-primary w-full flex items-center justify-center gap-2 text-base py-3"
              >
                {chatBusy ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    <span>Searching Qdrant Edge Memory…</span>
                  </>
                ) : (
                  <>
                    <span>{useAi ? 'Search Local Memory & Synthesize' : 'Search Offline Local Memory'}</span>
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          </Card>

          {/* Right Column: Answers, Guidance, and Emergency Action Cards */}
          <div className="space-y-4">
            {!answer && (
              <Card title="Offline Knowledge & Evidence">
                <Empty>
                  Ask a question or select a prompt to retrieve guidance protocols and local field reports from this node.
                </Empty>
              </Card>
            )}

            {answer && (
              <>
                {/* 1. URGENT SOS ACTION CARD: Appears when user says 'can't walk' or indicates distress */}
                {answer.suggested_action?.kind === 'sos' && (
                  <div className="rounded-2xl border-2 border-red-500 bg-red-950/40 p-5 shadow-lg shadow-red-950/20">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-xl bg-red-500 text-white shrink-0 mt-0.5 animate-pulse">
                        <AlertOctagon size={24} />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-red-200">
                          Emergency SOS: Mobility Assistance Detected
                        </h3>
                        <p className="text-sm text-red-300/90 mt-1 leading-relaxed">
                          You reported being unable to walk or in distress. You can immediately broadcast your SOS to nearby responders and save this incident to the local database.
                        </p>
                      </div>
                    </div>

                    {/* Quick 1-Tap Action Buttons */}
                    <div className="mt-4 space-y-2.5">
                      <button
                        onClick={() => saveSosToLocalDatabase()}
                        disabled={savingSos || sosSuccess}
                        className={`w-full py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 text-sm transition-all ${
                          sosSuccess
                            ? 'bg-emerald-600 text-white cursor-default'
                            : 'bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-950/50'
                        }`}
                      >
                        {savingSos ? (
                          <>
                            <RefreshCw size={17} className="animate-spin" />
                            <span>Saving to Local Database…</span>
                          </>
                        ) : sosSuccess ? (
                          <>
                            <CheckCircle2 size={17} />
                            <span>Logged to Local Database & Responders</span>
                          </>
                        ) : (
                          <>
                            <Send size={17} />
                            <span>1-Tap Save to Local Database & Alert Responders</span>
                          </>
                        )}
                      </button>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => { setTab('map'); refreshMap(); }}
                          className="btn-secondary text-xs flex items-center justify-center gap-1.5"
                        >
                          <MapPin size={14} className="text-cyan-400" />
                          <span>Show Shelters on Map</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => followAction(answer.suggested_action)}
                          className="btn-secondary text-xs flex items-center justify-center gap-1.5"
                        >
                          <ShieldAlert size={14} className="text-amber-400" />
                          <span>Customize SOS Form</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. MAP SUGGESTION ACTION CARD */}
                {answer.suggested_action?.kind === 'map' && (
                  <div className="rounded-2xl border border-cyan-600 bg-cyan-950/30 p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Navigation size={22} className="text-cyan-400 shrink-0" />
                      <div>
                        <h4 className="font-semibold text-cyan-200 text-sm">Relevant Locations Found Nearby</h4>
                        <p className="text-xs text-slate-300 mt-0.5">Checkpoints, shelters, and water points are stored in local memory.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setTab('map'); refreshMap(); }}
                      className="btn-primary text-xs px-3 py-2 shrink-0 flex items-center gap-1"
                    >
                      <span>Open Map</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>
                )}

                {/* 3. REPORT SUGGESTION ACTION CARD */}
                {answer.suggested_action?.kind === 'report' && (
                  <div className="rounded-2xl border border-amber-600 bg-amber-950/30 p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <ShieldAlert size={22} className="text-amber-400 shrink-0" />
                      <div>
                        <h4 className="font-semibold text-amber-200 text-sm">Field Hazard or Resource Observed</h4>
                        <p className="text-xs text-slate-300 mt-0.5">Share this observation with nearby peer nodes.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => followAction(answer.suggested_action)}
                      className="btn-secondary text-xs px-3 py-2 shrink-0 flex items-center gap-1"
                    >
                      <span>Review Report</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>
                )}

                {/* 4. PRIMARY ANSWER CARD: Local Offline RAG or Cloud AI */}
                <Card title="Grounded Response">
                  {answer.ai_answer && (
                    <div className="rounded-xl border border-cyan-700 bg-cyan-950/30 p-4 mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs uppercase tracking-wider text-cyan-300 font-bold flex items-center gap-1">
                          <Sparkles size={14} /> Cloud AI Synthesis
                        </span>
                        <span className="text-[10px] bg-cyan-900/60 text-cyan-200 px-2 py-0.5 rounded">Grounded in local evidence</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{answer.ai_answer}</p>
                    </div>
                  )}

                  {/* Local Offline RAG Answer */}
                  <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs uppercase tracking-wider text-cyan-300 font-bold flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
                        {answer.ai_answer ? 'Local Edge Evidence Summary' : 'Offline Edge RAG Answer'}
                      </span>
                      <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                        Qdrant Edge
                      </span>
                    </div>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed text-slate-200 space-y-2">
                      {answer.local_answer}
                    </div>
                  </div>

                  {/* Status indicators */}
                  {answer.ai_status === 'unavailable' && (
                    <p role="status" className="text-xs text-amber-300 mt-2">
                      Cloud AI is temporarily unreachable. Answering completely from local Qdrant Edge memory.
                    </p>
                  )}
                  {answer.ai_status === 'not_configured' && (
                    <p role="status" className="text-xs text-slate-400 mt-2">
                      Operating in 100% offline local model mode (no external keys required).
                    </p>
                  )}

                  {/* Retrieved Evidence & Guides Accordion */}
                  <details className="rounded-xl border border-slate-700 p-3 mt-4 group">
                    <summary className="cursor-pointer font-semibold text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <BookOpen size={16} className="text-cyan-400" />
                        <span>Retrieved Reference Guides & Local Reports ({answer.cards?.length || 0} guides, {answer.memory_hits?.length || 0} reports)</span>
                      </span>
                      <span className="text-xs text-slate-400 group-open:rotate-180 transition-transform">▼</span>
                    </summary>

                    <div className="space-y-3 mt-3 pt-3 border-t border-slate-800">
                      {answer.cards?.length ? (
                        answer.cards.slice(0, 3).map((card, index) => (
                          <div key={card.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                            <div className="flex items-start gap-2">
                              <BookOpen size={16} className="text-cyan-400 shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <div className="flex items-center justify-between">
                                  <h4 className="font-semibold text-sm text-slate-100">[G{index + 1}] {card.title}</h4>
                                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                                    {card.review_status === 'team_reviewed' ? `Reviewed · v${card.version}` : 'Prototype card'}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-300 mt-2 leading-relaxed">{card.summary}</p>
                                {card.steps?.length > 0 && (
                                  <ol className="list-decimal pl-4 text-xs text-slate-300 mt-2 space-y-1">
                                    {card.steps.map((step, idx) => <li key={idx}>{step}</li>)}
                                  </ol>
                                )}
                                {card.warnings?.length > 0 && (
                                  <p className="text-xs text-amber-300 mt-2 flex items-start gap-1">
                                    <TriangleAlert size={13} className="shrink-0 mt-0.5" />
                                    <span>{card.warnings.join(' ')}</span>
                                  </p>
                                )}
                                {card.source && (
                                  <a
                                    href={card.source}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[11px] text-cyan-400 hover:underline mt-2 inline-flex items-center gap-1"
                                  >
                                    <span>Official source guidance</span>
                                    <ExternalLink size={11} />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-slate-400">No matching static reference guides.</p>
                      )}

                      {answer.memory_hits?.length > 0 && (
                        <div className="pt-2">
                          <h5 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Nearby Observations</h5>
                          <div className="space-y-2">
                            {answer.memory_hits.map((hit) => (
                              <div key={hit.id} className="text-xs p-3 rounded-lg border-l-2 border-cyan-500 bg-slate-900">
                                <p className="text-slate-200 font-medium">{hit.text}</p>
                                <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2">
                                  <span className="capitalize">{hit.kind}</span>
                                  <span>•</span>
                                  <span>{formatTime(hit.observed_at)}</span>
                                  <span>•</span>
                                  <span>From: {hit.origin_device}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: REPORT INCIDENT */}
      {tab === 'report' && (
        <div className="grid lg:grid-cols-[.9fr_1.1fr] gap-5">
          <Card title="Record an Observation">
            <form onSubmit={submitReport} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 font-medium mb-1.5">Observation Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['hazard', 'Hazard', TriangleAlert, 'yellow'],
                    ['resource', 'Resource', Droplets, 'green'],
                    ['checkpoint', 'Checkpoint', Navigation, 'blue'],
                    ['incident', 'Medical / SOS', AlertOctagon, 'red']
                  ].map(([k, label, Icon]) => {
                    const isSelected = report.kind === k;
                    return (
                      <button
                        type="button"
                        key={k}
                        onClick={() => {
                          setReport({
                            ...report,
                            kind: k,
                            visibility: k === 'incident' ? 'responders' : 'public',
                            severity: k === 'incident' ? 'red' : 'yellow'
                          });
                        }}
                        className={`p-3 rounded-xl border flex items-center gap-2 text-sm font-semibold transition-all ${
                          isSelected
                            ? 'border-red-500 bg-red-500/20 text-red-400'
                            : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <Icon size={16} />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {report.kind === 'incident' && (
                <div className="p-3 rounded-xl bg-red-950/40 border border-red-800 text-xs text-red-200 flex items-center gap-2">
                  <ShieldAlert size={16} className="shrink-0 text-red-400" />
                  <span>Medical SOS is private by default and relayed exclusively to authorized responder nodes.</span>
                </div>
              )}

              <label className="block text-sm text-slate-300 font-medium">
                Description
                <textarea
                  className="field mt-1 min-h-28"
                  value={report.text}
                  onChange={(event) => setReport({ ...report, text: event.target.value })}
                  required
                  minLength={3}
                  placeholder={
                    report.kind === 'incident'
                      ? "Describe injuries or situation (e.g. 'Cannot walk, suspected broken leg, need stretcher')"
                      : "Describe what you directly observed (e.g. 'Road blocked by 3 feet of water at Gate 3')"
                  }
                />
              </label>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-sm text-slate-300 font-medium">
                  Severity
                  <select
                    className="field mt-1"
                    value={report.severity}
                    onChange={(event) => setReport({ ...report, severity: event.target.value })}
                  >
                    <option value="yellow">Attention Required</option>
                    <option value="red">Urgent / Life Threat</option>
                    <option value="green">Informational</option>
                  </select>
                </label>

                <label className="text-sm text-slate-300 font-medium">
                  Visibility Scope
                  <select
                    disabled={report.kind === 'incident'}
                    className="field mt-1"
                    value={report.kind === 'incident' ? 'responders' : report.visibility}
                    onChange={(event) => setReport({ ...report, visibility: event.target.value })}
                  >
                    <option value="public">Public (All nearby nodes)</option>
                    <option value="group">My Group Only</option>
                    <option value="responders">Responders Only</option>
                  </select>
                </label>
              </div>

              <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 text-xs text-slate-300 flex items-center justify-between">
                <span>Coordinates: {pin.lat.toFixed(5)}, {pin.lon.toFixed(5)}</span>
                <button type="button" onClick={useGps} className="text-cyan-300 hover:underline flex items-center gap-1 font-semibold">
                  <Cross size={14} /> My GPS
                </button>
              </div>

              <button className="btn-primary w-full py-3 flex items-center justify-center gap-2">
                <span>Save to Local Memory</span>
                <ArrowRight size={17} />
              </button>
            </form>
          </Card>

          <Card title="Place Location Pin on Map">
            <div className="flex justify-between items-center mb-3">
              <p className="text-xs text-slate-400">Tap anywhere on the grid to adjust the report coordinates.</p>
              <button className="text-xs text-cyan-300 hover:underline flex items-center gap-1" onClick={useGps}>
                <Cross size={14} /> Use GPS
              </button>
            </div>
            <MapPanel
              center={center}
              items={items}
              peers={peers}
              selected={pin}
              selectedPeer={selectedPeer}
              onSelect={setPin}
              onMarker={handleSelectObservation}
              onSelectPeer={setSelectedPeer}
            />
          </Card>
        </div>
      )}

      {/* TAB 3: NEARBY MAP */}
      {tab === 'map' && (
        <div className="grid lg:grid-cols-[1.3fr_.7fr] gap-5">
          <Card title="Nearby Local Observations & Mesh Radar">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['all', 'All'],
                  ['sos', 'SOS / Incidents'],
                  ['hazard', 'Hazards'],
                  ['resource', 'Resources']
                ].map(([f, label]) => (
                  <button
                    key={f}
                    onClick={() => setMapFilter(f)}
                    className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-all ${
                      mapFilter === f
                        ? 'border-cyan-500 bg-cyan-950/60 text-cyan-200'
                        : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={useGps} className="text-xs text-cyan-300 flex items-center gap-1 hover:underline">
                  <Cross size={13} /> GPS
                </button>
                <button onClick={refreshMap} className="text-xs text-cyan-300 flex items-center gap-1 hover:underline">
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-400 mb-2">
              Showing {filteredItems.length} reports within 5 km • {peers.length} peer node{peers.length === 1 ? '' : 's'} in Wi-Fi range
              {mapUpdatedAt ? ` • Updated ${mapUpdatedAt.toLocaleTimeString()}` : ''}
            </p>

            <MapPanel
              center={center}
              items={filteredItems}
              peers={peers}
              selectedPeer={selectedPeer}
              onMarker={handleSelectObservation}
              onSelectPeer={setSelectedPeer}
            />
          </Card>

          <div className="space-y-4">
            {/* Offline Wi-Fi Mesh Radar Widget */}
            <Card title="Wi-Fi Mesh Radar">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                  <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wide flex items-center gap-1">
                    <Radio size={13} /> {peers.length} Peer{peers.length === 1 ? '' : 's'} Detected
                  </span>
                </div>
                <button onClick={refreshPeers} className="text-xs text-cyan-400 hover:underline flex items-center gap-1">
                  <RefreshCw size={11} /> Scan
                </button>
              </div>

              {peers.length ? (
                <div className="space-y-2 max-h-[220px] overflow-auto pr-1">
                  {peers.map((peer) => {
                    const isVol = peer.role === 'volunteer' || peer.role === 'central';
                    const isSel = selectedPeer?.node_id === peer.node_id;
                    return (
                      <div
                        key={peer.node_id}
                        onClick={() => setSelectedPeer(peer)}
                        className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                          isSel ? 'border-cyan-500 bg-cyan-950/40' : 'border-slate-800 bg-slate-900/90 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-bold text-slate-100">
                            <span className={`w-2 h-2 rounded-full ${peer.is_online ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                            <span>{peer.node_id}</span>
                          </div>
                          <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                            isVol ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60' : 'bg-amber-950/80 text-amber-300 border border-amber-700/60'
                          }`}>
                            {peer.role}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between font-mono">
                          <span className="text-cyan-400 font-semibold">
                            {peer.distance_m != null ? `~${peer.distance_m} m away` : 'On Wi-Fi Hotspot'}
                          </span>
                          <span>{peer.seconds_ago}s ago</span>
                        </div>
                        <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-slate-800/70">
                          <span className="text-[10px] text-slate-500 font-mono">{peer.ip}:{peer.port}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSyncPeer(peer);
                            }}
                            disabled={syncingPeer}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] flex items-center gap-1 transition-all disabled:opacity-50"
                          >
                            <Wifi size={12} />
                            <span>Sync</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-400 leading-relaxed">
                  Broadcasting your location on local Wi-Fi. Other phones running RescueMemory on this hotspot will automatically appear here.
                </p>
              )}
            </Card>

            <Card title="Observation List">
            {filteredItems.length ? (
              <div className="max-h-[520px] overflow-auto space-y-2 pr-1">
                {filteredItems.map((item) => {
                  const isSos = item.kind === 'incident' || item.kind === 'presence';
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelectObservation(item)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                        selected?.id === item.id
                          ? 'border-cyan-500 bg-cyan-950/30'
                          : 'border-slate-800 bg-slate-900 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold capitalize">
                          {isSos ? (
                            <AlertOctagon size={15} className="text-red-400" />
                          ) : item.kind === 'resource' ? (
                            <Droplets size={15} className="text-emerald-400" />
                          ) : (
                            <TriangleAlert size={15} className="text-amber-400" />
                          )}
                          <span>{item.kind}</span>
                        </div>
                        <span className="text-[11px] text-cyan-400 font-mono">{item.distance_m} m away</span>
                      </div>
                      <p className="text-xs text-slate-200 mt-1.5 leading-relaxed">{item.text}</p>
                      <div className="text-[10px] text-slate-400 mt-2 flex items-center justify-between">
                        <span>{formatTime(item.observed_at)}</span>
                        <span>Node: {item.origin_device}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Empty>No nearby local reports recorded yet in this scope.</Empty>
            )}
          </Card>
        </div>

          {selected && (
            <Card title="Selected Observation Details" className="lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2 mb-2">
                <span className="text-xs font-bold uppercase text-cyan-400">{selected.kind} Observation</span>
                <span className="text-xs text-slate-400 font-mono">ID: {selected.id}</span>
              </div>
              <p className="text-slate-100 text-sm leading-relaxed">{selected.text}</p>
              <div className="text-xs text-slate-400 mt-3 flex flex-wrap gap-4">
                <span>Observed: {formatTime(selected.observed_at)}</span>
                <span>Scope: {selected.visibility}</span>
                <span>Origin: {selected.origin_device}</span>
                {selected.distance_m && <span>Distance: ~{selected.distance_m} meters</span>}
              </div>

              {loadingAltRec && (
                <div className="text-xs text-cyan-400 mt-3 flex items-center gap-1.5 animate-pulse bg-cyan-950/30 p-2.5 rounded-lg border border-cyan-800/40">
                  <RefreshCw size={13} className="animate-spin" /> Querying Qdrant vector memory for alternative safe facility...
                </div>
              )}

              {alternativeRec && (
                <div className="mt-4 p-4 rounded-xl border border-emerald-500/50 bg-emerald-950/40 text-emerald-200 shadow-lg shadow-emerald-950/20">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 size={15} /> ⚡ Qdrant Recommended Safe Alternative
                    </span>
                    {alternativeRec.score && (
                      <span className="text-[10px] font-mono bg-emerald-900/80 border border-emerald-700/60 px-2 py-0.5 rounded text-emerald-300">
                        Score: {alternativeRec.score}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-bold text-white mt-1.5">
                    {alternativeRec.name}
                  </div>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    {alternativeRec.rationale}
                  </p>
                  {alternativeRec.facilities?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {alternativeRec.facilities.map((fac) => (
                        <span key={fac} className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/80 border border-emerald-700/60 text-emerald-200 font-mono">
                          ✓ {fac.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* TAB 4: GROUP RELAY */}
      {tab === 'group' && (
        <div className="grid md:grid-cols-2 gap-5">
          <Card title="Create a Local Group">
            <p className="text-xs text-slate-400 mb-3">Group reports move only between nodes possessing the same private token.</p>
            <input
              className="field mb-3"
              placeholder="e.g. Camp Alpha, Medical Tent 2"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
            />
            <button onClick={createGroup} disabled={!groupName.trim()} className="btn-primary w-full">
              Create New Group
            </button>
          </Card>

          <Card title="Join an Existing Group">
            <div className="space-y-3">
              <input
                className="field"
                placeholder="Group ID"
                value={joinId}
                onChange={(event) => setJoinId(event.target.value)}
              />
              <input
                className="field"
                type="password"
                placeholder="Private Group Token"
                value={joinToken}
                onChange={(event) => setJoinToken(event.target.value)}
              />
              <button onClick={joinGroup} disabled={!joinId || !joinToken} className="btn-secondary w-full">
                Join Group
              </button>
            </div>
          </Card>

          <Card title="Active Group Scope" className="md:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-200">
                  {setting('groupId') ? `Connected to Group ID: ${setting('groupId')}` : 'No group active'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {setting('groupId')
                    ? 'Group-scoped reports and map pins will be synchronized with members.'
                    : 'Configure a group above to filter observations to your specific team.'}
                </p>
              </div>
              {setting('groupId') && (
                <button
                  onClick={() => {
                    saveSetting('groupId', '');
                    saveSetting('groupToken', '');
                    setMessage('Disconnected from group.');
                    refreshMap();
                  }}
                  className="btn-secondary text-xs"
                >
                  Leave Group
                </button>
              )}
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}
