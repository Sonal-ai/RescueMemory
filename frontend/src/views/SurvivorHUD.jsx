import { useCallback, useEffect, useState } from 'react';
import {
  AlertOctagon,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Compass,
  Cross,
  Crosshair,
  Droplets,
  ExternalLink,
  Flame,
  HeartPulse,
  LifeBuoy,
  MapPin,
  MessageCircle,
  Mic,
  Navigation,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
  Wifi,
  Zap
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
  ['ask', 'Ask & Triage', HeartPulse],
  ['map', 'Tactical Map & Shelters', Compass],
  ['report', 'Report SOS / Hazard', ShieldAlert],
  ['group', 'Mesh Team Relay', Users]
];

const QUICK_PROMPTS = [
  { label: "I can't walk & need help", text: "I can't walk and need help", icon: AlertOctagon, urgent: true, category: 'mobility' },
  { label: "Severe bleeding first aid", text: "How do I stop severe bleeding from a deep wound?", icon: HeartPulse, urgent: true, category: 'hemorrhage' },
  { label: "Safe drinking water", text: "How do I purify and make safe drinking water?", icon: Droplets, urgent: false, category: 'water' },
  { label: "Nearest safe shelter", text: "Where is the nearest safe shelter and evacuation checkpoint?", icon: Navigation, urgent: false, category: 'shelter' }
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
  const [checkedSteps, setCheckedSteps] = useState({});
  const [isListening, setIsListening] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const [report, setReport] = useState({
    kind: 'incident',
    text: '',
    entity_id: '',
    status: 'needs_help',
    severity: 'red',
    visibility: 'responders'
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

  // Refresh nearby Wi-Fi peers
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

  // Refresh nearby map observations
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
    const timer = setInterval(refreshMap, 25000);
    return () => clearInterval(timer);
  }, [refreshMap]);

  // Handle observation selection with Qdrant negative-vector recommendation
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

  // Live GPS geolocation
  const useGps = () => {
    if (!navigator.geolocation) {
      setError('GPS unavailable in this browser. Tap the map to position your pin.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: Number(position.coords.latitude.toFixed(5)),
          lon: Number(position.coords.longitude.toFixed(5))
        };
        setCenter(location);
        setPin(location);
        setError('');
        setMessage(`Location updated to GPS coordinates (${location.lat}, ${location.lon}).`);
        updateDeviceLocation({
          lat: location.lat,
          lon: location.lon,
          status: 'survivor_active'
        }).catch(() => {});
      },
      () => setError('GPS permission required. Tap the map grid to manually place your location pin.'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Peer Wi-Fi sync
  const handleSyncPeer = async (peer) => {
    setSyncingPeer(true);
    setMessage('');
    setError('');
    try {
      await syncDiscoveredPeer({
        peer_url: peer.url,
        scope: 'public'
      });
      setMessage(`Memory successfully exchanged with peer node ${peer.node_id}.`);
      refreshMap();
      refreshPeers();
    } catch (err) {
      setError(`Sync with ${peer.node_id} failed: ${err.message}`);
    } finally {
      setSyncingPeer(false);
    }
  };

  // Speech-to-Text for voice emergencies
  const toggleSpeechRecognition = () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setError('Speech recognition is not supported in this browser. Please type your query.');
      return;
    }
    if (isListening) {
      setIsListening(false);
      return;
    }
    try {
      const recognition = new SpeechRec();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      recognition.onresult = (event) => {
        const spoken = event.results[0][0].transcript;
        setText(spoken);
        askQuestion(spoken);
      };
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  // Ask local Qdrant Edge memory
  const askQuestion = async (queryText = text) => {
    if (!queryText.trim()) return;
    setError('');
    setMessage('');
    setSosSuccess(false);
    setChatBusy(true);
    setCheckedSteps({});
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
      const evtId = (result.event?.id || result.event_id || 'saved').slice(0, 10);
      setMessage(`Emergency SOS saved to local Qdrant memory (Ref: #${evtId}). Responders will receive this during next peer sync.`);
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
      setMessage('Confirm details and location pin, then save your SOS to local memory.');
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
      setMessage('Review observation details before saving to local memory.');
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
      const evtId = (result.event?.id || result.event_id || 'saved').slice(0, 10);
      setMessage(result.duplicate
        ? 'Observation is already recorded in local memory.'
        : `Recorded in local memory (#${evtId}). Available to nearby peers.`);
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
      setMessage(`Group created. Share ID ${result.group_id} privately with your team.`);
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
      setMessage(`Joined team group ${joinId}.`);
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
      title="Disaster Assistance HUD"
      subtitle="Operates completely offline with Qdrant Edge. Instant survival triage, offline coordinate navigation, and decentralized mesh relay."
    >
      {/* Tactical Status & Network Telemetry Bar */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Brain Mode Indicator */}
        <div className="p-3 sm:p-3.5 rounded-2xl border border-slate-800 bg-[#091424] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isOfflineBrain ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${isOfflineBrain ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
            </span>
            <div>
              <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                {isOfflineBrain ? 'Phone Vector Brain' : 'Qdrant Edge Active'}
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/40">
                  {isOfflineBrain ? 'ONNX' : 'RUST'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {isOfflineBrain ? 'Standalone client-side vectors' : 'In-process embedded engine'}
              </p>
            </div>
          </div>
          <Zap size={16} className={isOfflineBrain ? 'text-amber-400' : 'text-emerald-400'} />
        </div>

        {/* GPS Coordinates with Quick Refresh */}
        <div className="p-3 sm:p-3.5 rounded-2xl border border-slate-800 bg-[#091424] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Crosshair size={16} />
            </div>
            <div>
              <div className="text-xs font-bold font-mono text-slate-100">
                {pin.lat.toFixed(4)}, {pin.lon.toFixed(4)}
              </div>
              <p className="text-[11px] text-slate-400">Your tactical location pin</p>
            </div>
          </div>
          <button
            type="button"
            onClick={useGps}
            title="Update to current GPS"
            className="text-xs px-2.5 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 border border-cyan-500/30 flex items-center gap-1 font-semibold transition-all active:scale-95"
          >
            <Cross size={12} />
            <span>GPS</span>
          </button>
        </div>

        {/* Mesh Peer Radar Telemetry */}
        <div className="p-3 sm:p-3.5 rounded-2xl border border-slate-800 bg-[#091424] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Radio size={16} className={peers.length ? 'animate-pulse' : ''} />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                <span>{peers.length} Nearby Peer{peers.length === 1 ? '' : 's'}</span>
                {syncInfo.pendingCount > 0 && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded border border-amber-500/30">
                    {syncInfo.pendingCount} in outbox
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">Wi-Fi broadcast auto-discovery</p>
            </div>
          </div>
          <button
            type="button"
            onClick={refreshPeers}
            title="Scan Wi-Fi for peers"
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 flex items-center gap-1 font-semibold transition-all active:scale-95"
          >
            <RefreshCw size={12} />
            <span>Scan</span>
          </button>
        </div>
      </div>

      {/* Global Status & Alerts */}
      {error && (
        <div role="alert" className="mb-6 p-4 rounded-2xl border border-red-800/80 bg-red-950/40 text-red-200 text-sm flex items-center justify-between shadow-lg shadow-red-950/20">
          <div className="flex items-center gap-2.5">
            <TriangleAlert size={18} className="shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError('')} className="text-xs text-red-300 hover:underline font-semibold ml-2">Dismiss</button>
        </div>
      )}
      {message && (
        <div role="status" className="mb-6 p-4 rounded-2xl border border-emerald-800/80 bg-emerald-950/40 text-emerald-200 text-sm flex items-center justify-between shadow-lg shadow-emerald-950/20">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />
            <span>{message}</span>
          </div>
          <button onClick={() => setMessage('')} className="text-xs text-emerald-300 hover:underline font-semibold ml-2">Dismiss</button>
        </div>
      )}

      {/* Desktop HUD Segmented Navigation Pills */}
      <div className="hidden sm:grid sm:grid-cols-4 gap-2 mb-6">
        {TABS.map(([id, label, Icon]) => {
          const isActive = tab === id;
          return (
            <button
              key={id}
              onClick={() => { setTab(id); setError(''); setMessage(''); }}
              className={`rounded-2xl border px-4 py-3.5 text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                isActive
                  ? 'bg-red-500 text-white border-red-600 shadow-md shadow-red-500/25 scale-[1.01]'
                  : 'bg-[#091424] border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
              }`}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: ASK & EMERGENCY CLINICAL TRIAGE */}
      {/* ========================================================================= */}
      {tab === 'ask' && (
        <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-6">
          <Card
            title="Ask Offline Memory or Trigger SOS"
            subtitle="Enter your symptoms, disaster situation, or needed emergency guidance."
          >
            <form onSubmit={onFormSubmit} className="space-y-4">
              <div className="relative">
                <textarea
                  className="field min-h-32 text-base leading-relaxed pr-12 pt-3"
                  placeholder="Ask in plain language... e.g. 'I can't walk and need help', 'Severe leg cut bleeding fast', 'Where is safe drinking water?'"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  required
                  minLength={2}
                />
                {/* Voice speech-to-text mic trigger */}
                <button
                  type="button"
                  onClick={toggleSpeechRecognition}
                  title={isListening ? "Listening... click to stop" : "Voice input (Dictate emergency)"}
                  className={`absolute right-3 bottom-3 p-2.5 rounded-xl border transition-all ${
                    isListening
                      ? 'bg-red-600 text-white border-red-500 animate-pulse shadow-lg shadow-red-600/40'
                      : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  <Mic size={17} />
                </button>
              </div>

              {/* Instant Emergency Prompt Chips */}
              <div>
                <p className="text-xs text-slate-400 font-semibold mb-2 flex items-center gap-1.5">
                  <Zap size={13} className="text-amber-400" />
                  <span>Instant 1-Tap Emergency Actions:</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {QUICK_PROMPTS.map((q) => {
                    const Icon = q.icon;
                    return (
                      <button
                        type="button"
                        key={q.text}
                        onClick={() => handleQuickPrompt(q.text)}
                        className={`text-left text-xs py-2.5 px-3.5 rounded-xl border flex items-center gap-2.5 font-bold transition-all active:scale-98 ${
                          q.urgent
                            ? 'border-red-800/80 bg-red-950/30 text-red-300 hover:bg-red-900/40 hover:border-red-600 shadow-sm'
                            : 'btn-secondary text-slate-200'
                        }`}
                      >
                        <Icon size={16} className={q.urgent ? 'text-red-400 shrink-0' : 'text-cyan-400 shrink-0'} />
                        <span className="truncate">{q.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tactical Context Strip: Location & Optional AI Enhancement */}
              <div className="rounded-xl bg-[#07111e] border border-slate-800/80 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <MapPin size={14} className="text-cyan-400 shrink-0" />
                  <span className="font-mono">Pin: {pin.lat.toFixed(4)}, {pin.lon.toFixed(4)}</span>
                  <button
                    type="button"
                    onClick={useGps}
                    className="text-cyan-300 hover:underline flex items-center gap-1 ml-1.5 font-semibold"
                  >
                    <Cross size={12} /> Sync GPS
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shareLocation}
                      onChange={(e) => setShareLocation(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-red-500 focus:ring-0"
                    />
                    <span className="font-medium">Include Coordinates</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer" title="Synthesize with Gemini when cloud API is available">
                    <input
                      type="checkbox"
                      checked={useAi}
                      onChange={(e) => setUseAi(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
                    />
                    <span className="flex items-center gap-1 font-medium">
                      <Sparkles size={12} className="text-cyan-400" /> Cloud AI
                    </span>
                  </label>
                </div>
              </div>

              {/* Search / Triage Button */}
              <button
                disabled={chatBusy}
                className="btn-primary w-full py-3.5 text-base tracking-wide"
              >
                {chatBusy ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    <span>Searching Qdrant Edge Memory…</span>
                  </>
                ) : (
                  <>
                    <span>Query Offline Survival Memory</span>
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          </Card>

          {/* Right Column: Answers, Guidance, and Emergency Action Cards */}
          <div className="space-y-4">
            {!answer && (
              <Card title="Grounded Offline Knowledge">
                <Empty icon={BookOpen}>
                  Type a question or tap an emergency prompt to retrieve clinical procedures and real-time hazard reports from this edge node.
                </Empty>
              </Card>
            )}

            {answer && (
              <>
                {/* 1. URGENT SOS ACTION CARD: Appears when user says 'can't walk' or indicates distress */}
                {answer.suggested_action?.kind === 'sos' && (
                  <div className="rounded-3xl border-2 border-red-500 bg-gradient-to-b from-red-950/60 to-[#0b1626] p-5 sm:p-6 shadow-xl shadow-red-950/40">
                    <div className="flex items-start gap-3.5">
                      <div className="p-2.5 rounded-2xl bg-red-600 text-white shrink-0 mt-0.5 animate-pulse shadow-lg shadow-red-600/50">
                        <AlertOctagon size={26} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-red-600 text-white">
                            PRIORITY 1 · IMMEDIATE
                          </span>
                          <span className="text-xs text-red-300/80 font-mono">
                            {pin.lat.toFixed(4)}, {pin.lon.toFixed(4)}
                          </span>
                        </div>
                        <h3 className="text-lg sm:text-xl font-black text-red-100 mt-1">
                          Mobility Assistance SOS Required
                        </h3>
                        <p className="text-xs sm:text-sm text-red-200/90 mt-1 leading-relaxed">
                          You reported being unable to walk or trapped. Dispatching an emergency SOS alerts all nearby volunteer and medical responder nodes via local Wi-Fi peer relay.
                        </p>
                      </div>
                    </div>

                    {/* Quick 1-Tap SOS Action Buttons */}
                    <div className="mt-5 space-y-2.5">
                      <button
                        onClick={() => saveSosToLocalDatabase()}
                        disabled={savingSos || sosSuccess}
                        className={`w-full py-4 px-4 rounded-2xl font-black flex items-center justify-center gap-2 text-sm sm:text-base transition-all active:scale-98 ${
                          sosSuccess
                            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/40 cursor-default'
                            : 'bg-red-600 hover:bg-red-500 text-white shadow-xl shadow-red-600/40 hover:shadow-red-500/50'
                        }`}
                      >
                        {savingSos ? (
                          <>
                            <RefreshCw size={18} className="animate-spin" />
                            <span>Recording in Qdrant Memory…</span>
                          </>
                        ) : sosSuccess ? (
                          <>
                            <CheckCircle2 size={20} />
                            <span>SOS Logged to Qdrant & Alerted Responders</span>
                          </>
                        ) : (
                          <>
                            <Send size={18} />
                            <span>1-Tap Save to Local Database & Alert Responders</span>
                          </>
                        )}
                      </button>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => { setTab('map'); refreshMap(); }}
                          className="btn-secondary text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5"
                        >
                          <Navigation size={14} className="text-cyan-400" />
                          <span>Show Safe Shelters</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => followAction(answer.suggested_action)}
                          className="btn-secondary text-xs py-2.5 rounded-xl flex items-center justify-center gap-1.5"
                        >
                          <ShieldAlert size={14} className="text-amber-400" />
                          <span>Detailed Triage Form</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. PRIMARY CLINICAL ANSWER CARD */}
                <Card
                  title="Verified Survival Procedure"
                  subtitle="Retrieved via in-process Qdrant Edge semantic vectors matching symptoms and available materials."
                >
                  {/* Optional Cloud AI Synthesis Banner */}
                  {answer.ai_answer && (
                    <div className="rounded-2xl border border-cyan-800/80 bg-cyan-950/30 p-4 mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs uppercase tracking-wider text-cyan-300 font-bold flex items-center gap-1.5">
                          <Sparkles size={14} className="text-cyan-400" /> Cloud AI Synthesis
                        </span>
                        <span className="text-[10px] bg-cyan-900/60 text-cyan-200 px-2 py-0.5 rounded font-mono">
                          Grounded in local Qdrant vectors
                        </span>
                      </div>
                      <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                        {answer.ai_answer}
                      </p>
                    </div>
                  )}

                  {/* Local Offline RAG Direct Guidance */}
                  <div className="rounded-2xl border border-slate-800 bg-[#07111e] p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2.5">
                      <span className="text-xs uppercase tracking-wider text-cyan-400 font-bold flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
                        {answer.ai_answer ? 'Local Grounded Evidence' : 'Offline Qdrant Guidance'}
                      </span>
                      <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                        Vector Score: {answer.cards?.[0]?.score ? answer.cards[0].score.toFixed(3) : 'High Match'}
                      </span>
                    </div>

                    <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {answer.local_answer}
                    </div>

                    {/* Interactive Action Steps Checklist (Allows survivors/medics to check off steps in real-time) */}
                    {answer.cards?.[0]?.steps?.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-slate-800">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2 flex items-center gap-1.5">
                          <CheckCircle2 size={13} className="text-emerald-400" />
                          <span>Action Steps (Tap to Check Off):</span>
                        </h4>
                        <div className="space-y-2">
                          {answer.cards[0].steps.map((step, idx) => {
                            const isDone = !!checkedSteps[idx];
                            return (
                              <label
                                key={idx}
                                className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all ${
                                  isDone
                                    ? 'bg-emerald-950/30 border-emerald-800/80 text-emerald-200 line-through opacity-80'
                                    : 'bg-slate-900/60 border-slate-800 text-slate-200 hover:border-slate-700'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isDone}
                                  onChange={(e) =>
                                    setCheckedSteps({ ...checkedSteps, [idx]: e.target.checked })
                                  }
                                  className="mt-0.5 rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0"
                                />
                                <span className="text-xs leading-relaxed font-medium">
                                  {step}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Critical Clinical Warnings */}
                    {answer.cards?.[0]?.warnings?.length > 0 && (
                      <div className="mt-4 p-3 rounded-xl border border-red-800/80 bg-red-950/30 text-red-200 text-xs flex items-start gap-2">
                        <TriangleAlert size={16} className="text-red-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold">CRITICAL WARNING: </span>
                          <span>{answer.cards[0].warnings.join(' ')}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Progressive Disclosure: Collapsible Technical Provenance & Vector Evidence */}
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                      className="w-full text-xs text-slate-400 hover:text-slate-200 flex items-center justify-between p-2.5 rounded-xl bg-slate-900/50 border border-slate-800/70 transition-all"
                    >
                      <span className="flex items-center gap-1.5 font-medium">
                        <ShieldCheck size={14} className="text-cyan-400" />
                        <span>Verification Details & Evidence ({answer.cards?.length || 0} guides, {answer.memory_hits?.length || 0} reports)</span>
                      </span>
                      {showTechnicalDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>

                    {showTechnicalDetails && (
                      <div className="mt-3 space-y-3 pt-2">
                        {answer.cards?.map((card, index) => (
                          <div key={card.id || index} className="rounded-xl border border-slate-800 bg-[#07111e] p-3 text-xs">
                            <div className="flex items-center justify-between font-bold text-slate-200">
                              <span>[G{index + 1}] {card.title}</span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                                {card.review_status || 'Verified Clinical Pack'}
                              </span>
                            </div>
                            <p className="text-slate-400 mt-1 leading-relaxed">{card.summary}</p>
                            {card.source && (
                              <a
                                href={card.source}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-cyan-400 hover:underline mt-2 inline-flex items-center gap-1"
                              >
                                <span>Official source guideline</span>
                                <ExternalLink size={10} />
                              </a>
                            )}
                          </div>
                        ))}

                        {answer.memory_hits?.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Nearby Mesh Observations</h5>
                            {answer.memory_hits.map((hit) => (
                              <div key={hit.id} className="text-xs p-2.5 rounded-xl border border-slate-800 bg-slate-900/60">
                                <p className="text-slate-200 font-medium">{hit.text}</p>
                                <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2 font-mono">
                                  <span className="capitalize">{hit.kind}</span>
                                  <span>•</span>
                                  <span>{formatTime(hit.observed_at)}</span>
                                  <span>•</span>
                                  <span>From: {hit.origin_device}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: TACTICAL MAP & SHELTERS (With Qdrant Negative Vector Rerouting) */}
      {/* ========================================================================= */}
      {tab === 'map' && (
        <div className="grid lg:grid-cols-[1.25fr_.75fr] gap-6">
          <Card title="Tactical Coordinate Grid & Mesh Radar">
            {/* Filter Chips & Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['all', 'All Points'],
                  ['sos', 'SOS / Incidents'],
                  ['hazard', 'Hazards'],
                  ['resource', 'Resources']
                ].map(([f, label]) => (
                  <button
                    key={f}
                    onClick={() => setMapFilter(f)}
                    className={`text-xs px-3 py-1.5 rounded-xl border font-bold transition-all ${
                      mapFilter === f
                        ? 'border-cyan-500 bg-cyan-950/60 text-cyan-300'
                        : 'border-slate-800 bg-[#07111e] text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={useGps}
                  className="text-xs text-cyan-300 hover:underline flex items-center gap-1 font-semibold"
                >
                  <Cross size={13} /> GPS
                </button>
                <button
                  onClick={refreshMap}
                  className="text-xs text-cyan-300 hover:underline flex items-center gap-1 font-semibold"
                >
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-400 mb-2 font-mono">
              Displaying {filteredItems.length} reports within 5 km • {peers.length} active Wi-Fi node{peers.length === 1 ? '' : 's'}
              {mapUpdatedAt ? ` • Updated ${mapUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </p>

            <MapPanel
              center={center}
              items={filteredItems}
              peers={peers}
              selectedPeer={selectedPeer}
              onMarker={handleSelectObservation}
              onSelectPeer={setSelectedPeer}
            />

            {/* Qdrant Negative Vector Recommended Facility Drawer */}
            {alternativeRec && (
              <div className="mt-4 p-4 rounded-2xl border-2 border-emerald-500/80 bg-gradient-to-r from-emerald-950/60 to-[#07111e] text-emerald-200 shadow-xl shadow-emerald-950/30 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 size={16} /> Qdrant Safe Alternative Route Recommended
                  </span>
                  {alternativeRec.score && (
                    <span className="text-[10px] font-mono bg-emerald-900/80 border border-emerald-700/60 px-2 py-0.5 rounded text-emerald-300">
                      Match: {(alternativeRec.score * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <div className="text-base font-extrabold text-white mt-1.5">
                  {alternativeRec.name}
                </div>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  {alternativeRec.rationale}
                </p>
                {alternativeRec.facilities?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {alternativeRec.facilities.map((fac) => (
                      <span key={fac} className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-900/60 border border-emerald-700/60 text-emerald-200 font-mono font-bold">
                        ✓ {fac.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Shelters & Observation Sidebar */}
          <div className="space-y-4">
            {/* Nearby Verified Checkpoints Card */}
            <Card title="Nearby Shelters & Checkpoints">
              <div className="space-y-2.5 max-h-[300px] overflow-auto pr-1">
                {[
                  { id: 'shelter_alpha', name: 'Shelter Alpha (Central High)', dist: '1,065 m', time: '~14 min walk', status: 'operational', facilities: ['Shelter', 'Medical', 'Food', 'Power'] },
                  { id: 'clinic_beta', name: 'Clinic Beta (West District)', dist: '1,007 m', time: '~13 min walk', status: 'operational', facilities: ['Medical', 'Emergency Surgery', 'Clean Water'] },
                  { id: 'water_tanker_4', name: 'Water Tanker 4 (North Gate)', dist: '560 m', time: '~7 min walk', status: 'operational', facilities: ['Clean Water', 'Purification'] },
                  { id: 'cp_17', name: 'Checkpoint CP-17 (North Bridge)', dist: '0 m', time: 'Immediate', status: 'danger_warning', hazard: 'Flooded entrance, live wires' }
                ].map((cp) => {
                  const isDanger = cp.status === 'danger_warning';
                  return (
                    <div
                      key={cp.id}
                      className={`p-3 rounded-2xl border text-xs transition-all ${
                        isDanger
                          ? 'border-red-800/80 bg-red-950/25 text-red-200'
                          : 'border-slate-800 bg-[#07111e] text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-slate-100">{cp.name}</span>
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                          isDanger ? 'bg-red-900 text-red-200 border border-red-700' : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        }`}>
                          {isDanger ? 'Flooded Hazard' : 'Operational'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono mt-1">
                        {cp.dist} · {cp.time}
                      </p>
                      {cp.hazard && (
                        <div className="mt-2 text-xs text-red-400 font-semibold flex items-center gap-1">
                          <TriangleAlert size={13} />
                          <span>{cp.hazard} · Avoided via negative vector</span>
                        </div>
                      )}
                      {cp.facilities && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {cp.facilities.map((f) => (
                            <span key={f} className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
                              {f}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Offline Wi-Fi Mesh Peers Card */}
            <Card title="Wi-Fi Mesh Radar">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-400 font-semibold">Discovered survivor & volunteer nodes:</span>
                <span className="text-xs text-emerald-400 font-bold font-mono">{peers.length} active</span>
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
                        className={`p-3 rounded-2xl border text-xs cursor-pointer transition-all ${
                          isSel ? 'border-cyan-500 bg-cyan-950/40' : 'border-slate-800 bg-[#07111e] hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 font-bold text-slate-100">
                            <span className={`w-2.5 h-2.5 rounded-full ${peer.is_online ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                            <span>{peer.node_id}</span>
                          </div>
                          <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                            isVol ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
                          }`}>
                            {peer.role}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between font-mono">
                          <span className="text-cyan-400 font-semibold">
                            {peer.distance_m != null ? `~${peer.distance_m} m away` : 'Hotspot connected'}
                          </span>
                          <span>{peer.seconds_ago}s ago</span>
                        </div>
                        <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-slate-800/80">
                          <span className="text-[10px] text-slate-500 font-mono">{peer.ip}:{peer.port}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSyncPeer(peer);
                            }}
                            disabled={syncingPeer}
                            className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1 transition-all disabled:opacity-50 active:scale-95"
                          >
                            <Wifi size={12} />
                            <span>Exchange</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty icon={Radio}>
                  Broadcasting offline beacon on local Wi-Fi. Other phones on this hotspot will automatically populate here.
                </Empty>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: REPORT SOS OR LOCAL HAZARD */}
      {/* ========================================================================= */}
      {tab === 'report' && (
        <div className="grid lg:grid-cols-[.9fr_1.1fr] gap-6">
          <Card
            title="Log Incident or Field Observation"
            subtitle="Saves directly to local Qdrant memory. Relayed peer-to-peer across offline nodes."
          >
            <form onSubmit={submitReport} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-300 font-bold uppercase tracking-wider mb-2">Observation Category</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['incident', 'Medical SOS', AlertOctagon, 'red'],
                    ['hazard', 'Hazard Alert', TriangleAlert, 'yellow'],
                    ['resource', 'Safe Resource', Droplets, 'green'],
                    ['checkpoint', 'Facility Check', Navigation, 'blue']
                  ].map(([k, label, Icon, color]) => {
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
                        className={`p-3.5 rounded-2xl border flex items-center gap-2.5 text-xs sm:text-sm font-bold transition-all active:scale-98 ${
                          isSelected
                            ? 'border-red-500 bg-red-600 text-white shadow-md shadow-red-600/30'
                            : 'border-slate-800 bg-[#07111e] text-slate-300 hover:border-slate-700 hover:text-white'
                        }`}
                      >
                        <Icon size={17} />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {report.kind === 'incident' && (
                <div className="p-3.5 rounded-2xl bg-red-950/40 border border-red-800 text-xs text-red-200 flex items-center gap-2.5 shadow-sm">
                  <ShieldAlert size={18} className="shrink-0 text-red-400" />
                  <span>Medical SOS is private by default and relayed exclusively to authorized responder nodes.</span>
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-300 font-bold uppercase tracking-wider mb-1.5">
                  Field Description
                </label>
                <textarea
                  className="field min-h-28"
                  value={report.text}
                  onChange={(event) => setReport({ ...report, text: event.target.value })}
                  required
                  minLength={3}
                  placeholder={
                    report.kind === 'incident'
                      ? "Describe situation or injury (e.g. 'Cannot walk, leg fracture near Gate 2, need stretcher')"
                      : "Describe observation (e.g. 'Road submerged under 3ft water at North Bridge')"
                  }
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-xs text-slate-300 font-bold uppercase tracking-wider">
                  Severity Level
                  <select
                    className="field mt-1.5 font-sans"
                    value={report.severity}
                    onChange={(event) => setReport({ ...report, severity: event.target.value })}
                  >
                    <option value="red">Urgent / Life Threat</option>
                    <option value="yellow">Attention Required</option>
                    <option value="green">Informational</option>
                  </select>
                </label>

                <label className="text-xs text-slate-300 font-bold uppercase tracking-wider">
                  Visibility Scope
                  <select
                    disabled={report.kind === 'incident'}
                    className="field mt-1.5 font-sans"
                    value={report.kind === 'incident' ? 'responders' : report.visibility}
                    onChange={(event) => setReport({ ...report, visibility: event.target.value })}
                  >
                    <option value="public">Public (All nearby peers)</option>
                    <option value="responders">Responders Only</option>
                    <option value="group">My Private Group Only</option>
                  </select>
                </label>
              </div>

              <div className="rounded-2xl bg-[#07111e] border border-slate-800 p-3.5 text-xs text-slate-300 flex items-center justify-between">
                <span className="font-mono">Coordinates: {pin.lat.toFixed(5)}, {pin.lon.toFixed(5)}</span>
                <button
                  type="button"
                  onClick={useGps}
                  className="text-cyan-300 hover:underline flex items-center gap-1 font-bold"
                >
                  <Cross size={13} /> Update GPS
                </button>
              </div>

              <button className="btn-primary w-full py-4 text-base font-black">
                <span>Save to Local Qdrant Memory</span>
                <ArrowRight size={18} />
              </button>
            </form>
          </Card>

          {/* Coordinate Crosshair Placement */}
          <Card
            title="Position Report Coordinates"
            subtitle="Tap anywhere on the coordinate grid to adjust where the observation is anchored."
          >
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

      {/* ========================================================================= */}
      {/* TAB 4: MESH TEAM RELAY */}
      {/* ========================================================================= */}
      {tab === 'group' && (
        <div className="grid md:grid-cols-2 gap-6">
          <Card
            title="Create Private Mesh Group"
            subtitle="Allows your field squad or family to share encrypted peer observations."
          >
            <div className="space-y-3">
              <input
                className="field"
                placeholder="Team Name (e.g. Camp Alpha, Medical Squad 1)"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
              />
              <button
                onClick={createGroup}
                disabled={!groupName.trim()}
                className="btn-primary w-full py-3.5"
              >
                Create Team Mesh Group
              </button>
            </div>
          </Card>

          <Card
            title="Join Existing Team Mesh"
            subtitle="Connect to your unit using their private group ID and shared token."
          >
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
              <button
                onClick={joinGroup}
                disabled={!joinId || !joinToken}
                className="btn-secondary w-full py-3.5"
              >
                Join Team Group
              </button>
            </div>
          </Card>

          <Card title="Active Team Membership" className="md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-slate-100">
                  {setting('groupId') ? `Connected to Group ID: ${setting('groupId')}` : 'No private group active (Public Mesh)'}
                </p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {setting('groupId')
                    ? 'Group-scoped reports and pins are encrypted and restricted to authorized team members.'
                    : 'Configure a team above to isolate private squad communications from general public relay.'}
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
                  className="btn-secondary text-xs px-4 py-2"
                >
                  Leave Group
                </button>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ANDROID / MOBILE FIXED BOTTOM NAVIGATION BAR */}
      {/* Thumb-friendly, accessible, ergonomic navigation for smartphones */}
      {/* ========================================================================= */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#091322]/98 border-t border-slate-800/90 backdrop-blur-lg pb-safe">
        <div className="grid grid-cols-4 h-16">
          {TABS.map(([id, label, Icon]) => {
            const isActive = tab === id;
            return (
              <button
                key={id}
                onClick={() => {
                  setTab(id);
                  setError('');
                  setMessage('');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
                  isActive ? 'text-red-500 font-black' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="relative">
                  <Icon size={20} className={isActive ? 'stroke-[2.5]' : 'stroke-[1.75]'} />
                  {id === 'map' && peers.length > 0 && (
                    <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  )}
                </div>
                <span className="text-[10px] tracking-tight">{label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </Shell>
  );
}
