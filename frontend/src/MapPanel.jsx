import { MapPin } from 'lucide-react';

const WIDTH = 600;
const HEIGHT = 340;

export default function MapPanel({ center, items = [], selected, onSelect, onMarker }) {
  const span = 0.012;
  const project = (location) => ({
    x: Math.max(14, Math.min(WIDTH - 14, WIDTH / 2 + (location.lon - center.lon) / span * WIDTH)),
    y: Math.max(14, Math.min(HEIGHT - 14, HEIGHT / 2 - (location.lat - center.lat) / span * HEIGHT)),
  });
  const pick = (event) => {
    if (!onSelect) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    onSelect({ lat: Number((center.lat + (0.5 - y) * span).toFixed(6)),
               lon: Number((center.lon + (x - 0.5) * span).toFixed(6)) });
  };
  return (
    <div>
      <div className="relative rounded-2xl overflow-hidden border border-slate-700 bg-[#0b2131]">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Offline coordinate grid with report markers"
          className={`w-full h-auto min-h-[240px] ${onSelect ? 'cursor-crosshair' : ''}`} onClick={pick}>
          <defs><pattern id="map-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#24445a" strokeWidth="1" /></pattern></defs>
          <rect width={WIDTH} height={HEIGHT} fill="#0b2131" /><rect width={WIDTH} height={HEIGHT} fill="url(#map-grid)" />
          <path d="M-10 270 Q130 225 245 250 T610 130" stroke="#325873" strokeWidth="25" fill="none" opacity=".65" />
          <path d="M-10 270 Q130 225 245 250 T610 130" stroke="#6788a0" strokeWidth="2" fill="none" strokeDasharray="8 8" opacity=".8" />
          <path d="M160 -10 Q180 110 290 160 T450 350" stroke="#244a64" strokeWidth="15" fill="none" opacity=".65" />
          <text x="25" y="42" fill="#6eacc8" fontSize="13" letterSpacing="2">OFFLINE LOCATION GRID</text>
          <circle cx={WIDTH / 2} cy={HEIGHT / 2} r="6" fill="#38bdf8" /><circle cx={WIDTH / 2} cy={HEIGHT / 2} r="17" fill="none" stroke="#38bdf8" strokeWidth="2" opacity=".6" />
          {items.filter((item) => item.location).map((item) => {
            const point = project(item.location);
            const fill = item.kind === 'hazard' || item.severity === 'red' ? '#fb7185' : item.kind === 'resource' ? '#34d399' : '#fbbf24';
            return <g key={item.id} onClick={(event) => { event.stopPropagation(); onMarker?.(item); }} className="cursor-pointer">
              <circle cx={point.x} cy={point.y} r="13" fill={fill} opacity=".2" />
              <circle cx={point.x} cy={point.y} r="6" fill={fill} stroke="#08111d" strokeWidth="2" />
            </g>;
          })}
          {selected && <g><circle cx={project(selected).x} cy={project(selected).y} r="10" fill="#e0f2fe" stroke="#0ea5e9" strokeWidth="4" /></g>}
        </svg>
        <div className="absolute right-3 bottom-3 text-[11px] bg-slate-950/90 px-2 py-1 rounded-md text-slate-300">~1.3 km around center · schematic</div>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400 mt-2"><MapPin size={14} /> {onSelect ? 'Tap the grid to place a report pin. ' : ''}Center {center.lat.toFixed(4)}, {center.lon.toFixed(4)}. No online map tiles required.</div>
    </div>
  );
}
