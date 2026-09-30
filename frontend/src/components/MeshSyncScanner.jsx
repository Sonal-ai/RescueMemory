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
import { getDiscoveredPeers, syncDiscoveredPeer, setting, triggerAutoSync } from '../api';

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

  // Scan and transfer data to all discovered peers (supports silent auto-run)
  const handleScanAndTransfer = useCallback(async (isSilent = false) => {
    if (!isSilent) {
      setSyncingAll(true);
      setScanning(true);
      setStatusMessage('');
      setErrorMessage('');
    }

    try {
      // 1. Flush local IndexedDB reports to Edge Hub/Cloud
      let localFlushed = 0;
      let remoteImported = 0;
      try {
        const syncRes = await triggerAutoSync();
        localFlushed = syncRes?.synced || 0;
        remoteImported = syncRes?.imported || 0;
      } catch (syncErr) {
        console.warn('[MeshSync] Outbox flush notice:', syncErr);
      }

      // 2. Discover nearby peers
      const scanRes = await getDiscoveredPeers();
      const currentPeers = scanRes?.peers || [];
      setPeers(currentPeers);

      // Check configured peer URL in settings (e.g. hotspot IP)
      const configuredPeer = setting('peerUrl');
      const allPeers = [...currentPeers];
      if (configuredPeer && !allPeers.some(p => p.url === configuredPeer || `http://${p.ip}:${p.port}` === configuredPeer)) {
        allPeers.push({
          node_id: 'hotspot_peer',
          url: configuredPeer,
          role: 'survivor'
        });
      }

      if (!isSilent) {
        await new Promise(r => setTimeout(r, 800));
      }

      let successCount = 0;
      for (const peer of allPeers) {
        try {
          await syncDiscoveredPeer({
            peer_url: peer.url || (peer.ip ? `http://${peer.ip}:${peer.port}` : null),
            scope: 'public'
          });
          successCount++;
        } catch (peerErr) {
          console.warn(`Sync with ${peer.node_id} notice:`, peerErr?.message);
        }
      }

      if (allPeers.length > 0) {
        setStatusMessage(`✅ Auto-Mesh Active: Connected to ${allPeers.length} device(s)${localFlushed > 0 ? ` · Uplinked ${localFlushed} SOS` : ''}${remoteImported > 0 ? ` · Received ${remoteImported} reports` : ''}`);
        if (onSyncComplete) onSyncComplete();
      } else {
        setStatusMessage(localFlushed > 0
          ? `✅ Synced ${localFlushed} report(s) to central cloud. Scanning for nearby devices...`
          : '📡 Mesh radar active & scanning for devices automatically every 6s...'
        );
      }
    } catch (err) {
      if (!isSilent) setErrorMessage(`Sync notice: ${err.message || 'Network error'}`);
    } finally {
      if (!isSilent) {
        setSyncingAll(false);
        setScanning(false);
      }
    }
  }, [onSyncComplete]);

  // Automated background sync interval: runs on mount and every 6 seconds
  useEffect(() => {
    handleScanAndTransfer(true);
    const interval = setInterval(() => {
      handleScanAndTransfer(true);
    }, 6000);
    return () => clearInterval(interval);
  }, [handleScanAndTransfer]);

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
    <div className="flex flex-col gap-2.5 sm:gap-3 text-slate-900 dark:text-slate-100 max-w-2xl mx-auto w-full">
      {/* Sleek Minimal Header */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-3.5 shadow-xs flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-cyan-600 to-emerald-600 flex items-center justify-center text-white shadow-sm shrink-0">
            <Radio size={15} className={scanning || syncingAll ? 'animate-spin' : ''} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <span>Mesh Sync</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </h2>
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                AUTO-SYNC ACTIVE (6s)
              </span>
            </div>
            <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
              Automatic background device discovery & real-time report exchange.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={refreshPeersList}
          disabled={scanning}
          className="p-1.5 rounded-lg border border-[#cbdbe9] dark:border-slate-800 bg-[#f0f5fa] dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-[#e2ecf5] dark:hover:bg-slate-800 transition-colors shrink-0"
          title="Search again"
        >
          <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Alert Notifications */}
      {statusMessage && (
        <div className="p-2.5 rounded-xl border border-emerald-300 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 text-xs flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
            <span>{statusMessage}</span>
          </div>
          <button onClick={() => setStatusMessage('')} className="text-[11px] underline font-semibold ml-2">Dismiss</button>
        </div>
      )}

      {errorMessage && (
        <div className="p-2.5 rounded-xl border border-red-300 dark:border-red-800/80 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 text-xs flex items-center justify-between shadow-xs">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="text-[11px] underline font-semibold ml-2">Dismiss</button>
        </div>
      )}

      {/* Visual Scanner & Action Button */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs flex flex-col items-center">
        {/* Minimal Radar Scanner SVG */}
        <div className="relative w-[210px] h-[210px] sm:w-[240px] sm:h-[240px] flex items-center justify-center my-0.5">
          <svg
            viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
            className="w-full h-full select-none drop-shadow-md"
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
        <div className="w-full max-w-sm mt-2.5 sm:mt-3">
          <button
            type="button"
            onClick={handleScanAndTransfer}
            disabled={syncingAll}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs sm:text-sm shadow-md shadow-emerald-600/25 flex items-center justify-center gap-1.5 transition-all active:scale-98 disabled:opacity-75 cursor-pointer"
          >
            {syncingAll ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Syncing Data…</span>
              </>
            ) : (
              <>
                <Zap size={14} />
                <span>Sync Nearby Devices {peers.length > 0 ? `(${peers.length})` : ''}</span>
              </>
            )}
          </button>
          <p className="text-[10px] text-center text-slate-500 dark:text-slate-400 mt-1.5 font-medium">
            Automatic background sync active · Tap for instant sweep & sync
          </p>
        </div>
      </div>

      {/* Discovered Devices List */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-3.5 shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Wifi size={13} className="text-emerald-500" />
            <span>Nearby Devices ({peers.length})</span>
          </h3>
        </div>

        {peers.length > 0 ? (
          <div className="space-y-1.5 sm:space-y-2">
            {peers.map((peer, idx) => {
              const isVol = peer.role === 'volunteer' || peer.role === 'central';
              const isSyncingThis = syncingNodeId === peer.node_id;

              return (
                <div
                  key={peer.node_id || idx}
                  className="p-2 sm:p-2.5 rounded-xl border border-[#dbe6f0] dark:border-slate-800 bg-[#f8fafc] dark:bg-slate-900/60 flex items-center justify-between gap-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${peer.is_online !== false ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      <span className="font-bold text-slate-900 dark:text-slate-100 text-xs truncate">
                        {peer.node_id || `Device ${idx + 1}`}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
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
                    className="py-1 px-2.5 rounded-lg border border-cyan-500/50 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-bold text-[11px] flex items-center gap-1 transition-all shrink-0 active:scale-95"
                  >
                    {isSyncingThis ? (
                      <RefreshCw size={11} className="animate-spin" />
                    ) : (
                      <Zap size={11} />
                    )}
                    <span>Sync</span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-3.5 sm:p-4 rounded-xl border border-dashed border-[#cbdbe9] dark:border-slate-800 text-center bg-[#f8fafc]/60 dark:bg-slate-900/30">
            <Radio size={18} className="mx-auto text-slate-400 mb-1 animate-pulse" />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
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
          className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 font-medium inline-flex items-center gap-1 py-0.5 cursor-pointer"
        >
          <span>Advanced connection</span>
          {showManualConnect ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>

        {showManualConnect && (
          <div className="mt-1.5 bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-xl p-2.5 shadow-xs text-left animate-in fade-in">
            <form onSubmit={handleDirectIpSync} className="flex gap-2">
              <input
                type="text"
                className="field flex-1 text-xs py-1.5 px-2.5"
                placeholder="Device IP or URL (e.g. 192.168.43.12:8001)"
                value={directIp}
                onChange={(e) => setDirectIp(e.target.value)}
              />
              <button
                type="submit"
                disabled={!directIp.trim() || syncingAll}
                className="py-1.5 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-1 shrink-0 transition-all"
              >
                <Send size={11} />
                <span>Connect</span>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
