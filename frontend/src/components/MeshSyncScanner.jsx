import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Signal,
  Wifi,
  WifiOff,
  Zap
} from 'lucide-react';
import { getDiscoveredPeers, syncDiscoveredPeer } from '../api';

const GRID_SIZE = 300;
const GRID_CENTER = GRID_SIZE / 2;
const MAX_RADIUS = 125;

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
  const [lastScanTime, setLastScanTime] = useState(new Date());

  const refreshPeersList = useCallback(async () => {
    setScanning(true);
    setErrorMessage('');
    try {
      const res = await getDiscoveredPeers();
      if (res?.peers) {
        setPeers(res.peers);
      }
      setLastScanTime(new Date());
    } catch (err) {
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

  // Consistently scan and transfer data to all discovered peers
  const handleScanAndTransfer = async () => {
    setSyncingAll(true);
    setStatusMessage('');
    setErrorMessage('');

    try {
      // 1. Scan subnet for latest peers
      const scanRes = await getDiscoveredPeers();
      const currentPeers = scanRes?.peers || peers;
      setPeers(currentPeers);

      if (!currentPeers || currentPeers.length === 0) {
        setStatusMessage('Scanning complete: Broadcasted discovery packet on UDP port 8888. No other active devices on this Wi-Fi yet. Connect two phones to the same Wi-Fi / hotspot to sync.');
        return;
      }

      // 2. Sequentially sync with each discovered peer
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
        setStatusMessage(`✅ Successfully transferred and synced emergency data with ${successCount} nearby peer(s) over local Wi-Fi.`);
        if (onSyncComplete) onSyncComplete();
      } else {
        setErrorMessage('Discovered peers were unreachable. Verify Wi-Fi hotspot connectivity.');
      }
    } catch (err) {
      setErrorMessage(`Scan & Transfer failed: ${err.message}`);
    } finally {
      setSyncingAll(false);
      setLastScanTime(new Date());
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
      setStatusMessage(`✅ Successfully synced vector memory with ${peer.node_id}.`);
      if (onSyncComplete) onSyncComplete();
    } catch (err) {
      setErrorMessage(`Sync with ${peer.node_id} failed: ${err.message}`);
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
      setStatusMessage(`✅ Successfully transferred data directly with ${url}.`);
      setDirectIp('');
      if (onSyncComplete) onSyncComplete();
    } catch (err) {
      setErrorMessage(`Direct sync failed: ${err.message}`);
    } finally {
      setSyncingAll(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 text-slate-900 dark:text-slate-100">
      {/* Top Header */}
      <div className="bg-white dark:bg-[#0b1626] border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-600 flex items-center justify-center text-white shadow-md shadow-cyan-600/20 shrink-0">
            <Radio size={20} className={scanning || syncingAll ? 'animate-spin' : ''} />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>Mesh Sync & Beacon Scanner</span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                Zero-Conf LAN
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Automatic peer-to-peer discovery on UDP port 8888. No internet or setup required.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
          <Clock size={13} />
          <span>Last scan: {lastScanTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
      </div>

      {/* Alert Notifications */}
      {statusMessage && (
        <div className="p-4 rounded-2xl border border-emerald-300 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 text-xs sm:text-sm flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
            <span>{statusMessage}</span>
          </div>
          <button onClick={() => setStatusMessage('')} className="text-xs underline font-semibold ml-2">Dismiss</button>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 rounded-2xl border border-red-300 dark:border-red-800/80 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 text-xs sm:text-sm flex items-center justify-between shadow-sm">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="text-xs underline font-semibold ml-2">Dismiss</button>
        </div>
      )}

      {/* Tactical Radar Scan Grid Visual */}
      <div className="bg-white dark:bg-[#0b1626] border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col items-center">
        <div className="text-center mb-4">
          <span className="text-xs uppercase font-bold tracking-wider text-slate-600 dark:text-slate-300">
            Local Wi-Fi Subnet Radar Scan Grid
          </span>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Continuously sweeping LAN for responder nodes & survivor hotspots
          </p>
        </div>

        {/* Tactical Circular Radar Scanner SVG */}
        <div className="relative w-[300px] h-[300px] flex items-center justify-center">
          <svg
            width={GRID_SIZE}
            height={GRID_SIZE}
            viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
            className="select-none drop-shadow-xl"
          >
            <defs>
              {/* Radar Sweep Gradient */}
              <radialGradient id="radarSweepGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
              </radialGradient>
            </defs>

            {/* Dark background */}
            <circle cx={GRID_CENTER} cy={GRID_CENTER} r={MAX_RADIUS + 15} fill="#060e1a" stroke="#1e293b" strokeWidth="2" />
            <circle cx={GRID_CENTER} cy={GRID_CENTER} r={MAX_RADIUS} fill="#091424" stroke="#0e7490" strokeWidth="1" />

            {/* Concentric distance rings */}
            {[0.25, 0.5, 0.75, 1.0].map((ratio, idx) => (
              <circle
                key={idx}
                cx={GRID_CENTER}
                cy={GRID_CENTER}
                r={MAX_RADIUS * ratio}
                fill="none"
                stroke="#164e63"
                strokeWidth="1"
                strokeDasharray={idx === 3 ? 'none' : '3 3'}
              />
            ))}

            {/* Crosshair lines */}
            <line x1={GRID_CENTER - MAX_RADIUS} y1={GRID_CENTER} x2={GRID_CENTER + MAX_RADIUS} y2={GRID_CENTER} stroke="#164e63" strokeWidth="1" />
            <line x1={GRID_CENTER} y1={GRID_CENTER - MAX_RADIUS} x2={GRID_CENTER} y2={GRID_CENTER + MAX_RADIUS} stroke="#164e63" strokeWidth="1" />
            <line x1={GRID_CENTER - MAX_RADIUS * 0.7} y1={GRID_CENTER - MAX_RADIUS * 0.7} x2={GRID_CENTER + MAX_RADIUS * 0.7} y2={GRID_CENTER + MAX_RADIUS * 0.7} stroke="#0e3a4d" strokeWidth="0.8" strokeDasharray="2 4" />
            <line x1={GRID_CENTER - MAX_RADIUS * 0.7} y1={GRID_CENTER + MAX_RADIUS * 0.7} x2={GRID_CENTER + MAX_RADIUS * 0.7} y2={GRID_CENTER - MAX_RADIUS * 0.7} stroke="#0e3a4d" strokeWidth="0.8" strokeDasharray="2 4" />

            {/* Distance markings */}
            <text x={GRID_CENTER + 8} y={GRID_CENTER - MAX_RADIUS * 0.25} fill="#06b6d4" fontSize="8" fontFamily="monospace">15m</text>
            <text x={GRID_CENTER + 8} y={GRID_CENTER - MAX_RADIUS * 0.5} fill="#06b6d4" fontSize="8" fontFamily="monospace">35m</text>
            <text x={GRID_CENTER + 8} y={GRID_CENTER - MAX_RADIUS * 0.75} fill="#06b6d4" fontSize="8" fontFamily="monospace">70m</text>
            <text x={GRID_CENTER + 8} y={GRID_CENTER - MAX_RADIUS + 10} fill="#06b6d4" fontSize="8" fontFamily="monospace">120m</text>

            {/* Continuous Sweeping Radar Beam */}
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
                fill="url(#radarSweepGrad)"
              />
            </g>

            {/* Center Node (THIS SURVIVOR DEVICE) */}
            <circle cx={GRID_CENTER} cy={GRID_CENTER} r="16" fill="#06b6d4" opacity="0.15" />
            <circle cx={GRID_CENTER} cy={GRID_CENTER} r="8" fill="#06b6d4" stroke="#ffffff" strokeWidth="2" />
            <text x={GRID_CENTER} y={GRID_CENTER + 20} textAnchor="middle" fill="#22d3ee" fontSize="8" fontWeight="bold" fontFamily="monospace">
              YOU (SURVIVOR)
            </text>

            {/* Plotted Discovered Peers */}
            {peers.map((peer, pIdx) => {
              // Distribute peers evenly on circles if coordinates are missing
              const angle = (pIdx * (360 / Math.max(1, peers.length)) + 45) * (Math.PI / 180);
              const dist = Math.min(MAX_RADIUS - 15, Math.max(35, (peer.distance_m ? (peer.distance_m / 100) * MAX_RADIUS : 50 + pIdx * 25)));
              const px = GRID_CENTER + dist * Math.cos(angle);
              const py = GRID_CENTER + dist * Math.sin(angle);
              const isVol = peer.role === 'volunteer' || peer.role === 'central';
              const color = isVol ? '#10b981' : '#f59e0b';

              return (
                <g key={peer.node_id || pIdx} className="cursor-pointer" onClick={() => handleSyncSinglePeer(peer)}>
                  {/* Ping wave */}
                  <circle cx={px} cy={py} r="18" fill="none" stroke={color} strokeWidth="1" strokeDasharray="2 2" className="animate-ping" opacity="0.6" />
                  <circle cx={px} cy={py} r="10" fill={color} opacity="0.25" />
                  <circle cx={px} cy={py} r="5" fill={color} stroke="#ffffff" strokeWidth="1.5" />
                  <text
                    x={px}
                    y={py - 8}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="9"
                    fontWeight="bold"
                    fontFamily="monospace"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
                  >
                    {peer.node_id}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Hero Prominent "Scan LAN & Transfer Data" Action Button */}
        <div className="w-full max-w-md mt-5">
          <button
            type="button"
            onClick={handleScanAndTransfer}
            disabled={syncingAll}
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-black text-sm sm:text-base shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2.5 transition-all active:scale-98 disabled:opacity-75"
          >
            {syncingAll ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                <span>Scanning Subnet & Transferring Data…</span>
              </>
            ) : (
              <>
                <Zap size={18} />
                <span>Scan LAN & Transfer Data ({peers.length} in range)</span>
              </>
            )}
          </button>
          <p className="text-[11px] text-center text-slate-500 dark:text-slate-400 mt-2">
            1-tap peer exchange over Wi-Fi Direct or shared mobile hotspot (port 8888)
          </p>
        </div>
      </div>

      {/* Discovered Beacons / Peer Devices List */}
      <div className="bg-white dark:bg-[#0b1626] border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
            <Wifi size={16} className="text-emerald-500" />
            <span>Discovered Mesh Nodes ({peers.length})</span>
          </h3>
          <button
            type="button"
            onClick={refreshPeersList}
            disabled={scanning}
            className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline font-semibold flex items-center gap-1"
          >
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
            <span>Refresh Subnet</span>
          </button>
        </div>

        {peers.length > 0 ? (
          <div className="grid sm:grid-cols-2 gap-3.5">
            {peers.map((peer) => {
              const isVol = peer.role === 'volunteer' || peer.role === 'central';
              const isSyncingThis = syncingNodeId === peer.node_id;

              return (
                <div
                  key={peer.node_id}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 hover:border-cyan-500 dark:hover:border-cyan-500/80 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100 text-sm">
                        <span className={`w-2.5 h-2.5 rounded-full ${peer.is_online !== false ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                        <span>{peer.node_id}</span>
                      </div>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                        isVol ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800' : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                      }`}>
                        {peer.role || 'survivor'}
                      </span>
                    </div>

                    <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mb-2 truncate">
                      {peer.url || `http://${peer.ip || '127.0.0.1'}:${peer.port || 8001}`}
                    </p>

                    <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400 font-mono mb-3">
                      <span>Signal: {peer.distance_m != null ? `~${peer.distance_m}m` : 'Direct LAN'}</span>
                      {peer.seconds_ago != null && (
                        <span>Seen: {peer.seconds_ago}s ago</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSyncSinglePeer(peer)}
                    disabled={isSyncingThis || syncingAll}
                    className="w-full py-2.5 px-3 rounded-xl border border-cyan-500/50 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-98"
                  >
                    {isSyncingThis ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" />
                        <span>Transferring Data…</span>
                      </>
                    ) : (
                      <>
                        <Zap size={13} />
                        <span>Transfer Data with {peer.node_id}</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-6 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center bg-slate-50/50 dark:bg-slate-900/30">
            <Radio size={28} className="mx-auto text-slate-400 mb-2 animate-pulse" />
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
              No peer beacons found on this subnet yet. Connect to a mobile hotspot or Wi-Fi network where other RescueMemory nodes are running.
            </p>
          </div>
        )}
      </div>

      {/* Direct IP Fallback Endpoint Card */}
      <div className="bg-white dark:bg-[#0b1626] border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2 flex items-center gap-1.5">
          <ExternalLink size={14} className="text-cyan-500" />
          <span>Manual Direct IP Connect</span>
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          If zero-conf UDP multicast is disabled by your Wi-Fi router, enter the peer IP address directly to transfer memory.
        </p>

        <form onSubmit={handleDirectIpSync} className="flex gap-2">
          <input
            type="text"
            className="field flex-1 text-xs font-mono"
            placeholder="e.g. http://192.168.43.12:8001"
            value={directIp}
            onChange={(e) => setDirectIp(e.target.value)}
          />
          <button
            type="submit"
            disabled={!directIp.trim() || syncingAll}
            className="py-2.5 px-4 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 transition-all"
          >
            <Send size={14} />
            <span>Connect & Sync</span>
          </button>
        </form>
      </div>
    </div>
  );
}
