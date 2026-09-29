import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Radio,
  RefreshCw,
  Send,
  Wifi,
  Zap
} from 'lucide-react';
import { getDiscoveredPeers, syncDiscoveredPeer } from '../api';

const GRID_SIZE = 260;
const GRID_CENTER = GRID_SIZE / 2;
const MAX_RADIUS = 105;

export default function MeshSyncScanner({
  initialPeers = [],
  onSyncComplete = null
}) {
  const [peers, setPeers] = useState(initialPeers);
  const [scanning, setScanning] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingNodeId, setSyncingNodeId] = useState(null);
  const [directIp, setDirectIp] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showManualConnect, setShowManualConnect] = useState(false);

  const refreshPeersList = useCallback(async () => {
    setScanning(true);
    setErrorMessage('');
    try {
      const res = await getDiscoveredPeers();
      if (res?.peers) {
        setPeers(res.peers);
      }
    } catch {
      // offline silent
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    refreshPeersList();
    const interval = setInterval(refreshPeersList, 8000);
    return () => clearInterval(interval);
  }, [refreshPeersList]);

  // Scan and transfer data to all discovered peers
  const handleScanAndTransfer = async () => {
    setSyncingAll(true);
    setStatusMessage('');
    setErrorMessage('');

    try {
      const scanRes = await getDiscoveredPeers();
      const currentPeers = scanRes?.peers || peers;
      setPeers(currentPeers);

      if (!currentPeers || currentPeers.length === 0) {
        setStatusMessage('No nearby devices found yet. Connect phones to the same Wi-Fi or hotspot to sync.');
        return;
      }

      let successCount = 0;
      for (const peer of currentPeers) {
        try {
          await syncDiscoveredPeer({
            peer_url: peer.url || `http://${peer.ip}:${peer.port}`,
            scope: 'public'
          });
          successCount++;
        } catch (peerErr) {
          console.warn(`Sync with ${peer.node_id} failed:`, peerErr);
        }
      }

      if (successCount > 0) {
        setStatusMessage(`✅ Synced emergency data with ${successCount} nearby device(s).`);
        if (onSyncComplete) onSyncComplete();
      } else {
        setErrorMessage('Could not connect to nearby devices. Check Wi-Fi or hotspot connection.');
      }
    } catch (err) {
      setErrorMessage(`Sync failed: ${err.message || 'Network error'}`);
    } finally {
      setSyncingAll(false);
    }
  };

  // Sync with a single specific peer
  const handleSyncSinglePeer = async (peer) => {
    setSyncingNodeId(peer.node_id);
    setStatusMessage('');
    setErrorMessage('');
    try {
      await syncDiscoveredPeer({
        peer_url: peer.url || `http://${peer.ip}:${peer.port}`,
        scope: 'public'
      });
      setStatusMessage(`✅ Synced data with ${peer.node_id}.`);
      if (onSyncComplete) onSyncComplete();
    } catch (err) {
      setErrorMessage(`Sync with ${peer.node_id} failed.`);
    } finally {
      setSyncingNodeId(null);
    }
  };

  // Direct manual IP sync
  const handleDirectIpSync = async (e) => {
    e.preventDefault();
    if (!directIp.trim()) return;
    let url = directIp.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }

    setSyncingAll(true);
    setStatusMessage('');
    setErrorMessage('');
    try {
      await syncDiscoveredPeer({
        peer_url: url,
        scope: 'public'
      });
      setStatusMessage(`✅ Connected and synced with ${url}.`);
      setDirectIp('');
      if (onSyncComplete) onSyncComplete();
    } catch (err) {
      setErrorMessage(`Connection failed: ${err.message || 'Device unreachable'}`);
    } finally {
      setSyncingAll(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 text-slate-900 dark:text-slate-100 max-w-2xl mx-auto w-full">
      {/* Sleek Minimal Header */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xs flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-600 flex items-center justify-center text-white shadow-sm shrink-0">
            <Radio size={18} className={scanning || syncingAll ? 'animate-spin' : ''} />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>Mesh Sync</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Sync emergency data with nearby devices without internet.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={refreshPeersList}
          disabled={scanning}
          className="p-2 rounded-xl border border-[#cbdbe9] dark:border-slate-800 bg-[#f0f5fa] dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-[#e2ecf5] dark:hover:bg-slate-800 transition-colors"
          title="Search again"
        >
          <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Alert Notifications */}
      {statusMessage && (
        <div className="p-3.5 rounded-2xl border border-emerald-300 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 text-xs sm:text-sm flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
            <span>{statusMessage}</span>
          </div>
          <button onClick={() => setStatusMessage('')} className="text-xs underline font-semibold ml-2">Dismiss</button>
        </div>
      )}

      {errorMessage && (
        <div className="p-3.5 rounded-2xl border border-red-300 dark:border-red-800/80 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 text-xs sm:text-sm flex items-center justify-between shadow-xs">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="text-xs underline font-semibold ml-2">Dismiss</button>
        </div>
      )}

      {/* Visual Scanner & Action Button */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-3xl p-5 shadow-xs flex flex-col items-center">
        {/* Minimal Radar Scanner SVG */}
        <div className="relative w-[260px] h-[260px] flex items-center justify-center my-1">
          <svg
            width={GRID_SIZE}
            height={GRID_SIZE}
            viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
            className="select-none drop-shadow-md"
          >
            <defs>
              <radialGradient id="meshSweepGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
              </radialGradient>
            </defs>

            {/* Background Disk */}
            <circle cx={GRID_CENTER} cy={GRID_CENTER} r={MAX_RADIUS + 10} fill="#060e1a" stroke="#1e293b" strokeWidth="1.5" />
            <circle cx={GRID_CENTER} cy={GRID_CENTER} r={MAX_RADIUS} fill="#091424" stroke="#0e7490" strokeWidth="1" />

            {/* Minimal Distance Rings */}
            {[0.33, 0.66, 1.0].map((ratio, idx) => (
              <circle
                key={idx}
                cx={GRID_CENTER}
                cy={GRID_CENTER}
                r={MAX_RADIUS * ratio}
                fill="none"
                stroke="#164e63"
                strokeWidth="1"
                strokeDasharray={idx === 2 ? 'none' : '2 3'}
              />
            ))}

            {/* Crosshair lines */}
            <line x1={GRID_CENTER - MAX_RADIUS} y1={GRID_CENTER} x2={GRID_CENTER + MAX_RADIUS} y2={GRID_CENTER} stroke="#164e63" strokeWidth="0.8" />
            <line x1={GRID_CENTER} y1={GRID_CENTER - MAX_RADIUS} x2={GRID_CENTER} y2={GRID_CENTER + MAX_RADIUS} stroke="#164e63" strokeWidth="0.8" />

            {/* Sweeping Radar Beam */}
            <g className="animate-[spin_4s_linear_infinite]" style={{ transformOrigin: `${GRID_CENTER}px ${GRID_CENTER}px` }}>
              <line
                x1={GRID_CENTER}
                y1={GRID_CENTER}
                x2={GRID_CENTER}
                y2={GRID_CENTER - MAX_RADIUS}
                stroke="#22d3ee"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d={`M ${GRID_CENTER} ${GRID_CENTER} L ${GRID_CENTER} ${GRID_CENTER - MAX_RADIUS} A ${MAX_RADIUS} ${MAX_RADIUS} 0 0 1 ${GRID_CENTER + MAX_RADIUS * 0.7} ${GRID_CENTER - MAX_RADIUS * 0.7} Z`}
                fill="url(#meshSweepGrad)"
              />
            </g>

            {/* Center Node (YOU) */}
            <circle cx={GRID_CENTER} cy={GRID_CENTER} r="14" fill="#06b6d4" opacity="0.2" />
            <circle cx={GRID_CENTER} cy={GRID_CENTER} r="6" fill="#06b6d4" stroke="#ffffff" strokeWidth="2" />
            <text x={GRID_CENTER} y={GRID_CENTER + 16} textAnchor="middle" fill="#22d3ee" fontSize="9" fontWeight="bold">
              You
            </text>

            {/* Plotted Discovered Peers */}
            {peers.map((peer, pIdx) => {
              const angle = (pIdx * (360 / Math.max(1, peers.length)) + 45) * (Math.PI / 180);
              const dist = Math.min(MAX_RADIUS - 15, Math.max(30, (peer.distance_m ? (peer.distance_m / 100) * MAX_RADIUS : 45 + pIdx * 20)));
              const px = GRID_CENTER + dist * Math.cos(angle);
              const py = GRID_CENTER + dist * Math.sin(angle);
              const isVol = peer.role === 'volunteer' || peer.role === 'central';
              const color = isVol ? '#10b981' : '#06b6d4';

              return (
                <g key={peer.node_id || pIdx} className="cursor-pointer" onClick={() => handleSyncSinglePeer(peer)}>
                  <circle cx={px} cy={py} r="14" fill="none" stroke={color} strokeWidth="1" strokeDasharray="2 2" className="animate-ping" opacity="0.6" />
                  <circle cx={px} cy={py} r="8" fill={color} opacity="0.25" />
                  <circle cx={px} cy={py} r="4.5" fill={color} stroke="#ffffff" strokeWidth="1.5" />
                  <text
                    x={px}
                    y={py - 7}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="9"
                    fontWeight="bold"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
                  >
                    {peer.node_id?.slice(-8) || `Device ${pIdx + 1}`}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Sync Button */}
        <div className="w-full max-w-sm mt-4">
          <button
            type="button"
            onClick={handleScanAndTransfer}
            disabled={syncingAll}
            className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-sm sm:text-base shadow-md shadow-emerald-600/25 flex items-center justify-center gap-2 transition-all active:scale-98 disabled:opacity-75 cursor-pointer"
          >
            {syncingAll ? (
              <>
                <RefreshCw size={17} className="animate-spin" />
                <span>Syncing Data…</span>
              </>
            ) : (
              <>
                <Zap size={17} />
                <span>Sync Nearby Devices {peers.length > 0 ? `(${peers.length})` : ''}</span>
              </>
            )}
          </button>
          <p className="text-[11px] text-center text-slate-500 dark:text-slate-400 mt-2 font-medium">
            Connects via local Wi-Fi or phone hotspot
          </p>
        </div>
      </div>

      {/* Discovered Devices List */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Wifi size={14} className="text-emerald-500" />
            <span>Nearby Devices ({peers.length})</span>
          </h3>
        </div>

        {peers.length > 0 ? (
          <div className="space-y-2.5">
            {peers.map((peer, idx) => {
              const isVol = peer.role === 'volunteer' || peer.role === 'central';
              const isSyncingThis = syncingNodeId === peer.node_id;

              return (
                <div
                  key={peer.node_id || idx}
                  className="p-3 rounded-2xl border border-[#dbe6f0] dark:border-slate-800 bg-[#f8fafc] dark:bg-slate-900/60 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${peer.is_online !== false ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      <span className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm truncate">
                        {peer.node_id || `Device ${idx + 1}`}
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        isVol
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                          : 'bg-cyan-100 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-300'
                      }`}>
                        {isVol ? 'Responder' : 'Survivor'}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSyncSinglePeer(peer)}
                    disabled={isSyncingThis || syncingAll}
                    className="py-1.5 px-3 rounded-xl border border-cyan-500/50 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-bold text-xs flex items-center gap-1 transition-all shrink-0 active:scale-95"
                  >
                    {isSyncingThis ? (
                      <RefreshCw size={12} className="animate-spin" />
                    ) : (
                      <Zap size={12} />
                    )}
                    <span>Sync</span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-5 rounded-2xl border border-dashed border-[#cbdbe9] dark:border-slate-800 text-center bg-[#f8fafc]/60 dark:bg-slate-900/30">
            <Radio size={22} className="mx-auto text-slate-400 mb-1.5 animate-pulse" />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No nearby devices found yet. Ensure both phones are on the same Wi-Fi or hotspot.
            </p>
          </div>
        )}
      </div>

      {/* Hidden Collapsible Manual Connection */}
      <div className="text-center">
        <button
          type="button"
          onClick={() => setShowManualConnect(!showManualConnect)}
          className="text-xs text-slate-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 font-medium inline-flex items-center gap-1 py-1 cursor-pointer"
        >
          <span>Advanced connection</span>
          {showManualConnect ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {showManualConnect && (
          <div className="mt-2 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3.5 shadow-xs text-left animate-in fade-in">
            <form onSubmit={handleDirectIpSync} className="flex gap-2">
              <input
                type="text"
                className="field flex-1 text-xs"
                placeholder="Device IP or URL (e.g. 192.168.43.12:8001)"
                value={directIp}
                onChange={(e) => setDirectIp(e.target.value)}
              />
              <button
                type="submit"
                disabled={!directIp.trim() || syncingAll}
                className="py-2 px-3.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-1 shrink-0 transition-all"
              >
                <Send size={12} />
                <span>Connect</span>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
