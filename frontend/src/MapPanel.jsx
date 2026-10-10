import { Bluetooth, MapPin, Navigation, Radio, TriangleAlert } from 'lucide-react';

const WIDTH = 600;
const HEIGHT = 340;

export default function MapPanel({
  center,
  items = [],
  peers = [],
  selected,
  selectedPeer,
  onSelect,
  onMarker,
  onSelectPeer,
  dark = false,
  originLabel = 'YOU (SURVIVOR)'
}) {
  const mapBg = dark ? '#091927' : 'var(--map-bg)';
  const mapGrid = dark ? '#18334b' : 'var(--map-grid)';
  const mapRoad = dark ? '#264a68' : 'var(--map-road)';
  const mapRoadLine = dark ? '#4a779d' : 'var(--map-road-line)';

  const span = 0.11;

  const safeCenterLat = (center && !Number.isNaN(Number(center.lat))) ? Number(center.lat) : 28.7041;
  const safeCenterLon = (center && !Number.isNaN(Number(center.lon))) ? Number(center.lon) : 77.1025;

  const project = (location) => {
    const lat = location?.lat != null ? Number(location.lat) : safeCenterLat;
    const lon = location?.lon != null ? Number(location.lon) : safeCenterLon;
    const validLat = Number.isNaN(lat) ? safeCenterLat : lat;
    const validLon = Number.isNaN(lon) ? safeCenterLon : lon;
    return {
      x: Math.max(16, Math.min(WIDTH - 16, WIDTH / 2 + ((validLon - safeCenterLon) / span) * WIDTH)),
      y: Math.max(16, Math.min(HEIGHT - 16, HEIGHT / 2 - ((validLat - safeCenterLat) / span) * HEIGHT)),
    };
  };

  const handleMapClick = (event) => {
    if (!onSelect) return;
    let clientX = event.clientX;
    let clientY = event.clientY;
    if ((clientX === undefined || clientX === 0) && event.changedTouches && event.changedTouches.length > 0) {
      clientX = event.changedTouches[0].clientX;
      clientY = event.changedTouches[0].clientY;
    } else if ((clientX === undefined || clientX === 0) && event.touches && event.touches.length > 0) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    }
    if (clientX == null || Number.isNaN(clientX)) return;

    const box = event.currentTarget.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;

    const relX = (clientX - box.left) / box.width;
    const relY = (clientY - box.top) / box.height;
    if (Number.isNaN(relX) || Number.isNaN(relY)) return;

    const newLat = Number((safeCenterLat + (0.5 - relY) * span).toFixed(5));
    const newLon = Number((safeCenterLon + (relX - 0.5) * span).toFixed(5));
    if (!Number.isNaN(newLat) && !Number.isNaN(newLon)) {
      onSelect({ lat: newLat, lon: newLon });
    }
  };

  const validPeers = (Array.isArray(peers) ? peers : []).filter((p) => p && p.lat != null && p.lon != null);

  return (
    <div className="select-none">
      <div
        className="relative rounded-2xl overflow-hidden border border-slate-700/80 shadow-md"
        style={{ backgroundColor: mapBg }}
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Offline coordinate grid with report markers and nearby peer devices"
          className={`block w-full max-w-full h-auto max-h-[340px] touch-manipulation ${onSelect ? 'cursor-crosshair' : ''}`}
          onClick={handleMapClick}
          onPointerUp={handleMapClick}
          style={{ touchAction: 'pan-x pan-y' }}
        >
          <defs>
            {/* Grid Pattern */}
            <pattern id="map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke={mapGrid} strokeWidth="0.75" opacity="0.65" />
            </pattern>

            {/* Hazard Diagonal Stripe Pattern */}
            <pattern id="hazard-stripes" width="12" height="12" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="12" stroke="#ef4444" strokeWidth="4" opacity="0.4" />
            </pattern>
          </defs>

          {/* Background Canvas */}
          <rect width={WIDTH} height={HEIGHT} fill={mapBg} />
          <rect width={WIDTH} height={HEIGHT} fill="url(#map-grid)" />

          {/* Tactical Roads / Infrastructure */}
          <path d="M-10 270 Q130 225 245 250 T610 130" stroke={mapRoad} strokeWidth="22" fill="none" opacity=".7" />
          <path d="M-10 270 Q130 225 245 250 T610 130" stroke={mapRoadLine} strokeWidth="2" fill="none" strokeDasharray="6 6" opacity=".85" />
          <path d="M160 -10 Q180 110 290 160 T450 350" stroke={mapRoad} strokeWidth="16" fill="none" opacity=".7" />
          <path d="M160 -10 Q180 110 290 160 T450 350" stroke={mapRoadLine} strokeWidth="1.5" fill="none" strokeDasharray="5 5" opacity=".75" />

          {/* Schematic Buildings / Infrastructure Blocks */}
          <rect x="50" y="40" width="45" height="35" rx="4" fill="var(--map-road)" opacity="0.35" />
          <rect x="110" y="50" width="60" height="40" rx="4" fill="var(--map-road)" opacity="0.35" />
          <rect x="440" y="50" width="70" height="50" rx="4" fill="var(--map-road)" opacity="0.35" />
          <rect x="70" y="190" width="80" height="50" rx="4" fill="var(--map-road)" opacity="0.35" />
          <rect x="420" y="220" width="90" height="60" rx="4" fill="var(--map-road)" opacity="0.35" />

          {/* Tactical Coordinates Watermark */}
          <text x="22" y="32" fill="var(--map-label)" fontSize="11" fontWeight="700" letterSpacing="2" opacity="0.8">
            OFFLINE LOCATION GRID
          </text>

          {/* Compass Rose Mini-Indicator */}
          <g transform={`translate(${WIDTH - 36}, 32)`} opacity="0.75">
            <circle cx="0" cy="0" r="14" fill="none" stroke="var(--map-road-line)" strokeWidth="1" />
            <polygon points="0,-11 -4,-1 4,-1" fill="#ef4444" />
            <polygon points="0,11 -4,1 4,1" fill="var(--map-road-line)" />
            <text x="0" y="-14" textAnchor="middle" fill="#ef4444" fontSize="8" fontWeight="bold">N</text>
          </g>

          {/* Dynamic Vector Route Line to Selected Destination */}
          {selected && (
            <line
              x1={WIDTH / 2}
              y1={HEIGHT / 2}
              x2={project(selected).x}
              y2={project(selected).y}
              stroke="#38bdf8"
              strokeWidth="2.5"
              strokeDasharray="6 4"
              opacity="0.85"
            />
          )}

          {/* Local User GPS Marker (Center of Grid) */}
          <g>
            <circle cx={WIDTH / 2} cy={HEIGHT / 2} r="22" fill="#38bdf8" opacity="0.15" />
            <circle cx={WIDTH / 2} cy={HEIGHT / 2} r="14" fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4 2" />
            <circle cx={WIDTH / 2} cy={HEIGHT / 2} r="6" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
            <text
              x={WIDTH / 2}
              y={HEIGHT / 2 + 20}
              textAnchor="middle"
              fill="#38bdf8"
              fontSize="9"
              fontWeight="bold"
              style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}
            >
              {originLabel}
            </text>
          </g>

          {/* Incident / Hazard / Checkpoint Pins */}
          {(Array.isArray(items) ? items : []).filter((item) => item && item.location).map((item) => {
            const point = project(item.location);
            const isHazard = item.kind === 'hazard' || item.severity === 'red';
            const isResource = item.kind === 'resource';
            const isCheckpoint = item.kind === 'checkpoint';
            const fill = isHazard ? '#ef4444' : isResource ? '#10b981' : isCheckpoint ? '#3b82f6' : '#f59e0b';
            const isTarget = selected && (
              (selected.id && selected.id === item.id) ||
              (selected.lat === item.location?.lat && selected.lon === item.location?.lon)
            );

            return (
              <g
                key={item.id || `${item.location.lat}_${item.location.lon}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onMarker?.(item);
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                className="cursor-pointer group"
                style={{ pointerEvents: 'auto' }}
              >
                {/* 28px Invisible Large Touch Target for easy finger tapping on mobile */}
                <circle cx={point.x} cy={point.y} r="28" fill="transparent" pointerEvents="all" />

                {/* Hazard Warning Ring */}
                {isHazard && (
                  <circle cx={point.x} cy={point.y} r="20" fill="url(#hazard-stripes)" stroke="#ef4444" strokeWidth="1" strokeDasharray="3 2" />
                )}
                
                {/* Target Pulsing Halo when active */}
                {isTarget && (
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="20"
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="2"
                    strokeDasharray="4 2"
                    className="animate-pulse"
                  />
                )}

                <circle cx={point.x} cy={point.y} r="12" fill={fill} opacity=".35" />
                <circle cx={point.x} cy={point.y} r="6.5" fill={fill} stroke="#ffffff" strokeWidth="2" />
                <text
                  x={point.x}
                  y={point.y - 12}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="9.5"
                  fontWeight="bold"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.95)' }}
                >
                  {(() => {
                    const raw = item.title || item.name || (item.entity_id && item.entity_id.length <= 16 ? item.entity_id : null) || item.kind || 'Point';
                    return raw.length > 18 ? raw.slice(0, 16) + '…' : raw;
                  })()}
                </text>
              </g>
            );
          })}

          {/* Discovered Wi-Fi Peer Devices (With animated radar rings) */}
          {validPeers.map((peer) => {
            const point = project({ lat: peer.lat, lon: peer.lon });
            const isVolunteer = peer.role === 'volunteer' || peer.role === 'central';
            const color = isVolunteer ? '#10b981' : '#f59e0b';
            const isSelected = selectedPeer?.node_id === peer.node_id;

            return (
              <g
                key={`peer-${peer.node_id}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectPeer?.(peer);
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                className="cursor-pointer"
                style={{ pointerEvents: 'auto' }}
              >
                {/* Large 28px invisible touch hit target */}
                <circle cx={point.x} cy={point.y} r="28" fill="transparent" pointerEvents="all" />

                {/* Radar pulse ripples */}
                <circle cx={point.x} cy={point.y} r="22" fill="none" stroke={color} strokeWidth="1.5" opacity="0.35" strokeDasharray="3 3" />
                <circle cx={point.x} cy={point.y} r="12" fill={color} opacity="0.25" />
                <circle cx={point.x} cy={point.y} r="7" fill={color} stroke="#ffffff" strokeWidth="2" />
                {isSelected && (
                  <circle cx={point.x} cy={point.y} r="26" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="4 4" />
                )}
                <text
                  x={point.x}
                  y={point.y - 12}
                  textAnchor="middle"
                  fill="#f1f5f9"
                  fontSize="9"
                  fontWeight="700"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.95)' }}
                >
                  {peer.node_id.slice(0, 10)}
                </text>
              </g>
            );
          })}

          {/* Custom User Target Reticle Pin */}
          {selected && (
            <g>
              <line x1={project(selected).x - 14} y1={project(selected).y} x2={project(selected).x + 14} y2={project(selected).y} stroke="#0ea5e9" strokeWidth="2.5" />
              <line x1={project(selected).x} y1={project(selected).y - 14} x2={project(selected).x} y2={project(selected).y + 14} stroke="#0ea5e9" strokeWidth="2.5" />
              <circle cx={project(selected).x} cy={project(selected).y} r="14" fill="none" stroke="#0ea5e9" strokeWidth="2" strokeDasharray="3 3" />
              <circle cx={project(selected).x} cy={project(selected).y} r="7" fill="#0ea5e9" opacity="0.35" />
              <circle cx={project(selected).x} cy={project(selected).y} r="3.5" fill="#ffffff" stroke="#0ea5e9" strokeWidth="1.5" />
            </g>
          )}
        </svg>

        {/* Floating Active Badges */}
        <div className="absolute right-3.5 bottom-3.5 text-[10px] font-mono bg-slate-950/85 px-2.5 py-1 rounded-xl text-slate-300 border border-slate-800 shadow-md">
            5 km view · Local reports
        </div>

        {validPeers.length > 0 && (
          <div className="absolute left-3.5 top-3.5 text-[11px] font-bold bg-slate-950/85 border border-cyan-500/40 px-3 py-1.5 rounded-xl text-cyan-300 flex items-center gap-2 shadow-lg backdrop-blur-md">
            <Bluetooth size={13} className="text-cyan-400 animate-pulse" />
            <span>{validPeers.length} Peer Node{validPeers.length > 1 ? 's' : ''} on Bluetooth</span>
          </div>
        )}
      </div>

      {/* Map Legend & Positioning Guide */}
      <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 dark:text-slate-400 mt-2.5 px-1 gap-2">
        <div className="flex items-center gap-1.5 font-medium">
          <MapPin size={13} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
          <span>Center: {safeCenterLat.toFixed(4)}, {safeCenterLon.toFixed(4)}</span>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span> Shelter
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span> Hazard
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span> BLE Peer
          </span>
        </div>
      </div>
    </div>
  );
}
