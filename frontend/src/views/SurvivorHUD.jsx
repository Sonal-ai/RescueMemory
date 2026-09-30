import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
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

const EMERGENCY_TYPES = [
  {
    id: 'medical',
    title: 'Medical SOS',
    subtitle: 'Severe injury, bleeding, cardiac, unconscious',
    defaultText: 'Urgent medical SOS: severe physical trauma or uncontrolled bleeding, clinical assistance needed immediately.',
    kind: 'incident',
    severity: 'red',
    visibility: 'responders',
    icon: HeartPulse,
    badgeBg: 'bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-500/30',
    selectedStyle: 'border-red-500 bg-red-50/90 dark:bg-gradient-to-br dark:from-red-950/80 dark:to-[#0e172a] shadow-md ring-2 ring-red-500/30 text-red-950 dark:text-white'
  },
  {
    id: 'trapped',
    title: 'Trapped / Rubble',
    subtitle: 'Structural collapse, rising water, cannot move',
    defaultText: 'Trapped survivor: structural collapse or rising floodwater, unable to move unassisted, need rescue extraction.',
    kind: 'incident',
    severity: 'red',
    visibility: 'responders',
    icon: AlertOctagon,
    badgeBg: 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 border-red-200 dark:border-red-500/30',
    selectedStyle: 'border-rose-500 bg-rose-50/90 dark:bg-gradient-to-br dark:from-rose-950/80 dark:to-[#0e172a] shadow-md ring-2 ring-rose-500/30 text-rose-950 dark:text-white'
  },
  {
    id: 'hazard',
    title: 'Route Hazard',
    subtitle: 'Downed powerlines, fire, collapsed path',
    defaultText: 'Dangerous obstacle: road completely blocked by live power lines or flood debris, alternate route needed.',
    kind: 'hazard',
    severity: 'yellow',
    visibility: 'public',
    icon: TriangleAlert,
    badgeBg: 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
    selectedStyle: 'border-amber-500 bg-amber-50/90 dark:bg-gradient-to-br dark:from-amber-950/80 dark:to-[#0e172a] shadow-md ring-2 ring-amber-500/30 text-amber-950 dark:text-white'
  },
  {
    id: 'supplies',
    title: 'Water & Supplies',
    subtitle: 'Dehydration, infant formula, supplies out',
    defaultText: 'Emergency resource shortage: drinking water depleted, urgent replenishment requested.',
    kind: 'resource',
    severity: 'yellow',
    visibility: 'public',
    icon: Droplets,
    badgeBg: 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-800 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/30',
    selectedStyle: 'border-cyan-500 bg-cyan-50/90 dark:bg-gradient-to-br dark:from-cyan-950/80 dark:to-[#0e172a] shadow-md ring-2 ring-cyan-500/30 text-cyan-950 dark:text-white'
  }
];

export default function SurvivorHUD({ initialTab = 'ask' }) {
  const location = useLocation();
  const navTarget = location.state?.target;

  const normalizeTab = (t) => {
    if (['compass', 'radar', 'find'].includes(t)) return 'map';
    return t || 'ask';
  };

  const [tab, setTab] = useState(() => (navTarget ? 'map' : normalizeTab(initialTab)));
  const [nearestCasualty, setNearestCasualty] = useState(null);

  const [text, setText] = useState('');
  const [answer, setAnswer] = useState(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [useAi, setUseAi] = useState(() => isOnlineMode());

  // Interactive Clinical Triage & Material Assessment states
  const [triageOpen, setTriageOpen] = useState(false);
  const [breathingStatus, setBreathingStatus] = useState(true);
  const [bleedingType, setBleedingType] = useState('none'); // 'none', 'venous', 'spurting'
  const [selectedMaterials, setSelectedMaterials] = useState([]); // ['cloth', 'stick', 'water', 'belt']

  useEffect(() => {
    return onOnlineModeChange(setUseAi);
  }, []);

  const targetLoc = navTarget?.location || (navTarget?.lat != null && navTarget?.lon != null ? { lat: navTarget.lat, lon: navTarget.lon } : null);
  const [shareLocation, setShareLocation] = useState(true);
  const [center, setCenter] = useState(() => targetLoc || DEFAULT_CENTER);
  const [pin, setPin] = useState(() => targetLoc || DEFAULT_CENTER);
  const [items, setItems] = useState([]);
  const [peers, setPeers] = useState([]);
  const [selectedPeer, setSelectedPeer] = useState(null);
  const [syncingPeer, setSyncingPeer] = useState(false);
  const [mapUpdatedAt, setMapUpdatedAt] = useState(null);
  const [selected, setSelected] = useState(() => navTarget || null);
  const [alternativeRec, setAlternativeRec] = useState(null);
  const [loadingAltRec, setLoadingAltRec] = useState(false);
  const [checkedSteps, setCheckedSteps] = useState({});
  const [isListening, setIsListening] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [showQuickPrompts, setShowQuickPrompts] = useState(false);
  const [showNearestExpanded, setShowNearestExpanded] = useState(false);

  const prevTargetRef = useRef(navTarget);
  useEffect(() => {
    if (navTarget && navTarget !== prevTargetRef.current) {
      prevTargetRef.current = navTarget;
      setTab('map');
      setSelected(navTarget);
      const loc = navTarget.location || (navTarget.lat != null && navTarget.lon != null ? { lat: navTarget.lat, lon: navTarget.lon } : null);
      if (loc) {
        setCenter(loc);
        setPin(loc);
      }
    }
  }, [navTarget]);

  const [messages, setMessages] = useState(() => [
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
    text: 'Urgent medical SOS: severe physical trauma or uncontrolled bleeding, clinical assistance needed immediately.',
    entity_id: '',
    status: 'needs_help',
    severity: 'red',
    visibility: 'responders'
  });
  const [selectedEmergencyType, setSelectedEmergencyType] = useState('medical');
  const [showSosDetails, setShowSosDetails] = useState(false);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [savingSos, setSavingSos] = useState(false);
  const [sosSuccess, setSosSuccess] = useState(false);
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
      const raw = Array.isArray(result?.items) ? result.items : (Array.isArray(result?.events) ? result.events : []);
      setItems(raw);
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
          materials: selectedMaterials,
          breathing: breathingStatus,
          bleeding_type: bleedingType,
          ...(shareLocation ? { location: pin } : {}),
          ...(groupId ? { group_id: groupId } : {})
        }
      });
      setAnswer(result);

      // Append assistant response to chat thread
      const asstAnswerText = result.ai_answer || result.local_answer || result.text || result.answer?.text || (result.cards?.[0] ? `### 🚨 Verified Protocol: ${result.cards[0].title}\n\n${result.cards[0].summary || ''}` : "### 🛡️ Stay Calm & Safe\n• **Move away from hazards:** If in immediate danger, move to open secure ground.\n• **Contact emergency services:** Call **112 / 911** or broadcast via the **Emergency SOS** tab.\n• **Offline Disaster Brain:** I have 419 emergency protocols on your device. Ask me about **inability to walk**, **severe bleeding**, **CPR**, **burns**, or **clean water**.");
      const asstMsg = {
        id: `asst_${Date.now()}`,
        role: 'assistant',
        text: asstAnswerText,
        ai_answer: result.ai_answer,
        local_answer: result.local_answer || result.text || result.answer?.text || asstAnswerText,
        suggested_action: result.suggested_action,
        cards: result.cards || result.answer?.source_cards || [],
        memory_hits: result.memory_hits,
        timestamp: new Date(),
        isAi: Boolean(result.ai_answer),
        score: (result.cards || result.answer?.source_cards)?.[0]?.score
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
    if (event) event.preventDefault();
    setError('');
    setMessage('');
    setSavingSos(true);
    try {
      const groupId = setting('groupId');
      const visibility = report.kind === 'incident' ? 'responders' : report.visibility;
      const reportText = (report.text || '').trim() ||
        (report.kind === 'incident'
          ? 'Urgent Medical / Rescue Assistance Required'
          : report.kind === 'hazard'
          ? 'Critical Hazard Alert / Road Blocked'
          : 'Emergency Resource / Water Shortage');
      const result = await api('/api/reports', {
        method: 'POST',
        group: visibility === 'group',
        body: {
          ...report,
          visibility,
          text: reportText,
          reporter_id: setting('reporterId') || 'survivor-1',
          location: pin,
          entity_id: report.entity_id?.trim() || null,
          group_id: visibility === 'group' ? groupId : null
        }
      });
      const evtId = (result.event?.id || result.event_id || 'saved').slice(0, 10);
      setSosSuccess(true);
      setMessage(result.duplicate
        ? 'Observation is already recorded in local memory.'
        : `Emergency SOS broadcasted & saved to local Qdrant memory (#${evtId}). Relayed to nearby peers.`);
      refreshMap();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSos(false);
    }
  };

  return (
    <Shell
      title={tab === 'ask' ? '' : tab === 'map' ? 'Tactical Radar & Map' : tab === 'report' ? 'Emergency SOS' : 'Mesh Sync'}
      subtitle=""
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
      <div className="hidden sm:grid sm:grid-cols-4 gap-2.5 mb-5">
        {TABS.map(([id, label, Icon]) => {
          const isActive = tab === id;
          const activeStyles = {
            ask: 'bg-gradient-to-r from-cyan-600 via-sky-600 to-blue-600 text-white border-cyan-400 shadow-md shadow-cyan-600/30 ring-1 ring-cyan-400/50',
            map: 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white border-emerald-400 shadow-md shadow-emerald-600/30 ring-1 ring-emerald-400/50',
            report: 'bg-gradient-to-r from-red-600 via-rose-600 to-red-700 text-white border-rose-400 shadow-md shadow-red-600/35 ring-1 ring-rose-400/50',
            beacon: 'bg-gradient-to-r from-sky-600 via-indigo-600 to-sky-700 text-white border-sky-400 shadow-md shadow-sky-600/30 ring-1 ring-sky-400/50'
          };
          const hasPing = (id === 'map' && (nearestCasualty || peers.length > 0)) || (id === 'beacon' && peers.length > 0);
          return (
            <button
              key={id}
              onClick={() => { setTab(id); setError(''); setMessage(''); }}
              className={`relative rounded-2xl border px-4 py-3.5 text-xs font-black flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                isActive
                  ? `${activeStyles[id] || 'bg-red-600 text-white'} scale-[1.01]`
                  : 'bg-[#e6f0f7] dark:bg-[#0c1628] border-[#cce0ef] dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-[#d9e8f4] dark:hover:bg-[#111f38] hover:text-slate-900 dark:hover:text-white shadow-xs font-bold'
              }`}
            >
              <Icon size={17} className={isActive ? 'stroke-[2.5]' : 'stroke-[1.8] text-slate-500 dark:text-slate-400'} />
              <span className="truncate tracking-wide">{label}</span>
              {hasPing && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping absolute top-2.5 right-2.5" />
              )}
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: CONVERSATIONAL ASSISTANT & EMERGENCY CLINICAL CHAT */}
      {/* ========================================================================= */}
      {tab === 'ask' && (
        <div className="space-y-4">
          {/* Streamlined Live Nearest Survivor Alert with Side Arrow */}
          {nearestCasualty && (
            <div className="rounded-2xl border border-red-300 dark:border-red-800 bg-red-50/90 dark:bg-red-950/40 p-2 sm:p-2.5 px-3 shadow-xs transition-all">
              <div className="flex items-center justify-between gap-2">
                <div
                  onClick={() => setTab('map')}
                  className="flex items-center gap-2 min-w-0 cursor-pointer group flex-1"
                  title="Tap to open 360° radar compass"
                >
                  <div className="p-1 rounded-lg bg-red-600 text-white shrink-0 animate-pulse">
                    <Compass size={13} />
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] uppercase font-black px-1.5 py-0.5 rounded bg-red-600 text-white shrink-0">
                      SOS {nearestCasualty.distance_m}m {nearestCasualty.cardinal}
                    </span>
                    <span className="text-xs font-bold text-red-950 dark:text-red-200 truncate group-hover:underline">
                      {nearestCasualty.name || 'Casualty'} — {nearestCasualty.text}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setTab('map')}
                    className="px-2 py-0.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold flex items-center gap-1 transition-transform active:scale-95"
                  >
                    <span>Radar</span>
                    <ArrowRight size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNearestExpanded(!showNearestExpanded)}
                    className="p-1 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60 rounded-lg transition-colors cursor-pointer"
                    title={showNearestExpanded ? "Collapse details" : "Expand details"}
                  >
                    <ChevronDown size={13} className={`transition-transform duration-200 ${showNearestExpanded ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>

              {showNearestExpanded && (
                <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-900/60 text-xs text-slate-700 dark:text-slate-300 animate-in fade-in">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{nearestCasualty.text}</p>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-slate-500">
                    <span>Bearing: {String(nearestCasualty.bearing_deg || 0).padStart(3, '0')}°</span>
                    <span>•</span>
                    <span>Direct line of sight: ~{nearestCasualty.distance_m}m</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Full ChatGPT / Antigravity Style Conversational Assistant Container */}
          <div className="flex flex-col h-[calc(100dvh-13.5rem)] sm:h-[calc(100vh-250px)] min-h-[460px] max-h-[820px] rounded-3xl border border-[#cfe1f0] dark:border-slate-800 bg-[#f0f5fa] dark:bg-[#08121e] shadow-lg overflow-hidden transition-all">
            {/* Chat Header */}
            <div className="px-3 py-2 sm:px-4 sm:py-3 border-b border-[#cfe1f0] dark:border-slate-800 bg-[#e3eef7] dark:bg-[#0b1626] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-xl bg-gradient-to-tr from-red-600 to-rose-500 flex items-center justify-center text-white shadow-sm shrink-0">
                  <Bot size={16} />
                </div>
                <div className="min-w-0 flex items-center gap-1.5">
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                    RescueMemory Assistant
                  </h2>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-300 border border-emerald-300/80 dark:border-emerald-700/60 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Offline
                  </span>
                </div>
                </div>

              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* Clear chat button */}
                <button
                  type="button"
                  onClick={clearChat}
                  title="Reset conversation"
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl border border-[#cbdbe9] dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 transition-colors font-semibold"
                >
                  <Trash2 size={13} />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {/* Scrollable Message History Area */}
            <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-3.5 sm:space-y-4 bg-[#edf4fa] dark:bg-[#07111e]/70">
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
                      className={`transition-all ${
                        isUser
                          ? 'user-chat-bubble max-w-[85%] sm:max-w-[70%] rounded-2xl p-3.5 sm:p-4 shadow-md bg-gradient-to-r from-sky-600 via-cyan-600 to-blue-600 text-white rounded-tr-xs ml-auto ring-1 ring-white/20'
                          : 'chat-assistant-bubble max-w-[92%] sm:max-w-[80%] rounded-2xl p-3.5 sm:p-4 shadow-sm bg-white dark:bg-gradient-to-b dark:from-[#0d172b] dark:to-[#081120] border border-[#d3e3f0] dark:border-cyan-500/15 text-slate-900 dark:text-slate-100 rounded-tl-xs'
                      }`}
                    >
                      {/* Header meta */}
                      <div className="flex items-center justify-between gap-3 mb-1.5 text-[11px] opacity-90">
                        <span className={`font-semibold flex items-center gap-1.5 ${isUser ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`}>
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
                        <span className={`font-mono text-[10px] ${isUser ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>
                          {msg.timestamp ? formatTime(msg.timestamp) : ''}
                        </span>
                      </div>

                      {/* Message Body with rich Markdown parsing */}
                      <div className={isUser ? 'text-sm text-white font-medium whitespace-pre-wrap' : 'text-sm text-slate-900 dark:text-slate-100'}>
                        {isUser ? (
                          <span className="text-white font-semibold text-[13.5px] leading-relaxed block">{msg.text}</span>
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
                          <div className="flex flex-col sm:flex-row gap-2">
                            <button
                              onClick={() => saveSosToLocalDatabase(msg.suggested_action?.auto_report?.text || msg.suggested_action?.prefill || msg.text)}
                              disabled={savingSos || sosSuccess}
                              className={`flex-1 py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-2 text-xs transition-all active:scale-98 ${
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
                            <button
                              type="button"
                              onClick={() => followAction(msg.suggested_action)}
                              className="py-2.5 px-3.5 rounded-xl border border-red-300 dark:border-red-700 bg-white/80 dark:bg-red-900/30 text-red-800 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/50 text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                            >
                              <span>Review SOS Form</span>
                              <ArrowRight size={13} />
                            </button>
                          </div>
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

            {/* Quick Emergency Prompt Chips with Side Arrow Toggle in Same Row */}
            <div className="px-2.5 sm:px-3.5 py-1.5 border-t border-[#cfe1f0] dark:border-slate-800 bg-[#e3eef7]/80 dark:bg-[#0b1626]/80 flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowQuickPrompts(!showQuickPrompts)}
                className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-extrabold transition-all active:scale-95 cursor-pointer border ${
                  showQuickPrompts
                    ? 'bg-cyan-600 text-white border-cyan-500 shadow-xs'
                    : 'bg-[#dce8f3] dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-[#cbdbe9] dark:border-slate-700 hover:bg-[#d0e0ec] dark:hover:bg-slate-700'
                }`}
                title={showQuickPrompts ? 'Hide quick emergency queries' : 'Show quick emergency queries'}
              >
                <Zap size={12} className={showQuickPrompts ? 'text-amber-300' : 'text-amber-500'} />
                <span>Quick</span>
                <ChevronRight size={12} className={`transition-transform duration-200 ${showQuickPrompts ? 'rotate-90' : ''}`} />
              </button>

              {showQuickPrompts ? (
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 touch-pan-x flex-1 animate-in fade-in slide-in-from-left-2 duration-150">
                  {QUICK_PROMPTS.map((q) => {
                    const Icon = q.icon;
                    return (
                      <button
                        type="button"
                        key={q.text}
                        onClick={() => handleQuickPrompt(q.text)}
                        className={`shrink-0 text-[11px] py-1 px-2.5 rounded-full border flex items-center gap-1 font-bold transition-all active:scale-95 touch-manipulation whitespace-nowrap ${
                          q.urgent
                            ? 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 hover:bg-red-100'
                            : 'border-[#cbdbe9] dark:border-slate-800 bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 hover:bg-[#edf5fb]'
                        }`}
                      >
                        <Icon size={11} className={q.urgent ? 'text-red-600 dark:text-red-400' : 'text-cyan-600 dark:text-cyan-400'} />
                        <span>{q.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span
                  onClick={() => setShowQuickPrompts(true)}
                  className="text-[11px] text-slate-500 dark:text-slate-400 truncate cursor-pointer hover:text-cyan-600 dark:hover:text-cyan-400 select-none flex-1 font-medium"
                >
                  Emergency prompts (can't walk, bleeding, safe water)...
                </span>
              )}
            </div>

            {/* Collapsible Clinical Triage & Improvised Materials Bar */}
            <div className="border-t border-[#cfe1f0] dark:border-slate-800 bg-[#e3eef7] dark:bg-[#0b1626] shrink-0">
              <div className="px-3 sm:px-4 py-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setTriageOpen(!triageOpen)}
                  className="flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-rose-400 hover:text-red-900 transition-colors"
                >
                  <HeartPulse size={14} className="animate-pulse text-red-600" />
                  <span>Clinical Casualty Triage & Materials</span>
                  <ChevronDown size={13} className={`transition-transform duration-200 ${triageOpen ? 'rotate-180' : ''}`} />
                </button>
                <div className="flex items-center gap-2">
                  {selectedMaterials.length > 0 && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 font-bold">
                      {selectedMaterials.length} Mat{selectedMaterials.length > 1 ? 's' : ''} Active
                    </span>
                  )}
                  {bleedingType === 'spurting' && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-600 text-white font-bold animate-pulse">
                      ARTERIAL BLEED
                    </span>
                  )}
                  {!breathingStatus && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-600 text-white font-bold animate-pulse">
                      CPR NEEDED
                    </span>
                  )}
                </div>
              </div>

              {triageOpen && (
                <div className="px-3.5 sm:px-5 py-3 border-t border-[#cfe1f0] dark:border-slate-800 bg-[#edf5fc] dark:bg-[#07111e] space-y-3 animate-in fade-in">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Breathing state */}
                    <div>
                      <span className="block text-[10px] uppercase font-bold text-slate-700 dark:text-slate-400 mb-1 tracking-wider">
                        1. Casualty Breathing:
                      </span>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setBreathingStatus(true)}
                          className={`py-1.5 px-2.5 rounded-lg border text-xs font-bold transition-all ${
                            breathingStatus
                              ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
                              : 'bg-white dark:bg-slate-900 border-[#cbdbe9] dark:border-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          Breathing Normally
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setBreathingStatus(false);
                            setText("Unresponsive casualty not breathing in rubble, need immediate CPR");
                          }}
                          className={`py-1.5 px-2.5 rounded-lg border text-xs font-bold transition-all ${
                            !breathingStatus
                              ? 'bg-red-600 text-white border-red-500 shadow-xs'
                              : 'bg-white dark:bg-slate-900 border-[#cbdbe9] dark:border-slate-800 text-red-700 dark:text-red-400'
                          }`}
                        >
                          NOT Breathing (CPR)
                        </button>
                      </div>
                    </div>

                    {/* Bleeding status */}
                    <div>
                      <span className="block text-[10px] uppercase font-bold text-slate-700 dark:text-slate-400 mb-1 tracking-wider">
                        2. Bleeding Severity:
                      </span>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          ['none', 'No Bleed'],
                          ['venous', 'Venous Trickle'],
                          ['spurting', 'Arterial / Spurting']
                        ].map(([val, lbl]) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => {
                              setBleedingType(val);
                              if (val === 'spurting' && !text.includes('spurting')) {
                                setText("Severe arterial bleeding from leg, blood spurting under pressure");
                              }
                            }}
                            className={`py-1.5 px-1.5 rounded-lg border text-[11px] font-bold transition-all ${
                              bleedingType === val
                                ? val === 'spurting'
                                ? 'bg-red-600 text-white border-red-500 shadow-xs'
                                : val === 'venous'
                                ? 'bg-amber-600 text-white border-amber-500 shadow-xs'
                                : 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
                                : 'bg-white dark:bg-slate-900 border-[#cbdbe9] dark:border-slate-800 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Improvised Materials selection */}
                  <div>
                    <span className="block text-[10px] uppercase font-bold text-slate-700 dark:text-slate-400 mb-1 tracking-wider">
                      3. Available Improvised Materials on Hand (Adaptive AI Reranking):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ['stick', 'Rigid Stick / Splint'],
                        ['cloth', 'Clean Cloth / Shirt'],
                        ['belt', 'Belt / Tourniquet Strap'],
                        ['water', 'Clean Water Bottle'],
                        ['plastic', 'Plastic Wrap / Bag']
                      ].map(([id, label]) => {
                        const isSelected = selectedMaterials.includes(id);
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => {
                              setSelectedMaterials((prev) =>
                                isSelected ? prev.filter((m) => m !== id) : [...prev, id]
                              );
                            }}
                            className={`text-[11px] py-1 px-2.5 rounded-lg border font-bold transition-all ${
                              isSelected
                                ? 'bg-cyan-600 text-white border-cyan-500 shadow-xs'
                                : 'bg-white dark:bg-slate-900 border-[#cbdbe9] dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-cyan-400'
                            }`}
                          >
                            {isSelected ? '✓ ' : '+ '}{label}
                          </button>
                        );
                      })}
                      {selectedMaterials.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedMaterials([])}
                          className="text-[10px] text-slate-500 hover:text-red-600 underline font-semibold ml-1 self-center"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Minimal Input Box */}
            <div className="p-2 sm:p-2.5 border-t border-[#cfe1f0] dark:border-slate-800 bg-[#e3eef7] dark:bg-[#0b1626] shrink-0 pb-safe">
              <form onSubmit={onFormSubmit} className="relative flex items-center gap-1.5 sm:gap-2">
                {/* Voice speech-to-text mic trigger */}
                <button
                  type="button"
                  onClick={toggleSpeechRecognition}
                  title={isListening ? "Listening... click to stop" : "Voice input (Dictate emergency)"}
                  className={`p-2.5 rounded-xl border transition-all shrink-0 active:scale-95 touch-manipulation ${
                    isListening
                      ? 'bg-red-600 text-white border-red-500 animate-pulse shadow-md shadow-red-600/40'
                      : 'bg-[#dce8f3] dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-[#cbdbe9] dark:border-slate-700 hover:bg-[#d0e0ec] dark:hover:bg-slate-700'
                  }`}
                >
                  <Mic size={16} />
                </button>

                {/* Shaded Input text bar */}
                <input
                  type="text"
                  className="flex-1 bg-[#f8fafc] dark:bg-slate-900 border-2 border-[#cbd5e1] dark:border-slate-700 rounded-xl px-3.5 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-500 shadow-inner focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all font-medium"
                  placeholder="Ask emergency question (e.g. Can't walk, severe bleeding, safe water)..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={chatBusy}
                />

                {/* Inline Cloud AI Toggle Button */}
                <button
                  type="button"
                  onClick={() => setUseAi(!useAi)}
                  title={useAi ? "Cloud AI ON (Gemini). Tap to disable" : "Offline Mode ON (Local Qdrant). Tap to enable Cloud AI"}
                  className={`p-2 sm:py-2 sm:px-2.5 rounded-xl border text-xs font-extrabold flex items-center gap-1 transition-all active:scale-95 shrink-0 cursor-pointer ${
                    useAi
                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
                      : 'bg-[#dce8f3] dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-[#cbdbe9] dark:border-slate-700 hover:bg-[#d0e0ec]'
                  }`}
                >
                  <Sparkles size={14} className={useAi ? 'text-amber-200 animate-pulse' : 'text-slate-400'} />
                  <span className="hidden sm:inline text-[10px] uppercase font-bold">{useAi ? 'Cloud' : 'Local'}</span>
                </button>

                {/* Send button */}
                <button
                  type="submit"
                  disabled={chatBusy || !text.trim()}
                  className="p-2 sm:p-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold transition-all active:scale-95 shrink-0 shadow-md shadow-red-600/30 touch-manipulation cursor-pointer"
                >
                  <Send size={16} />
                </button>
              </form>
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
          onRefreshGps={useGps}
          selectedTarget={selected || nearestCasualty}
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
      {/* TAB 3: EMERGENCY SOS ACTION CENTER (Ultra-Clean & Panic-Proof) */}
      {/* ========================================================================= */}
      {tab === 'report' && (
        <div className="max-w-2xl mx-auto space-y-4">
          <Card
            title="Emergency SOS Broadcast"
          >
            {/* 4 Clear High-Contrast Emergency Situation Tiles */}
            <div className="mb-4">
              <label className="block text-xs text-slate-700 dark:text-slate-300 font-bold uppercase tracking-wider mb-2">
                Emergency Type:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {EMERGENCY_TYPES.map((type) => {
                  const isSelected = selectedEmergencyType === type.id;
                  const TypeIcon = type.icon;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => {
                        setSelectedEmergencyType(type.id);
                        setReport({
                          ...report,
                          kind: type.kind,
                          text: type.defaultText,
                          severity: type.severity,
                          visibility: type.visibility
                        });
                      }}
                      className={`p-3.5 rounded-2xl border text-left transition-all active:scale-[0.98] cursor-pointer ${
                        isSelected
                          ? type.selectedStyle
                          : 'border-[#dbe6f0] dark:border-slate-800 bg-[#f8fafc] dark:bg-[#0b1322]/80 hover:bg-[#edf5fb] dark:hover:bg-[#0f1b2d] hover:border-[#cbdbe9] dark:hover:border-slate-700 text-slate-800 dark:text-slate-300 shadow-xs'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 mb-1">
                        <div className={`p-2 rounded-xl border ${type.badgeBg}`}>
                          <TypeIcon size={18} />
                        </div>
                        <span className="font-extrabold text-sm text-slate-900 dark:text-white tracking-tight">{type.title}</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-1 leading-tight ml-0.5 font-medium">
                        {type.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Editable Description & Broadcast Form */}
            <form onSubmit={submitReport} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-700 dark:text-slate-300 font-bold uppercase tracking-wider">
                    Situation Details:
                  </label>
                </div>
                <textarea
                  className="field min-h-20 w-full text-sm font-sans"
                  value={report.text}
                  onChange={(e) => setReport({ ...report, text: e.target.value })}
                  required
                  minLength={3}
                  placeholder="Describe emergency situation or specific injuries..."
                />
              </div>

              {/* Real-time GPS Location Status Badge */}
              <div className="rounded-xl bg-[#eef6fb] dark:bg-[#07111e] border border-cyan-400/40 p-2.5 text-xs text-slate-800 dark:text-slate-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></span>
                  <span className="font-mono text-cyan-950 dark:text-cyan-300 font-bold">
                    Location: {pin.lat.toFixed(3)}, {pin.lon.toFixed(3)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={useGps}
                  className="text-cyan-700 dark:text-cyan-400 hover:text-cyan-900 dark:hover:text-cyan-300 text-xs font-bold flex items-center gap-1 transition-colors"
                >
                  <Cross size={12} /> Update
                </button>
              </div>

              {/* Optional Collapsed Accordion for Severity, Scope & Map Crosshair */}
              <div className="pt-2 border-t border-[#dbe6f0] dark:border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setShowSosDetails(!showSosDetails)}
                  className="w-full py-2.5 px-3.5 rounded-xl bg-[#edf4f9] dark:bg-slate-900/60 hover:bg-[#e2edf6] dark:hover:bg-slate-800/70 border border-[#d2e2ef] dark:border-slate-800 text-slate-800 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-200 text-xs font-bold flex items-center justify-between transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <MapPin size={15} className="text-cyan-600 dark:text-cyan-400" />
                    <span>Optional: Customize Severity, Visibility & Map Pin</span>
                  </span>
                  <ChevronDown size={15} className={`transition-transform duration-200 ${showSosDetails ? 'rotate-180' : ''}`} />
                </button>

                {showSosDetails && (
                  <div className="mt-3 space-y-3.5 p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#07111e]/90 border border-[#dbe6f0] dark:border-slate-800 animate-in fade-in">
                    {/* Severity Level Buttons */}
                    <div>
                      <label className="block text-[11px] text-slate-700 dark:text-slate-400 font-bold uppercase tracking-wider mb-1.5">
                        Severity Level
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'red', label: 'Urgent / Threat', icon: AlertOctagon, activeClass: 'border-red-500 bg-red-600 text-white' },
                          { id: 'yellow', label: 'Attention Needed', icon: TriangleAlert, activeClass: 'border-amber-500 bg-amber-600 text-white' },
                          { id: 'green', label: 'Informational', icon: ShieldCheck, activeClass: 'border-emerald-500 bg-emerald-600 text-white' }
                        ].map((s) => {
                          const SIcon = s.icon;
                          const isSel = report.severity === s.id;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => setReport({ ...report, severity: s.id })}
                              className={`p-2 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                                isSel ? s.activeClass : 'border-[#cbdbe9] dark:border-slate-800 bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-400 hover:bg-[#edf5fb] dark:hover:bg-slate-800'
                              }`}
                            >
                              <SIcon size={13} />
                              <span>{s.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Visibility Scope */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-[11px] text-slate-700 dark:text-slate-400 font-bold uppercase tracking-wider">
                          Visibility Scope
                        </label>
                        {report.kind === 'incident' && (
                          <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <ShieldAlert size={11} /> Locked to Responders
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setReport({ ...report, visibility: 'responders' })}
                          className={`p-2.5 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                            report.visibility === 'responders'
                              ? 'border-cyan-500 bg-cyan-600 text-white shadow-sm'
                              : 'border-[#cbdbe9] dark:border-slate-800 bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-400 hover:bg-[#edf5fb] dark:hover:bg-slate-800'
                          }`}
                        >
                          <ShieldAlert size={14} />
                          <span>Responders Only</span>
                        </button>
                        <button
                          type="button"
                          disabled={report.kind === 'incident'}
                          onClick={() => setReport({ ...report, visibility: 'public' })}
                          title={report.kind === 'incident' ? 'Medical/Trapped SOS is restricted to verified Responders to protect victim privacy and safety.' : 'Broadcast publicly to all mesh nodes'}
                          className={`p-2.5 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                            report.kind === 'incident'
                              ? 'opacity-40 cursor-not-allowed border-slate-200 dark:border-slate-900 bg-slate-100 dark:bg-slate-950 text-slate-400 dark:text-slate-600'
                              : report.visibility === 'public'
                              ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm'
                              : 'border-[#cbdbe9] dark:border-slate-800 bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-400 hover:bg-[#edf5fb] dark:hover:bg-slate-800'
                          }`}
                        >
                          <Wifi size={14} />
                          <span>Public Mesh</span>
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                        {report.kind === 'incident'
                          ? '🔒 Responders Only: Protects sensitive casualty and trapped victim locations from unauthenticated airwaves. Sent exclusively to Volunteer & Command HQ triage. (To share publicly on mesh, select "Route Hazard" or "Water & Supplies").'
                          : '🌐 Public Mesh: Broadcasts openly across all nearby devices for public community awareness.'}
                      </p>
                    </div>

                    {/* Interactive Map Crosshair */}
                    <div className="pt-1">
                      <label className="block text-[11px] text-slate-700 dark:text-slate-400 font-bold uppercase tracking-wider mb-1.5">
                        Tap Map to Place Location Pin
                      </label>
                      <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
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
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Big Panic-Proof 1-Tap SOS Broadcast Button (Placed after options for logical flow) */}
              <button
                type="submit"
                disabled={savingSos}
                className="btn-sos-broadcast w-full py-4 px-4 rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-red-700 hover:from-red-500 hover:to-rose-600 text-white font-black text-sm sm:text-base tracking-wide shadow-xl shadow-red-700/40 flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                <AlertOctagon size={20} className="shrink-0 animate-pulse text-white" />
                <span className="text-white uppercase truncate">
                  {savingSos ? 'Broadcasting to Mesh…' : 'Broadcast Emergency SOS Now'}
                </span>
                <ArrowRight size={18} className="shrink-0 text-white" />
              </button>

              {/* Active Local SOS Broadcast Status */}
              {sosSuccess && (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-950 dark:text-emerald-200 text-xs space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between font-bold">
                    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 size={16} /> SOS Active in Local Mesh Memory
                    </span>
                    <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                      {report.visibility === 'responders' ? 'Responders Only' : 'Public Mesh'}
                    </span>
                  </div>
                  <div className="bg-white/70 dark:bg-black/30 p-2.5 rounded-xl font-mono text-[11px] leading-relaxed text-slate-800 dark:text-slate-200 border border-emerald-500/20">
                    "{report.text}"
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                    <span>Receiver Target: {report.visibility === 'responders' ? 'Field Volunteers & Central HQ' : 'All Nearby Mesh Nodes'}</span>
                    <span>GPS: {pin.lat.toFixed(4)}, {pin.lon.toFixed(4)}</span>
                  </div>
                </div>
              )}
            </form>
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
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#f4f8fb]/95 dark:bg-[#0a1324]/95 border-t border-[#dbe6f0] dark:border-slate-700/80 backdrop-blur-xl pb-safe shadow-2xl">
        <div className="grid grid-cols-4 h-16">
          {TABS.map(([id, label, Icon]) => {
            const isActive = tab === id;
            const activeColors = {
              ask: 'text-cyan-600 dark:text-cyan-400',
              map: 'text-emerald-600 dark:text-emerald-400',
              report: 'text-rose-600 dark:text-rose-500',
              beacon: 'text-sky-600 dark:text-sky-400'
            };
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
                  isActive ? `${activeColors[id]} font-black` : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <div className="relative">
                  <Icon size={20} className={isActive ? 'stroke-[2.5]' : 'stroke-[1.8]'} />
                  {id === 'map' && (nearestCasualty || peers.length > 0) && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  )}
                  {id === 'beacon' && peers.length > 0 && (
                    <span className="absolute -top-1 -right-1.5 w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping" />
                  )}
                </div>
                <span className="text-[10px] tracking-tight font-bold">{label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </Shell>
  );
}
