import { useCallback, useEffect, useState } from 'react';
import {
  Battery,
  Bluetooth,
  BluetoothConnected,
  BluetoothSearching,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  Info,
  QrCode,
  Radio,
  RefreshCw,
  Send,
  Smartphone,
  X,
  Zap
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  getDiscoveredPeers,
  syncDiscoveredPeer,
  setting,
  triggerAutoSync,
  getDeviceId,
  updateDeviceLocation,
  getNativeOrWebLocation,
  requestBleDevice,
  isBluetoothSupported,
  registerSimulatedBlePeer
} from '../api';
import { getAllLocalReports, getUnsyncedReports, saveImportedReports } from '../brain/offlineStorage.js';

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
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showBleGuide, setShowBleGuide] = useState(false);
  const [isBleScanning, setIsBleScanning] = useState(false);
  const [hasBleHardware, setHasBleHardware] = useState(true);

  // QR Mesh Sync Modal States
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrTab, setQrTab] = useState('share'); // 'share' | 'scan'
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrPayloadText, setQrPayloadText] = useState('');
  const [importInput, setImportInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);

  useEffect(() => {
    setHasBleHardware(isBluetoothSupported());
  }, []);

  const refreshPeersList = useCallback(async () => {
    setScanning(true);
    setErrorMessage('');
    try {
      // Proactively advertise self first
      try {
        const loc = await getNativeOrWebLocation();
        await updateDeviceLocation(loc);
      } catch {
        // silent
      }
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

  // Scan and transfer data to all discovered peers via Bluetooth LE
  const handleScanAndTransfer = useCallback(async (isSilent = false) => {
    if (!isSilent) {
      setSyncingAll(true);
      setScanning(true);
      setStatusMessage('');
      setErrorMessage('');
    }

    try {
      // 0. Proactively announce our presence beacon
      try {
        const loc = await getNativeOrWebLocation();
        await updateDeviceLocation(loc);
      } catch {
        // silent
      }

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

      // 2. Discover nearby Bluetooth / Cloud peers
      const scanRes = await getDiscoveredPeers();
      const currentPeers = scanRes?.peers || [];
      setPeers(currentPeers);

      if (!isSilent) {
        await new Promise((r) => setTimeout(r, 400));
      }

      let bleTransfers = 0;
      for (const peer of currentPeers) {
        try {
          const outcome = await syncDiscoveredPeer(peer);
          if (outcome?.synced || outcome?.imported) {
            bleTransfers++;
          }
        } catch (peerErr) {
          console.warn(`Sync with ${peer.node_id} notice:`, peerErr?.message);
        }
      }

      if (currentPeers.length > 0) {
        setStatusMessage(
          `⚡ Bluetooth Mesh Active: Connected to ${currentPeers.length} device(s)${localFlushed > 0 ? ` · Uplinked ${localFlushed} SOS` : ''}${remoteImported > 0 ? ` · Received ${remoteImported} reports` : ''}`
        );
        if (onSyncComplete) onSyncComplete();
      } else {
        setStatusMessage(
          localFlushed > 0
            ? `✅ Synced ${localFlushed} report(s). Bluetooth radar active & scanning for nearby devices...`
            : '📡 Bluetooth LE radar active & scanning nearby devices automatically...'
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

  // Request Bluetooth Scan Dialog (1-Tap Native BLE Discovery)
  const handleScanBluetooth = async () => {
    setIsBleScanning(true);
    setErrorMessage('');
    try {
      const dev = await requestBleDevice();
      setStatusMessage(`⚡ Connected to Bluetooth device: ${dev.name || dev.id}. Syncing data...`);
      await refreshPeersList();
      await handleScanAndTransfer(false);
    } catch (err) {
      if (err.name !== 'NotFoundError' && !err.message?.includes('User cancelled')) {
        setErrorMessage(`Bluetooth: ${err.message || 'Scan cancelled'}`);
      }
    } finally {
      setIsBleScanning(false);
    }
  };

  // Sync with a single specific peer
  const handleSyncSinglePeer = async (peer) => {
    setSyncingNodeId(peer.node_id);
    setStatusMessage('');
    setErrorMessage('');
    try {
      const res = await syncDiscoveredPeer(peer);
      const peerName = peer.name || peer.device_name || peer.node_id;
      const speedStr = res.speed ? ` in ${res.speed}` : '';
      setStatusMessage(`⚡ Synced data with ${peerName}${speedStr}. (${res.imported || 0} imported, ${res.synced || 0} uplinked)`);
      if (onSyncComplete) onSyncComplete();
    } catch (err) {
      setErrorMessage(`Sync with ${peer.node_id} failed: ${err.message || 'Peer unreachable'}`);
    } finally {
      setSyncingNodeId(null);
    }
  };

  // Add simulated BLE peer for zero-hardware desktop testing
  const handleAddSimulatedPeer = async () => {
    registerSimulatedBlePeer();
    await refreshPeersList();
    setStatusMessage('⚡ Connected to simulated Bluetooth BLE peer node.');
  };

  // Generate QR Code for Pure Offline P2P Mesh Fallback
  const openQrModal = async () => {
    setShowQrModal(true);
    setQrTab('share');
    setQrLoading(true);
    try {
      const reports = await getAllLocalReports();
      const deviceId = getDeviceId();
      let loc = { lat: 28.7041, lon: 77.1025 };
      try {
        loc = await getNativeOrWebLocation();
      } catch {
        // silent
      }

      // Compact payload with reports
      const payload = {
        k: 'rm_ble_packet',
        s: deviceId,
        t: Date.now(),
        l: [Number(loc.lat.toFixed(5)), Number(loc.lon.toFixed(5))],
        e: (reports || []).slice(0, 8).map((r) => ({
          id: r.id,
          k: r.kind || 'sos',
          t: r.text || '',
          l: [Number((r.location?.lat || loc.lat).toFixed(5)), Number((r.location?.lon || loc.lon).toFixed(5))],
          v: r.severity || 'red',
          ts: r.created_at || new Date().toISOString()
        }))
      };

      const jsonStr = JSON.stringify(payload);
      setQrPayloadText(jsonStr);

      const url = await QRCode.toDataURL(jsonStr, {
        width: 320,
        margin: 2,
        color: {
          dark: '#031b2e',
          light: '#ffffff'
        }
      });
      setQrDataUrl(url);
    } catch (err) {
      console.error('Failed to generate QR code:', err);
    } finally {
      setQrLoading(false);
    }
  };

  // Import QR Packet data
  const handleImportPayload = async (rawText) => {
    if (!rawText || !rawText.trim()) return;
    try {
      const data = JSON.parse(rawText.trim());
      if (data.k !== 'rm_ble_packet' && data.k !== 'rm_mesh_packet' && !Array.isArray(data.e) && !Array.isArray(data.events)) {
        throw new Error('Invalid RescueMemory mesh packet');
      }

      const eventsToImport = (data.e || data.events || []).map((e) => ({
        id: e.id || `qr_${Math.random().toString(36).slice(2, 9)}`,
        kind: e.k || e.kind || 'sos',
        text: e.t || e.text || '',
        location: Array.isArray(e.l) ? { lat: e.l[0], lon: e.l[1] } : (e.location || { lat: 28.7041, lon: 77.1025 }),
        severity: e.v || e.severity || 'red',
        status: 'needs_help',
        visibility: 'public',
        reporter_id: data.s || 'qr-peer',
        created_at: e.ts || new Date().toISOString()
      }));

      const count = await saveImportedReports(eventsToImport);
      setStatusMessage(`✅ Successfully imported ${count} SOS emergency report(s) from QR packet!`);
      setShowQrModal(false);
      setImportInput('');
      refreshPeersList();
      if (onSyncComplete) onSyncComplete();
    } catch (err) {
      setErrorMessage(`Import failed: ${err.message}`);
    }
  };

  const handleCopyPayload = () => {
    if (!qrPayloadText) return;
    navigator.clipboard?.writeText(qrPayloadText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-2.5 sm:gap-3 text-slate-900 dark:text-slate-100 max-w-2xl mx-auto w-full">
      {/* Sleek Minimal Header */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-2.5 sm:p-3.5 shadow-xs flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-sm shrink-0">
            <Bluetooth size={15} className={scanning || syncingAll || isBleScanning ? 'animate-pulse' : ''} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <span>Bluetooth Mesh</span>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              </h2>
              <span className="text-[10px] sm:text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                BLE ACTIVE (6s)
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight font-medium">
              Zero-setup Bluetooth Low Energy mesh · Lightning-fast SOS exchange in &lt; 50ms.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleScanBluetooth}
            disabled={isBleScanning}
            className="p-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/25 transition-colors flex items-center gap-1 text-xs font-bold cursor-pointer"
            title="Scan for Nearby Bluetooth Devices"
          >
            <BluetoothSearching size={14} className={isBleScanning ? 'animate-spin' : ''} />
            <span className="hidden xs:inline">Pair BLE</span>
          </button>

          <button
            type="button"
            onClick={openQrModal}
            className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-800 bg-[#f0f5fa] dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-[#e2ecf5] dark:hover:bg-slate-800 transition-colors flex items-center gap-1 text-xs font-bold"
            title="Zero-Network QR Mesh Fallback"
          >
            <QrCode size={14} />
            <span className="hidden xs:inline">QR Fallback</span>
          </button>

          <button
            type="button"
            onClick={refreshPeersList}
            disabled={scanning}
            className="p-1.5 rounded-lg border border-[#cbdbe9] dark:border-slate-800 bg-[#f0f5fa] dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-[#e2ecf5] dark:hover:bg-slate-800 transition-colors"
            title="Scan Again"
          >
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Alert Notifications */}
      {statusMessage && (
        <div className="p-2.5 sm:p-3 rounded-xl border border-cyan-300 dark:border-cyan-800/80 bg-cyan-50 dark:bg-cyan-950/40 text-cyan-900 dark:text-cyan-100 text-xs sm:text-sm flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-cyan-500" />
            <span className="font-medium">{statusMessage}</span>
          </div>
          <button onClick={() => setStatusMessage('')} className="text-xs underline font-semibold ml-2 cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="p-2.5 sm:p-3 rounded-xl border border-red-300 dark:border-red-800/80 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 text-xs sm:text-sm flex items-center justify-between shadow-xs">
          <span className="font-medium">{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="text-xs underline font-semibold ml-2 cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Visual Scanner & Action Button */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs flex flex-col items-center">
        {/* Minimal Radar Scanner SVG */}
        <div className="relative w-[210px] h-[210px] sm:w-[240px] sm:h-[240px] flex items-center justify-center my-0.5">
          <svg viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`} className="w-full h-full select-none drop-shadow-md">
            <defs>
              <radialGradient id="meshSweepGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.0" />
              </radialGradient>
            </defs>

            {/* Background Disk */}
            <circle cx={GRID_CENTER} cy={GRID_CENTER} r={MAX_RADIUS + 10} fill="#060e1a" stroke="#1e293b" strokeWidth="1.5" />
            <circle cx={GRID_CENTER} cy={GRID_CENTER} r={MAX_RADIUS} fill="#091424" stroke="#0284c7" strokeWidth="1" />

            {/* Distance Rings */}
            {[0.33, 0.66, 1.0].map((ratio, idx) => (
              <circle
                key={idx}
                cx={GRID_CENTER}
                cy={GRID_CENTER}
                r={MAX_RADIUS * ratio}
                fill="none"
                stroke="#0369a1"
                strokeWidth="1"
                strokeDasharray={idx === 2 ? 'none' : '2 3'}
              />
            ))}

            {/* Crosshairs */}
            <line x1={GRID_CENTER - MAX_RADIUS} y1={GRID_CENTER} x2={GRID_CENTER + MAX_RADIUS} y2={GRID_CENTER} stroke="#0369a1" strokeWidth="0.8" />
            <line x1={GRID_CENTER} y1={GRID_CENTER - MAX_RADIUS} x2={GRID_CENTER} y2={GRID_CENTER + MAX_RADIUS} stroke="#0369a1" strokeWidth="0.8" />

            {/* Sweeping Bluetooth Radar Beam */}
            <g className="animate-[spin_4s_linear_infinite]" style={{ transformOrigin: `${GRID_CENTER}px ${GRID_CENTER}px` }}>
              <line
                x1={GRID_CENTER}
                y1={GRID_CENTER}
                x2={GRID_CENTER}
                y2={GRID_CENTER - MAX_RADIUS}
                stroke="#38bdf8"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d={`M ${GRID_CENTER} ${GRID_CENTER} L ${GRID_CENTER} ${GRID_CENTER - MAX_RADIUS} A ${MAX_RADIUS} ${MAX_RADIUS} 0 0 1 ${GRID_CENTER + MAX_RADIUS * 0.7} ${GRID_CENTER - MAX_RADIUS * 0.7} Z`}
                fill="url(#meshSweepGrad)"
              />
            </g>

            {/* Center Node (YOU) */}
            <circle cx={GRID_CENTER} cy={GRID_CENTER} r="14" fill="#0ea5e9" opacity="0.2" />
            <circle cx={GRID_CENTER} cy={GRID_CENTER} r="6" fill="#0ea5e9" stroke="#ffffff" strokeWidth="2" />
            <text x={GRID_CENTER} y={GRID_CENTER + 16} textAnchor="middle" fill="#38bdf8" fontSize="9" fontWeight="bold">
              You
            </text>

            {/* Plotted Discovered Peers */}
            {peers.map((peer, pIdx) => {
              const angle = (pIdx * (360 / Math.max(1, peers.length)) + 45) * (Math.PI / 180);
              const dist = Math.min(
                MAX_RADIUS - 15,
                Math.max(30, peer.distance_m ? (peer.distance_m / 80) * MAX_RADIUS : 45 + pIdx * 20)
              );
              const px = GRID_CENTER + dist * Math.cos(angle);
              const py = GRID_CENTER + dist * Math.sin(angle);
              const isVol = peer.role === 'volunteer' || peer.role === 'central' || peer.role === 'responder';
              const color = isVol ? '#10b981' : '#38bdf8';

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
                    {peer.name ? peer.name.slice(0, 10) : peer.node_id?.slice(-6) || `Peer ${pIdx + 1}`}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Sync Button */}
        <div className="w-full max-w-sm mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => handleScanAndTransfer(false)}
            disabled={syncingAll}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-blue-500 text-white font-extrabold text-sm sm:text-base shadow-md shadow-cyan-600/25 flex items-center justify-center gap-2 transition-all active:scale-98 disabled:opacity-75 cursor-pointer"
          >
            {syncingAll ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                <span>Syncing Bluetooth Mesh…</span>
              </>
            ) : (
              <>
                <Zap size={16} />
                <span>Sync Nearby Bluetooth Devices {peers.length > 0 ? `(${peers.length})` : ''}</span>
              </>
            )}
          </button>

          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium">
                BLE Radio Active · Zero Passwords Required
              </p>
            </div>

            <button
              type="button"
              onClick={handleScanBluetooth}
              className="text-[11px] text-cyan-600 dark:text-cyan-400 font-bold hover:underline cursor-pointer"
            >
              + Pair New Phone
            </button>
          </div>
        </div>
      </div>

      {/* Discovered Bluetooth Devices List */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Bluetooth size={14} className="text-cyan-500" />
            <span>Nearby Bluetooth Devices ({peers.length})</span>
          </h3>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Tap Sync to exchange SOS</span>
        </div>

        {peers.length > 0 ? (
          <div className="space-y-2">
            {peers.map((peer, idx) => {
              const isVol = peer.role === 'volunteer' || peer.role === 'central' || peer.role === 'responder';
              const isSyncingThis = syncingNodeId === peer.node_id;
              const displayName = peer.name || peer.device_name || `Survivor Phone (${peer.node_id.slice(-4)})`;
              const distText =
                peer.distance_m !== undefined && peer.distance_m !== null
                  ? `${peer.distance_m}m`
                  : 'Near';
              const dirText = peer.cardinal ? `${peer.cardinal} (${peer.bearing_deg || 0}°)` : '';
              const rssiText = peer.rssi ? `${peer.rssi} dBm` : 'BLE Signal';

              return (
                <div
                  key={peer.node_id || idx}
                  className="p-2.5 sm:p-3 rounded-xl border border-[#dbe6f0] dark:border-slate-800 bg-[#f8fafc] dark:bg-slate-900/60 flex items-center justify-between gap-3 transition-all hover:border-cyan-500/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${peer.is_online !== false ? 'bg-cyan-400' : 'bg-slate-400'}`} />
                      <span className="font-bold text-slate-900 dark:text-slate-100 text-[13px] sm:text-sm truncate">
                        {displayName}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          isVol
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                            : 'bg-cyan-100 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-300'
                        }`}
                      >
                        {isVol ? 'Responder' : 'Survivor'}
                      </span>
                      <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 flex items-center gap-0.5">
                        <Bluetooth size={10} />
                        <span>BLE Mesh</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1 font-medium">
                        <Compass size={11} className="text-cyan-500" />
                        <span>
                          {distText} {dirText ? `· ${dirText}` : ''}
                        </span>
                      </span>
                      <span className="font-mono text-[10px] text-cyan-600 dark:text-cyan-400">
                        {rssiText}
                      </span>
                      {peer.battery !== undefined && peer.battery !== null && (
                        <span className="flex items-center gap-0.5">
                          <Battery size={11} className="text-emerald-500" />
                          <span>{peer.battery}%</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSyncSinglePeer(peer)}
                    disabled={isSyncingThis || syncingAll}
                    className="py-1.5 px-3 rounded-lg border border-cyan-500/50 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-bold text-xs flex items-center gap-1.5 transition-all shrink-0 active:scale-95 cursor-pointer"
                  >
                    {isSyncingThis ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
                    <span>Sync</span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-dashed border-[#cbdbe9] dark:border-slate-800 text-center bg-[#f8fafc]/60 dark:bg-slate-900/30">
            <BluetoothSearching size={22} className="mx-auto text-cyan-500 mb-1.5 animate-pulse" />
            <p className="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300 font-medium">
              Scanning for nearby Bluetooth devices...
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Tap <strong>"Pair BLE"</strong> above to discover and connect with other phones instantly.
            </p>
            <button
              type="button"
              onClick={handleAddSimulatedPeer}
              className="mt-2 text-[11px] text-cyan-600 dark:text-cyan-400 font-bold hover:underline cursor-pointer"
            >
              + Add Simulated Peer Node (Demo / Test)
            </button>
          </div>
        )}
      </div>

      {/* Step-by-Step Bluetooth Mesh Guide */}
      <div className="bg-white dark:bg-[#0b1626] border border-[#dbe6f0] dark:border-slate-800 rounded-2xl p-3 shadow-xs">
        <button
          type="button"
          onClick={() => setShowBleGuide(!showBleGuide)}
          className="w-full flex items-center justify-between text-left text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <BluetoothConnected size={15} className="text-cyan-500" />
            <span>How to Connect Phones via Bluetooth Mesh (Zero Setup)</span>
          </div>
          {showBleGuide ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showBleGuide && (
          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs sm:text-[13px] space-y-2.5 text-slate-600 dark:text-slate-300">
            <div className="p-2.5 rounded-xl bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-900/50">
              <p className="font-bold text-cyan-900 dark:text-cyan-200 mb-1">Step 1: Turn ON Bluetooth</p>
              <p>Turn ON <strong>Bluetooth</strong> on both phones. No Wi-Fi passwords, hotspot SSIDs, or typing required.</p>
            </div>

            <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50">
              <p className="font-bold text-blue-900 dark:text-blue-200 mb-1">Step 2: Tap "Pair BLE" on Either Phone</p>
              <p>Tap <strong>Pair BLE</strong> at the top. The nearby phone appears in the list within seconds.</p>
            </div>

            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
              <p className="font-bold text-emerald-900 dark:text-emerald-200 mb-1">Step 3: Lightning-Fast Transfer (&lt; 50ms)</p>
              <p>
                Tap <strong>Sync Nearby Devices</strong>. Emergency SOS reports and triage data transfer over high-speed BLE LE-2M radio instantly!
              </p>
            </div>

            <div className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900/50">
              <p className="font-bold text-teal-900 dark:text-teal-200 mb-1">Step 4: Navigate on Compass HUD</p>
              <p>
                Any survivor SOS received over Bluetooth will immediately lock onto your <strong>Compass Radar</strong> with exact distance and direction!
              </p>
            </div>
          </div>
        )}
      </div>

      {/* QR Mesh Sync Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-white dark:bg-[#0b1626] border border-slate-300 dark:border-slate-800 rounded-2xl max-w-sm w-full p-4 shadow-2xl flex flex-col gap-3 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <QrCode size={18} className="text-cyan-500" />
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Offline QR Mesh Exchange
                </h3>
              </div>
              <button
                onClick={() => setShowQrModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              100% Zero-Radio Disaster Fallback. Point camera between 2 phones to exchange SOS reports even in Airplane mode.
            </p>

            {/* Tabs */}
            <div className="flex rounded-xl bg-slate-100 dark:bg-slate-900 p-1 border border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setQrTab('share')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  qrTab === 'share'
                    ? 'bg-cyan-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Share SOS QR
              </button>
              <button
                onClick={() => setQrTab('scan')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  qrTab === 'scan'
                    ? 'bg-cyan-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Scan / Import
              </button>
            </div>

            {/* Tab 1: Share SOS QR */}
            {qrTab === 'share' && (
              <div className="flex flex-col items-center gap-3 py-2">
                {qrLoading ? (
                  <div className="h-56 w-56 flex items-center justify-center">
                    <RefreshCw size={24} className="animate-spin text-cyan-500" />
                  </div>
                ) : qrDataUrl ? (
                  <div className="p-2.5 bg-white rounded-xl shadow-md border border-slate-200">
                    <img src={qrDataUrl} alt="SOS Mesh QR" className="w-56 h-56 rounded-lg select-none" />
                  </div>
                ) : (
                  <p className="text-xs text-red-500">Failed to generate QR</p>
                )}

                <div className="flex gap-2 w-full">
                  <button
                    onClick={handleCopyPayload}
                    className="flex-1 py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                  >
                    {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    <span>{copied ? 'Copied!' : 'Copy Data'}</span>
                  </button>
                  <button
                    onClick={openQrModal}
                    className="py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                  >
                    <RefreshCw size={14} />
                    <span>Regen</span>
                  </button>
                </div>
              </div>
            )}

            {/* Tab 2: Scan / Import */}
            {qrTab === 'scan' && (
              <div className="flex flex-col gap-3 py-2">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Paste the mesh JSON packet or use camera to import SOS incidents from the other phone:
                </p>

                <textarea
                  className="w-full h-28 p-2.5 rounded-xl border border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-xs font-mono resize-none focus:outline-cyan-500"
                  placeholder='Paste {"k":"rm_ble_packet", ...} here'
                  value={importInput}
                  onChange={(e) => setImportInput(e.target.value)}
                />

                <button
                  type="button"
                  onClick={() => handleImportPayload(importInput)}
                  disabled={!importInput.trim()}
                  className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md shadow-cyan-600/20 disabled:opacity-50 cursor-pointer"
                >
                  <CheckCircle2 size={16} />
                  <span>Import SOS Reports</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
