import { MapPin, Navigation, Radio, TriangleAlert, Wifi } from 'lucide-react';

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
  onSelectPeer
}) {
  const span = 0.11;
  const project = (location) => ({
    x: Math.max(16, Math.min(WIDTH - 16, WIDTH / 2 + (location.lon - center.lon) / span * WIDTH)),
    y: Math.max(16, Math.min(HEIGHT - 16, HEIGHT / 2 - (location.lat - center.lat) / span * HEIGHT)),
  });

  const pick = (event) => {
    if (!onSelect) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    onSelect({
      lat: Number((center.lat + (0.5 - y) * span).toFixed(5)),
      lon: Number((center.lon + (x - 0.5) * span).toFixed(5))
    });
  };

  const validPeers = peers.filter((p) => p.lat != null && p.lon != null);

  return (
    <div className="select-none">
      <div className="relative rounded-3xl overflow-hidden border border-slate-700/80 bg-[var(--map-bg)] shadow-2xl">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Offline coordinate grid with report markers and nearby peer devices"
          className={`w-full h-auto min-h-[260px] sm:min-h-[320px] ${onSelect ? 'cursor-crosshair' : ''}`}
          onClick={pick}
        >
          <defs>
            {/* Grid Pattern */}
            <pattern id="map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--map-grid)" strokeWidth="0.75" opacity="0.65" />
            </pattern>

            {/* Hazard Diagonal Stripe Pattern */}
            <pattern id="hazard-stripes" width="12" height="12" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="12" stroke="#ef4444" strokeWidth="4" opacity="0.4" />
            </pattern>
          </defs>

          {/* Background Canvas */}
          <rect width={WIDTH} height={HEIGHT} fill="var(--map-bg)" />
          <rect width={WIDTH} height={HEIGHT} fill="url(#map-grid)" />

          {/* Tactical Roads / Infrastructure */}
          <path d="M-10 270 Q130 225 245 250 T610 130" stroke="var(--map-road)" strokeWidth="22" fill="none" opacity=".7" />
          <path d="M-10 270 Q130 225 245 250 T610 130" stroke="var(--map-road-line)" strokeWidth="2" fill="none" strokeDasharray="6 6" opacity=".85" />
          <path d="M160 -10 Q180 110 290 160 T450 350" stroke="var(--map-road)" strokeWidth="16" fill="none" opacity=".7" />
          <path d="M160 -10 Q180 110 290 160 T450 350" stroke="var(--map-road-line)" strokeWidth="1.5" fill="none" strokeDasharray="5 5" opacity=".75" />

          {/* Schematic Buildings / Infrastructure Blocks */}
          <rect x="50" y="40" width="45" height="35" rx="4" fill="var(--map-road)" opacity="0.35" />
          <rect x="110" y="50" width="60" height="40" rx="4" fill="var(--map-road)" opacity="0.35" />
          <rect x="440" y="50" width="70" height="50" rx="4" fill="var(--map-road)" opacity="0.35" />
          <rect x="70" y="190" width="80" height="50" rx="4" fill="var(--map-road)" opacity="0.35" />
          <rect x="420" y="220" width="90" height="60" rx="4" fill="var(--map-road)" opacity="0.35" />

          {/* Tactical Coordinates Watermark */}
          <text x="22" y="32" fill="var(--map-label)" fontSize="11" fontWeight="700" letterSpacing="2" opacity="0.8">
            OFFLINE TACTICAL GRID · QDRANT HNSW
          </text>

          {/* Compass Rose Mini-Indicator */}
          <g transform={`translate(${WIDTH - 36}, 32)`} opacity="0.75">
            <circle cx="0" cy="0" r="14" fill="none" stroke="var(--map-road-line)" strokeWidth="1" />
            <polygon points="0,-11 -4,-1 4,-1" fill="#ef4444" />
            <polygon points="0,11 -4,1 4,1" fill="var(--map-road-line)" />
            <text x="0" y="-14" textAnchor="middle" fill="#ef4444" fontSize="8" fontWeight="bold">N</text>
          </g>

          {/* Safe Route Guidance Vector Line (Sample Vector Reroute) */}
          <path
            d="M 300 170 Q 230 140 180 100"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="3.5"
            strokeDasharray="6 4"
            opacity="0.85"
          />

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
              YOU (SURVIVOR)
            </text>
          </g>

          {/* Incident / Hazard / Checkpoint Pins */}
          {items.filter((item) => item.location).map((item) => {
            const point = project(item.location);
            const isHazard = item.kind === 'hazard' || item.severity === 'red';
            const isResource = item.kind === 'resource';
            const isCheckpoint = item.kind === 'checkpoint';
            const fill = isHazard ? '#ef4444' : isResource ? '#10b981' : isCheckpoint ? '#3b82f6' : '#f59e0b';

            return (
              <g
                key={item.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onMarker?.(item);
                }}
                className="cursor-pointer group"
              >
                {/* Hazard Warning Ring */}
                {isHazard && (
                  <circle cx={point.x} cy={point.y} r="20" fill="url(#hazard-stripes)" stroke="#ef4444" strokeWidth="1" strokeDasharray="3 2" />
                )}
                <circle cx={point.x} cy={point.y} r="12" fill={fill} opacity=".25" />
                <circle cx={point.x} cy={point.y} r="6" fill={fill} stroke="#ffffff" strokeWidth="2" />
                <text
                  x={point.x}
                  y={point.y - 10}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="9"
                  fontWeight="bold"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,0.95)' }}
                >
                  {item.entity_id || item.kind}
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
                  e.stopPropagation();
                  onSelectPeer?.(peer);
                }}
                className="cursor-pointer"
              >
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

          {/* Custom User Target Pin */}
          {selected && (
            <g>
              <line x1={project(selected).x - 12} y1={project(selected).y} x2={project(selected).x + 12} y2={project(selected).y} stroke="#0ea5e9" strokeWidth="2" />
              <line x1={project(selected).x} y1={project(selected).y - 12} x2={project(selected).x} y2={project(selected).y + 12} stroke="#0ea5e9" strokeWidth="2" />
              <circle cx={project(selected).x} cy={project(selected).y} r="10" fill="none" stroke="#0ea5e9" strokeWidth="3" />
              <circle cx={project(selected).x} cy={project(selected).y} r="3" fill="#ffffff" />
            </g>
          )}
        </svg>

        {/* Floating Active Badges */}
        <div className="absolute right-3.5 bottom-3.5 text-[10px] font-mono bg-slate-950/85 px-2.5 py-1 rounded-xl text-slate-300 border border-slate-800 shadow-md">
          5 km HNSW Radius · Local Mesh
        </div>

        {validPeers.length > 0 && (
          <div className="absolute left-3.5 top-3.5 text-[11px] font-bold bg-slate-950/85 border border-emerald-500/40 px-3 py-1.5 rounded-xl text-emerald-300 flex items-center gap-2 shadow-lg backdrop-blur-md">
            <Radio size={13} className="text-emerald-400 animate-pulse" />
            <span>{validPeers.length} Peer Node{validPeers.length > 1 ? 's' : ''} on Wi-Fi</span>
          </div>
        )}
      </div>

      {/* Map Legend & Positioning Guide */}
      <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 mt-3 px-1 gap-2">
        <div className="flex items-center gap-2">
          <MapPin size={14} className="text-cyan-400 shrink-0" />
          <span>{onSelect ? 'Tap grid to reposition pin. ' : ''}Center: {center.lat.toFixed(4)}, {center.lon.toFixed(4)}</span>
        </div>

        <div className="flex items-center gap-4 text-[11px] font-mono">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"></span> Safe Shelter
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span> Hazard / Danger
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span> Peer Device
          </span>
        </div>
      </div>
    </div>
  );
}
