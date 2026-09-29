import { MapPin, Radio, Wifi } from 'lucide-react';

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
    x: Math.max(14, Math.min(WIDTH - 14, WIDTH / 2 + (location.lon - center.lon) / span * WIDTH)),
    y: Math.max(14, Math.min(HEIGHT - 14, HEIGHT / 2 - (location.lat - center.lat) / span * HEIGHT)),
  });

  const pick = (event) => {
    if (!onSelect) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    onSelect({
      lat: Number((center.lat + (0.5 - y) * span).toFixed(6)),
      lon: Number((center.lon + (x - 0.5) * span).toFixed(6))
    });
  };

  const validPeers = peers.filter((p) => p.lat != null && p.lon != null);

  return (
    <div>
      <div className="relative rounded-2xl overflow-hidden border border-slate-700 bg-[#0b2131]">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Offline coordinate grid with report markers and nearby peer devices"
          className={`w-full h-auto min-h-[240px] ${onSelect ? 'cursor-crosshair' : ''}`}
          onClick={pick}
        >
          <defs>
            <pattern id="map-grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="var(--map-grid)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={WIDTH} height={HEIGHT} fill="var(--map-bg)" />
          <rect width={WIDTH} height={HEIGHT} fill="url(#map-grid)" />
          <path d="M-10 270 Q130 225 245 250 T610 130" stroke="var(--map-road)" strokeWidth="25" fill="none" opacity=".65" />
          <path d="M-10 270 Q130 225 245 250 T610 130" stroke="var(--map-road-line)" strokeWidth="2" fill="none" strokeDasharray="8 8" opacity=".8" />
          <path d="M160 -10 Q180 110 290 160 T450 350" stroke="var(--map-road)" strokeWidth="15" fill="none" opacity=".65" />
          <text x="25" y="42" fill="var(--map-label)" fontSize="13" letterSpacing="2">OFFLINE LOCATION GRID</text>

          {/* Local User Location */}
          <circle cx={WIDTH / 2} cy={HEIGHT / 2} r="6" fill="#38bdf8" />
          <circle cx={WIDTH / 2} cy={HEIGHT / 2} r="18" fill="none" stroke="#38bdf8" strokeWidth="2" opacity=".6" />

          {/* Incident / Hazard / Checkpoint Pins */}
          {items.filter((item) => item.location).map((item) => {
            const point = project(item.location);
            const fill = item.kind === 'presence' ? '#38bdf8' : item.kind === 'hazard' || item.severity === 'red' ? '#fb7185' : item.kind === 'resource' ? '#34d399' : '#fbbf24';
            return (
              <g key={item.id} onClick={(event) => { event.stopPropagation(); onMarker?.(item); }} className="cursor-pointer">
                <circle cx={point.x} cy={point.y} r="13" fill={fill} opacity=".2" />
                <circle cx={point.x} cy={point.y} r="6" fill={fill} stroke="#08111d" strokeWidth="2" />
              </g>
            );
          })}

          {/* Nearby Discovered Wi-Fi Peers with Radar Ring */}
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
                {/* Radar pulse wave */}
                <circle cx={point.x} cy={point.y} r="20" fill="none" stroke={color} strokeWidth="1.5" opacity="0.4" strokeDasharray="3 3" />
                <circle cx={point.x} cy={point.y} r="12" fill={color} opacity="0.25" />
                <circle cx={point.x} cy={point.y} r="7" fill={color} stroke="#0f172a" strokeWidth="2" />
                {isSelected && (
                  <circle cx={point.x} cy={point.y} r="24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="4 4" />
                )}
                <text
                  x={point.x}
                  y={point.y - 12}
                  textAnchor="middle"
                  fill="#f1f5f9"
                  fontSize="9"
                  fontWeight="600"
                  className="select-none"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
                >
                  {peer.node_id.slice(0, 10)}
                </text>
              </g>
            );
          })}

          {/* Selected Custom Crosshair Pin */}
          {selected && (
            <g>
              <circle cx={project(selected).x} cy={project(selected).y} r="10" fill="#e0f2fe" stroke="#0ea5e9" strokeWidth="4" />
            </g>
          )}
        </svg>

        {/* Floating Active Badges */}
        <div className="absolute right-3 bottom-3 text-[11px] bg-slate-950/90 px-2 py-1 rounded-md text-slate-300">
          5 km search radius · schematic
        </div>

        {validPeers.length > 0 && (
          <div className="absolute left-3 top-3 text-[11px] bg-slate-950/90 border border-emerald-500/40 px-2.5 py-1 rounded-md text-emerald-300 flex items-center gap-1.5 shadow-lg backdrop-blur-sm">
            <Radio size={12} className="text-emerald-400 animate-pulse" />
            <span>{validPeers.length} Peer Device{validPeers.length > 1 ? 's' : ''} on Wi-Fi</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-400 mt-2">
        <div className="flex items-center gap-2">
          <MapPin size={14} />
          {onSelect ? 'Tap grid to place a report pin. ' : ''}
          Center: {center.lat.toFixed(4)}, {center.lon.toFixed(4)}
        </div>
        {validPeers.length > 0 && (
          <div className="flex items-center gap-2 text-emerald-400">
            <Wifi size={13} />
            <span>Offline Wi-Fi Auto-Discovery Active</span>
          </div>
        )}
      </div>
    </div>
  );
}
