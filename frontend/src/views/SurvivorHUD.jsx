import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertOctagon,
  ArrowRight,
  BookOpen,
  Bot,
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
  Trash2,
  TriangleAlert,
  User,
  Users,
  Wifi,
  WifiOff,
  Zap
} from 'lucide-react';
import {
  api,
  formatTime,
  saveSetting,
  setting,
  isOnlineMode,
  onOnlineModeChange,
  onBrainStatusChange,
  onSyncStateChange,
  getDiscoveredPeers,
  updateDeviceLocation,
  syncDiscoveredPeer,
  getSurvivalRadar,
  triggerAutoSync,
  getNativeOrWebLocation
} from '../api';
import { Card, Empty, Shell } from '../components';
import MapPanel from '../MapPanel';
import UnifiedRadarMap from '../components/UnifiedRadarMap';
import MeshSyncScanner from '../components/MeshSyncScanner';
import MarkdownContent from '../components/MarkdownContent';

const DEFAULT_CENTER = { lat: 28.7041, lon: 77.1025 };

const TABS = [
  ['ask', 'Assistant', HeartPulse],
  ['map', 'Radar Map', Navigation],
  ['report', 'Emergency SOS', AlertOctagon],
  ['beacon', 'Mesh Sync', Radio]
];

const QUICK_PROMPTS = [
  { label: "I can't walk & need help", text: "I can't walk and need help", icon: AlertOctagon, urgent: true, category: 'mobility' },
  { label: "Severe bleeding first aid", text: "How do I stop severe bleeding from a deep wound?", icon: HeartPulse, urgent: true, category: 'hemorrhage' },
  { label: "Safe drinking water", text: "How do I purify and make safe drinking water?", icon: Droplets, urgent: false, category: 'water' },
  { label: "Nearest safe shelter", text: "Where is the nearest safe shelter and evacuation checkpoint?", icon: Navigation, urgent: false, category: 'shelter' }
];

const EMERGENCY_PRESETS = [
  {
    title: 'Trapped in Rubble',
    desc: 'Cannot move, debris entrapment',
    text: 'Trapped under collapsed rubble or debris, cannot move, need rescue extraction.',
    kind: 'incident',
    severity: 'red',
    visibility: 'responders',
    icon: AlertOctagon,
    badgeColor: 'border-red-500/50 bg-red-950/40 text-red-300'
  },
  {
    title: 'Severe Bleeding',
    desc: 'Deep wound, urgent tourniquet',
    text: 'Severe uncontrolled bleeding from a deep wound, urgent medical aid required.',
    kind: 'incident',
    severity: 'red',
    visibility: 'responders',
    icon: HeartPulse,
    badgeColor: 'border-rose-500/50 bg-rose-950/40 text-rose-300'
  },
  {
    title: 'Cannot Walk / Fracture',
    desc: 'Immobile, limb injury',
    text: 'Cannot walk due to suspected fracture or severe physical trauma, need stretcher.',
    kind: 'incident',
    severity: 'red',
    visibility: 'responders',
    icon: ShieldAlert,
    badgeColor: 'border-amber-500/50 bg-amber-950/40 text-amber-300'
  },
  {
    title: 'Rising Floodwater',
    desc: 'Escaping water, trapped high',
    text: 'Rising floodwater approaching living quarters, access blocked, rescue boat or evacuation needed.',
    kind: 'hazard',
    severity: 'red',
    visibility: 'public',
    icon: Droplets,
    badgeColor: 'border-blue-500/50 bg-blue-950/40 text-blue-300'
  },
  {
    title: 'Hazardous Road Block',
    desc: 'Downed wires / collapsed path',
    text: 'Road completely blocked by live power lines or structural debris. Dangerous to traverse.',
    kind: 'hazard',
    severity: 'yellow',
    visibility: 'public',
    icon: TriangleAlert,
    badgeColor: 'border-yellow-500/50 bg-yellow-950/40 text-yellow-300'
  },
  {
    title: 'Clean Water Shortage',
    desc: 'Need water or rations',
    text: 'Urgent shortage of clean drinking water, infant formula, or basic food supplies.',
    kind: 'resource',
    severity: 'yellow',
    visibility: 'public',
    icon: Droplets,
    badgeColor: 'border-cyan-500/50 bg-cyan-950/40 text-cyan-300'
  }
];

export default function SurvivorHUD({ initialTab = 'ask' }) {
  const [tab, setTab] = useState(initialTab);
  const [nearestCasualty, setNearestCasualty] = useState(null);

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
    }
  }, [initialTab]);

  const [text, setText] = useState('');
  const [answer, setAnswer] = useState(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [useAi, setUseAi] = useState(() => isOnlineMode());

  useEffect(() => {
    return onOnlineModeChange(setUseAi);
  }, []);

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

  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      text: "Hello! I am your **RescueMemory Offline Emergency Assistant**.\n\nI run 100% locally on this device with **420 verified clinical guidelines** and offline sensor memory. How can I help you right now?",
      timestamp: new Date(),
      isAi: false
    }
  ]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (tab === 'ask') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, tab]);

  // Poll survival radar to detect nearest survivor in real-time
  const pinLat = pin?.lat ?? 28.7041;
  const pinLon = pin?.lon ?? 77.1025;

  const refreshRadarSummary = useCallback(async () => {
    try {
      const data = await getSurvivalRadar({
        lat: pinLat,
        lon: pinLon,
        radius_m: 5000,
        filter_category: 'all',
        include_responders: true,
      });
      if (data?.summary?.nearest_casualty) {
        setNearestCasualty(data.summary.nearest_casualty);
      } else {
        setNearestCasualty(null);
      }
    } catch {
      // offline silent
    }
  }, [pinLat, pinLon]);

  useEffect(() => {
    refreshRadarSummary();
    const radarTimer = setInterval(refreshRadarSummary, 15000);
    return () => clearInterval(radarTimer);
  }, [refreshRadarSummary]);

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
  const [syncingBeacon, setSyncingBeacon] = useState(false);
  const [directBeaconUrl, setDirectBeaconUrl] = useState('');
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
    const peerTimer = setInterval(refreshPeers, 10000);
    return () => {
      unsubBrain();
      unsubSync();
      clearInterval(peerTimer);
    };
  }, [refreshPeers]);

  // Refresh nearby map observations
  const centerLat = center?.lat ?? 28.7041;
  const centerLon = center?.lon ?? 77.1025;

  const refreshMap = useCallback(async () => {
    try {
      const groupId = setting('groupId');
      const result = await api('/api/map/nearby', {
        method: 'POST',
        group: Boolean(groupId),
        body: {
          location: { lat: centerLat, lon: centerLon },
          radius_m: 5000,
          ...(groupId ? { group_id: groupId } : {})
        }
      });
      setItems(result.items);
      setMapUpdatedAt(new Date());
    } catch (err) {
      setError(err.message);
    }
  }, [centerLat, centerLon]);

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

  // Live GPS geolocation (Native Capacitor Satellite GPS with Web fallback)
  const useGps = async () => {
    try {
      const position = await getNativeOrWebLocation();
      const location = {
        lat: Number(position.lat.toFixed(5)),
        lon: Number(position.lon.toFixed(5))
      };
      setCenter(location);
      setPin(location);
      setError('');
      setMessage(`Location locked via satellite GPS (${location.lat}, ${location.lon}).`);
      updateDeviceLocation({
        lat: location.lat,
        lon: location.lon,
        status: 'survivor_active'
      }).catch(() => {});
    } catch {
      setError('GPS permission required or satellites acquiring. Tap map to manually place your location pin.');
    }
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

  // Ask local Qdrant Edge memory with conversational multi-turn thread
  const askQuestion = async (queryText = text) => {
    if (!queryText.trim()) return;
    const trimmed = queryText.trim();
    setText('');
    setError('');
    setMessage('');
    setSosSuccess(false);

    // Append user message to chat thread
    const userMsg = {
      id: `user_${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: new Date()
    };
    setMessages((prev) => [...prev, userMsg]);
    setChatBusy(true);

    try {
      const groupId = setting('groupId');
      const result = await api('/api/chat', {
        method: 'POST',
        group: Boolean(groupId),
        body: {
          text: trimmed,
          use_ai: useAi,
          survivor_id: setting('reporterId') || 'survivor-1',
          share_location: shareLocation,
          ...(shareLocation ? { location: pin } : {}),
          ...(groupId ? { group_id: groupId } : {})
        }
      });
      setAnswer(result);

      // Append assistant response to chat thread
      const asstMsg = {
        id: `asst_${Date.now()}`,
        role: 'assistant',
        text: result.ai_answer || result.local_answer || "No verified procedure matched your query.",
        ai_answer: result.ai_answer,
        local_answer: result.local_answer,
        suggested_action: result.suggested_action,
        cards: result.cards,
        memory_hits: result.memory_hits,
        timestamp: new Date(),
        isAi: Boolean(result.ai_answer),
        score: result.cards?.[0]?.score
      };
      setMessages((prev) => [...prev, asstMsg]);

      if (shareLocation) refreshMap();
    } catch (err) {
      setError(err.message);
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'assistant',
          isError: true,
          text: `⚠️ **Unable to retrieve guidance:** ${err.message}. Check your local edge memory connection.`,
          timestamp: new Date()
        }
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: `welcome_${Date.now()}`,
        role: 'assistant',
        text: "Chat cleared. What emergency assistance or survival guidance do you need?",
        timestamp: new Date(),
        isAi: false
      }
    ]);
    setAnswer(null);
    setError('');
  };

  const onFormSubmit = (event) => {
    event.preventDefault();
    askQuestion(text);
  };

  const handleQuickPrompt = (promptText) => {
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

  // 1-Tap Sync with Nearest Beacon
  const handleSyncNearestBeacon = async () => {
    setSyncingBeacon(true);
    setMessage('');
    setError('');
    try {
      const validPeers = peers.filter((p) => p.url || p.ip);
      const sortedPeers = [...validPeers].sort((a, b) => (a.distance_m ?? 99999) - (b.distance_m ?? 99999));
      const nearest = sortedPeers[0];

      if (nearest) {
        const peerUrl = nearest.url || `http://${nearest.ip}:${nearest.port}`;
        await syncDiscoveredPeer({
          peer_url: peerUrl,
          scope: 'public'
        });
        setMessage(`Successfully synced with nearest beacon ${nearest.node_id} (~${nearest.distance_m ?? 0}m away). Knowledge and reports exchanged.`);
        refreshMap();
        refreshPeers();
      } else {
        await triggerAutoSync();
        refreshPeers();
        setMessage('Beacon heartbeat broadcasted over UDP (port 8888). Local memory outbox synced. Scanning Wi-Fi subnet for nearby beacons.');
      }
    } catch (err) {
      setError(`Beacon sync failed: ${err.message}`);
    } finally {
      setSyncingBeacon(false);
    }
  };

  const handleDirectBeaconSync = async (e) => {
    if (e) e.preventDefault();
    if (!directBeaconUrl.trim()) return;
    setSyncingBeacon(true);
    setMessage('');
    setError('');
    try {
      let url = directBeaconUrl.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `http://${url}`;
      }
      await syncDiscoveredPeer({
        peer_url: url,
        scope: 'public'
      });
      setMessage(`Successfully synced with beacon at ${url}. Local memory updated.`);
      setDirectBeaconUrl('');
      refreshMap();
      refreshPeers();
    } catch (err) {
      setError(`Direct beacon sync failed: ${err.message}`);
    } finally {
      setSyncingBeacon(false);
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
      title="RescueMemory Assistant"
      subtitle="100% offline emergency memory. Instant triage, shelter guidance, and peer SOS."
    >
      {/* Global Status & Alerts */}
      {error && (
        <div role="alert" className="mb-4 p-4 rounded-2xl border border-red-200 dark:border-red-800/80 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 text-sm flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2.5">
            <TriangleAlert size={18} className="shrink-0 text-red-500 dark:text-red-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError('')} className="text-xs text-red-600 dark:text-red-300 hover:underline font-semibold ml-2">Dismiss</button>
        </div>
      )}
      {message && (
        <div role="status" className="mb-4 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 text-sm flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={18} className="shrink-0 text-emerald-500 dark:text-emerald-400" />
            <span>{message}</span>
          </div>
          <button onClick={() => setMessage('')} className="text-xs text-emerald-600 dark:text-emerald-300 hover:underline font-semibold ml-2">Dismiss</button>
        </div>
      )}

      {/* Desktop HUD Segmented Navigation Pills */}
      <div className="hidden sm:grid sm:grid-cols-4 gap-2 mb-5">
        {TABS.map(([id, label, Icon]) => {
          const isActive = tab === id;
          return (
            <button
              key={id}
              onClick={() => { setTab(id); setError(''); setMessage(''); }}
              className={`rounded-2xl border px-3 py-3 text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                isActive
                  ? 'bg-red-600 text-white border-red-600 shadow-md shadow-red-500/25 scale-[1.01]'
                  : 'bg-white dark:bg-[#091424] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon size={16} />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: CONVERSATIONAL ASSISTANT & EMERGENCY CLINICAL CHAT */}
      {/* ========================================================================= */}
      {tab === 'ask' && (
        <div className="space-y-4">
          {/* Prominent Live Nearest Survivor Compass Banner */}
          {nearestCasualty && (
            <div
              onClick={() => setTab('map')}
              className="p-3.5 sm:p-4 rounded-2xl border-2 border-red-500 bg-red-50/80 dark:bg-red-950/40 cursor-pointer hover:border-red-400 transition-all shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
            >
              <div className="flex items-start sm:items-center gap-3.5">
                <div className="p-2.5 rounded-xl bg-red-600 text-white shrink-0 shadow-md shadow-red-600/40 animate-pulse">
                  <Compass size={22} />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-red-600 text-white">
                      Nearest Survivor Detected
                    </span>
                    <span className="text-xs font-mono font-bold text-red-700 dark:text-red-300">
                      {nearestCasualty.distance_m}m · {nearestCasualty.cardinal} ({String(nearestCasualty.bearing_deg || 0).padStart(3, '0')}°)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                      Qdrant Synced
                    </span>
                  </div>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1 line-clamp-1 group-hover:text-red-600 dark:group-hover:text-red-300 transition-colors">
                    {nearestCasualty.name || 'Casualty in distress'} — {nearestCasualty.text}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setTab('compass'); }}
                className="btn-primary text-xs px-3.5 py-2 shrink-0 self-start sm:self-auto"
              >
                <span>360° Compass</span>
                <ArrowRight size={14} />
              </button>
            </div>
          )}

          {/* Full ChatGPT / Antigravity Style Conversational Assistant Container */}
          <div className="flex flex-col h-[calc(100dvh-13.5rem)] sm:h-[calc(100vh-270px)] min-h-[460px] max-h-[820px] rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#08121e] shadow-lg overflow-hidden transition-all">
            {/* Chat Header */}
            <div className="px-3.5 py-2.5 sm:px-5 sm:py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-[#0b1626] flex items-center justify-between gap-2.5 shrink-0">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl bg-gradient-to-tr from-red-600 to-rose-500 flex items-center justify-center text-white shadow-md shadow-red-500/20 shrink-0">
                  <Bot size={18} className="sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                      RescueMemory Assistant
                    </h2>
                    <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-700/60 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Offline Active
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate hidden sm:block">
                    420 Clinical Guidelines · Qdrant Vector Memory · Zero Cloud Needed
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* Online / Offline status badge */}
                <div
                  className={`hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-xl border font-semibold ${
                    useAi
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                  }`}
                  title={useAi ? 'Connected to Internet: Cloud AI answers by default' : 'Offline Mode: Answers synthesized locally from Qdrant Edge Memory'}
                >
                  {useAi ? (
                    <>
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                      </span>
                      <Wifi size={12} className="text-emerald-500" />
                      <span>Cloud AI Active</span>
                    </>
                  ) : (
                    <>
                      <span className="inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                      <WifiOff size={12} className="text-amber-500" />
                      <span>Offline Edge Mode</span>
                    </>
                  )}
                </div>

                {/* GPS location pill */}
                <button
                  type="button"
                  onClick={useGps}
                  title="Click to refresh GPS pin"
                  className="hidden md:inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-cyan-500 dark:hover:text-cyan-400 font-mono transition-colors"
                >
                  <MapPin size={13} className="text-cyan-500" />
                  <span>{pin.lat.toFixed(3)}, {pin.lon.toFixed(3)}</span>
                </button>

                {/* Clear chat button */}
                <button
                  type="button"
                  onClick={clearChat}
                  title="Reset conversation"
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                >
                  <Trash2 size={13} />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {/* Scrollable Message History Area */}
            <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-3.5 sm:space-y-4 bg-slate-50/50 dark:bg-[#07111e]/70">
              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-2.5 sm:gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    {/* Assistant Avatar */}
                    {!isUser && (
                      <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-md shadow-cyan-600/20 shrink-0 mt-0.5">
                        <Bot size={15} />
                      </div>
                    )}

                    {/* Message Bubble Container */}
                    <div
                      className={`chat-assistant-bubble transition-all ${
                        isUser
                          ? 'max-w-[85%] sm:max-w-[70%] rounded-2xl p-3 sm:p-3.5 shadow-sm bg-red-600 text-white rounded-tr-xs ml-auto'
                          : 'max-w-[92%] sm:max-w-[80%] rounded-2xl p-3.5 sm:p-4 shadow-sm bg-white dark:bg-[#0b1626] border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-xs'
                      }`}
                    >
                      {/* Header meta */}
                      <div className="flex items-center justify-between gap-3 mb-1.5 text-[11px] opacity-75">
                        <span className="font-semibold flex items-center gap-1.5">
                          {isUser ? (
                            'You'
                          ) : msg.isAi ? (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                              <span className="text-emerald-600 dark:text-emerald-400 font-bold">Cloud AI (Gemini)</span>
                            </>
                          ) : (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                              <span className="text-amber-600 dark:text-amber-400 font-bold">RescueMemory Edge RAG (Offline)</span>
                            </>
                          )}
                        </span>
                        <span className="font-mono">
                          {msg.timestamp ? formatTime(msg.timestamp) : ''}
                        </span>
                      </div>

                      {/* Message Body with rich Markdown parsing */}
                      <div className={isUser ? 'text-sm text-white font-medium whitespace-pre-wrap' : 'text-sm'}>
                        {isUser ? (
                          msg.text
                        ) : (
                          <MarkdownContent content={msg.text} />
                        )}
                      </div>

                      {/* If Urgent SOS Action is suggested */}
                      {msg.suggested_action?.kind === 'sos' && (
                        <div className="mt-3.5 p-3.5 rounded-xl border border-red-300 dark:border-red-800/80 bg-red-50 dark:bg-red-950/40 text-slate-900 dark:text-red-100">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-red-600 text-white">
                              PRIORITY 1 · IMMEDIATE
                            </span>
                            <span className="text-xs text-red-700 dark:text-red-300 font-mono">
                              GPS: {pin.lat.toFixed(4)}, {pin.lon.toFixed(4)}
                            </span>
                          </div>
                          <p className="text-xs text-red-900 dark:text-red-200 mb-3">
                            Mobility assistance needed. Tap below to log emergency SOS and broadcast to nearby responder nodes.
                          </p>
                          <button
                            onClick={() => saveSosToLocalDatabase()}
                            disabled={savingSos || sosSuccess}
                            className={`w-full py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-2 text-xs transition-all active:scale-98 ${
                              sosSuccess
                                ? 'bg-emerald-600 text-white shadow-md cursor-default'
                                : 'bg-red-600 hover:bg-red-500 text-white shadow-md'
                            }`}
                          >
                            {savingSos ? (
                              <>
                                <RefreshCw size={14} className="animate-spin" />
                                <span>Logging SOS to Qdrant...</span>
                              </>
                            ) : sosSuccess ? (
                              <>
                                <CheckCircle2 size={16} />
                                <span>SOS Active & Alerted Responders</span>
                              </>
                            ) : (
                              <>
                                <Send size={14} />
                                <span>1-Tap Save to Qdrant & Broadcast SOS</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {/* Action Steps Checklist - Only display when genuine medical steps match and not greeting/fallback */}
                      {msg.cards?.[0]?.steps?.length > 0 &&
                       !msg.text.includes("Stay Calm & Safe") &&
                       !msg.text.includes("Hello! I am your") &&
                       !msg.text.includes("I could not find directly matching guidance") && (
                        <div className="mt-3.5 pt-3 border-t border-slate-200 dark:border-slate-800">
                          <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                            <CheckCircle2 size={13} className="text-emerald-500" />
                            <span>Clinical Checklist (Tap to mark done):</span>
                          </p>
                          <div className="space-y-1.5">
                            {msg.cards[0].steps.map((step, idx) => {
                              const isDone = !!checkedSteps[idx];
                              return (
                                <label
                                  key={idx}
                                  className={`flex items-start gap-2.5 p-2 rounded-lg border text-xs cursor-pointer transition-all ${
                                    isDone
                                      ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 line-through opacity-75'
                                      : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isDone}
                                    onChange={(e) =>
                                      setCheckedSteps({ ...checkedSteps, [idx]: e.target.checked })
                                    }
                                    className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-emerald-600 focus:ring-0"
                                  />
                                  <span className="leading-snug">{step}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Warning Banner - Only display when genuine medical warnings match and not greeting/fallback */}
                      {msg.cards?.[0]?.warnings?.length > 0 &&
                       !msg.text.includes("Stay Calm & Safe") &&
                       !msg.text.includes("Hello! I am your") &&
                       !msg.text.includes("I could not find directly matching guidance") && (
                        <div className="mt-3 p-2.5 rounded-xl border border-red-200 dark:border-red-800/80 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 text-xs flex items-start gap-2">
                          <TriangleAlert size={14} className="text-red-500 shrink-0 mt-0.5" />
                          <div className="leading-relaxed">
                            <span className="font-bold">CRITICAL WARNING: </span>
                            <span>{msg.cards[0].warnings.join(' ')}</span>
                          </div>
                        </div>
                      )}

                      {/* Collapsible Verified Clinical Evidence & Vector Hits */}
                      {msg.cards?.length > 0 && (
                        <details className="mt-3 text-xs group/details">
                          <summary className="cursor-pointer text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 flex items-center gap-1 select-none">
                            <ShieldCheck size={12} className="text-cyan-500" />
                            <span>View Grounded Clinical Sources ({msg.cards.length} guidelines)</span>
                          </summary>
                          <div className="mt-2 space-y-2 pl-2 border-l-2 border-slate-200 dark:border-slate-800">
                            {msg.cards.map((card, cIdx) => (
                              <div key={card.id || cIdx} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                                <div className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">
                                  [G{cIdx + 1}] {card.title}
                                </div>
                                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">{card.summary}</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>

                    {/* User Avatar */}
                    {isUser && (
                      <div className="h-8 w-8 rounded-xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 shrink-0 mt-0.5">
                        <User size={16} />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Typing indicator when assistant is processing */}
              {chatBusy && (
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-md shadow-cyan-600/20 shrink-0 mt-0.5">
                    <Bot size={16} />
                  </div>
                  <div className="bg-white dark:bg-[#0b1626] border border-slate-200 dark:border-slate-800 rounded-2xl rounded-tl-xs p-3.5 shadow-sm">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <RefreshCw size={14} className="animate-spin text-cyan-500" />
                      <span>Searching offline Qdrant vectors & clinical memory...</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Scroll anchor */}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Emergency Prompt Chips */}
            <div className="px-3 sm:px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1626] shrink-0">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 touch-pan-x">
                {QUICK_PROMPTS.map((q) => {
                  const Icon = q.icon;
                  return (
                    <button
                      type="button"
                      key={q.text}
                      onClick={() => handleQuickPrompt(q.text)}
                      className={`shrink-0 text-xs py-1.5 px-3 rounded-full border flex items-center gap-1.5 font-semibold transition-all active:scale-95 touch-manipulation ${
                        q.urgent
                          ? 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon size={13} className={q.urgent ? 'text-red-600 dark:text-red-400' : 'text-cyan-600 dark:text-cyan-400'} />
                      <span>{q.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom Input Box */}
            <div className="p-2.5 sm:p-3.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1626] shrink-0 pb-safe">
              <form onSubmit={onFormSubmit} className="relative flex items-center gap-2">
                {/* Voice speech-to-text mic trigger */}
                <button
                  type="button"
                  onClick={toggleSpeechRecognition}
                  title={isListening ? "Listening... click to stop" : "Voice input (Dictate emergency)"}
                  className={`p-2.5 sm:p-3 rounded-xl border transition-all shrink-0 active:scale-95 touch-manipulation ${
                    isListening
                      ? 'bg-red-600 text-white border-red-500 animate-pulse shadow-md shadow-red-600/40'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <Mic size={18} />
                </button>

                {/* Input box */}
                <input
                  type="text"
                  className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 transition-all"
                  placeholder="Ask emergency question (e.g. Can't walk, severe bleeding, safe water)..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={chatBusy}
                />

                {/* Send button */}
                <button
                  type="submit"
                  disabled={chatBusy || !text.trim()}
                  className="p-2.5 sm:p-3 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold transition-all active:scale-95 shrink-0 shadow-md shadow-red-600/30 touch-manipulation"
                >
                  <Send size={18} />
                </button>
              </form>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-400 px-1">
                <span className="truncate">Runs 100% offline via local Qdrant memory</span>
                <label className="flex items-center gap-1.5 cursor-pointer ml-auto">
                  <input
                    type="checkbox"
                    checked={useAi}
                    onChange={(e) => setUseAi(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700 text-cyan-600 focus:ring-0"
                  />
                  <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400 font-medium">
                    <Sparkles size={11} className="text-cyan-500" /> Cloud AI Synthesis
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: UNIFIED RADAR MAP & 360° SURVIVAL COMPASS */}
      {/* ========================================================================= */}
      {tab === 'map' && (
        <UnifiedRadarMap
          userLocation={pin}
          items={items}
          peers={peers}
          onSelectLocation={(loc) => {
            setPin(loc);
            setCenter(loc);
          }}
          onNavigateTarget={(target) => {
            if (target?.location) {
              setCenter(target.location);
              setSelected(target);
            }
          }}
          role="survivor"
        />
      )}

      {/* ========================================================================= */}
      {/* ========================================================================= */}
      {/* TAB 3: REPORT SOS OR LOCAL HAZARD (Streamlined & Panic-Proof) */}
      {/* ========================================================================= */}
      {tab === 'report' && (
        <div className="grid lg:grid-cols-[1fr_1fr] gap-6">
          <Card
            title="Log Incident or Emergency SOS"
            subtitle="Recorded directly to local Qdrant memory. Relayed peer-to-peer across offline mesh nodes."
          >
            {/* Quick 1-Tap Situation Presets Grid */}
            <div className="mb-4">
              <label className="block text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">
                Quick 1-Tap Presets (No typing needed)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {EMERGENCY_PRESETS.map((preset) => {
                  const PresetIcon = preset.icon;
                  return (
                    <button
                      key={preset.title}
                      type="button"
                      onClick={() => {
                        setReport({
                          ...report,
                          kind: preset.kind,
                          text: preset.text,
                          severity: preset.severity,
                          visibility: preset.visibility
                        });
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all active:scale-95 hover:border-slate-600 ${preset.badgeColor}`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs text-white">
                        <PresetIcon size={14} className="shrink-0" />
                        <span className="truncate">{preset.title}</span>
                      </div>
                      <div className="text-[10px] text-slate-300 truncate mt-0.5 opacity-90">
                        {preset.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <form onSubmit={submitReport} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-300 font-bold uppercase tracking-wider mb-2">
                  Observation Category
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['incident', 'Medical SOS', AlertOctagon],
                    ['hazard', 'Hazard Alert', TriangleAlert],
                    ['resource', 'Safe Resource', Droplets],
                    ['checkpoint', 'Facility Check', Navigation]
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
                        className={`p-3 rounded-xl border flex items-center gap-2 text-xs sm:text-sm font-bold transition-all active:scale-95 ${
                          isSelected
                            ? 'border-red-500 bg-red-600 text-white shadow-md shadow-red-600/30'
                            : 'border-slate-800 bg-[#07111e] text-slate-300 hover:border-slate-700 hover:text-white'
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
                <div className="p-3 rounded-xl bg-red-950/40 border border-red-800/80 text-xs text-red-200 flex items-center gap-2.5">
                  <ShieldAlert size={17} className="shrink-0 text-red-400" />
                  <span>Medical SOS is routed with high priority to authorized rescue nodes & local medical memory.</span>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-300 font-bold uppercase tracking-wider">
                    Situation Details
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {report.text.length} chars
                  </span>
                </div>
                <textarea
                  className="field min-h-24 w-full"
                  value={report.text}
                  onChange={(event) => setReport({ ...report, text: event.target.value })}
                  required
                  minLength={3}
                  placeholder={
                    report.kind === 'incident'
                      ? "Describe situation or injury (e.g., 'Trapped under concrete beam, 2 persons conscious, need stretcher')"
                      : "Describe observation (e.g., 'Bridge washed out, safe bypass available on East Ridge path')"
                  }
                />
              </div>

              {/* Segmented Buttons for Severity Level (No broken select dropdowns) */}
              <div>
                <label className="block text-xs text-slate-300 font-bold uppercase tracking-wider mb-1.5">
                  Severity Level
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'red', label: 'Urgent / Threat', icon: AlertOctagon, activeClass: 'border-red-500 bg-red-600 text-white shadow-md shadow-red-600/30' },
                    { id: 'yellow', label: 'Attention Needed', icon: TriangleAlert, activeClass: 'border-amber-500 bg-amber-600 text-white shadow-md shadow-amber-600/30' },
                    { id: 'green', label: 'Informational', icon: ShieldCheck, activeClass: 'border-emerald-500 bg-emerald-600 text-white shadow-md shadow-emerald-600/30' }
                  ].map((s) => {
                    const isSelected = report.severity === s.id;
                    const SIcon = s.icon;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setReport({ ...report, severity: s.id })}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col sm:flex-row items-center justify-center gap-1.5 transition-all ${
                          isSelected
                            ? s.activeClass
                            : 'border-slate-800 bg-[#07111e] text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <SIcon size={14} />
                        <span>{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Segmented Buttons for Visibility Scope (No broken select dropdowns) */}
              <div>
                <label className="block text-xs text-slate-300 font-bold uppercase tracking-wider mb-1.5">
                  Visibility Scope
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setReport({ ...report, visibility: 'responders' })}
                    className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                      report.visibility === 'responders'
                        ? 'border-cyan-500 bg-cyan-950/80 text-cyan-200 shadow-md shadow-cyan-950/40'
                        : 'border-slate-800 bg-[#07111e] text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <ShieldAlert size={14} />
                    <span>Responders Only</span>
                  </button>
                  <button
                    type="button"
                    disabled={report.kind === 'incident'}
                    onClick={() => setReport({ ...report, visibility: 'public' })}
                    className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                      report.kind === 'incident'
                        ? 'opacity-40 cursor-not-allowed border-slate-900 bg-slate-900/50 text-slate-600'
                        : report.visibility === 'public'
                        ? 'border-emerald-500 bg-emerald-950/80 text-emerald-200 shadow-md shadow-emerald-950/40'
                        : 'border-slate-800 bg-[#07111e] text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Wifi size={14} />
                    <span>Public Mesh</span>
                  </button>
                </div>
              </div>

              {/* Coordinates status & GPS updater */}
              <div className="rounded-xl bg-[#07111e] border border-slate-800 p-3 text-xs text-slate-300 flex items-center justify-between">
                <span className="font-mono">
                  Coordinates: {pin.lat.toFixed(5)}, {pin.lon.toFixed(5)}
                </span>
                <button
                  type="button"
                  onClick={useGps}
                  className="text-cyan-300 hover:underline flex items-center gap-1 font-bold"
                >
                  <Cross size={13} /> Update GPS
                </button>
              </div>

              {/* 1-Tap SOS Broadcast Button */}
              <button
                type="submit"
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-red-700 hover:from-red-500 hover:to-rose-600 text-white font-black text-sm sm:text-base shadow-xl shadow-red-700/40 flex items-center justify-center gap-2.5 transition-all active:scale-[0.98]"
              >
                <AlertOctagon size={19} className="animate-pulse" />
                <span>Save to Local Qdrant Memory & Mesh</span>
                <ArrowRight size={17} />
              </button>
            </form>
          </Card>

          {/* Coordinate Crosshair Placement */}
          <Card
            title="Incident Coordinates"
            subtitle="Tap anywhere on the coordinate map grid to adjust where the incident is anchored."
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
      {/* ========================================================================= */}
      {/* TAB 4: MESH SYNC SCANNER (P2P Radar Grid & 1-Tap Transfer) */}
      {/* ========================================================================= */}
      {tab === 'beacon' && (
        <MeshSyncScanner
          initialPeers={peers}
          onSyncComplete={() => {
            refreshMap();
            refreshPeers();
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* ANDROID / MOBILE FIXED BOTTOM NAVIGATION BAR */}
      {/* Thumb-friendly, accessible, ergonomic navigation for smartphones */}
      {/* ========================================================================= */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 dark:bg-[#091322]/98 border-t border-slate-200 dark:border-slate-800/90 backdrop-blur-lg pb-safe">
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
                  isActive ? 'text-red-500 font-bold' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <div className="relative">
                  <Icon size={18} className={isActive ? 'stroke-[2.5]' : 'stroke-[1.75]'} />
                  {id === 'map' && (nearestCasualty || peers.length > 0) && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 animate-ping" />
                  )}
                  {id === 'beacon' && peers.length > 0 && (
                    <span className="absolute -top-1 -right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  )}
                </div>
                <span className="text-[10px] tracking-tight font-medium">{label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </Shell>
  );
}
