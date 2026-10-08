import { peerRadarPosition, radarDistance } from '../brain/meshRadar.js';

// Radar artwork restored from MeshSyncScanner.jsx at commit 3608341.
const GRID_SIZE = 260;
const GRID_CENTER = GRID_SIZE / 2;
const MAX_RADIUS = 105;

export default function MeshRadar({ peers, location, scanning, onSelect }) {
  const dots = peers.filter(peer => peer.available).map(peer => ({ peer, ...peerRadarPosition(location, peer) }));
  const radius = Math.max(100, ...dots.map(dot => dot.distance_m || 0));
  const scale = radius <= 100 ? 100 : radius <= 500 ? 500 : radius <= 1000 ? 1000 : Math.ceil(radius / 1000) * 1000;
  return <div className="my-4 flex flex-col items-center">
    <div className="relative my-0.5 flex h-[210px] w-[210px] items-center justify-center sm:h-[240px] sm:w-[240px]">
      <svg viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`} className="h-full w-full select-none drop-shadow-md" role="group"
        aria-label={`Nearby phone radar, ${dots.length} phones. North is up. Signal estimates have no measured direction.`}>
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

        <g className="animate-[spin_4s_linear_infinite] motion-reduce:animate-none" style={{ transformOrigin: `${GRID_CENTER}px ${GRID_CENTER}px` }}>
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

        {dots.map((dot, index) => {
          const angle = (dot.bearing_deg ?? dot.display_angle ?? 0) * Math.PI / 180;
          const range = dot.distance_m == null ? 45 : Math.min(MAX_RADIUS - 15, Math.max(12, dot.distance_m / scale * (MAX_RADIUS - 15)));
          const px = GRID_CENTER + range * Math.sin(angle), py = GRID_CENTER - range * Math.cos(angle);
          const color = '#38bdf8';
          const label = `${dot.peer.name || 'Phone'}: ${radarDistance(dot.distance_m)}, ${dot.source === 'gps' ? 'GPS position' : 'signal estimate, direction unknown'}`;
          return <g key={dot.peer.node_id} className="cursor-pointer" role="button" tabIndex={0} aria-label={label}
            onClick={() => onSelect?.(dot.peer)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(dot.peer); } }}>
            <title>{label}</title>
            <circle cx={px} cy={py} r="14" fill="none" stroke={color} strokeWidth="1" strokeDasharray="2 2" className="animate-ping motion-reduce:animate-none" opacity="0.6" />
            <circle cx={px} cy={py} r="8" fill={color} opacity="0.25" />
            <circle cx={px} cy={py} r="4.5" fill={dot.source === 'gps' ? color : '#091424'} stroke={dot.source === 'gps' ? '#ffffff' : color} strokeWidth="1.5" strokeDasharray={dot.source === 'gps' ? undefined : '2 2'} />
            <text x={px} y={py - 7} textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="bold"
              style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>{dot.peer.name ? dot.peer.name.slice(0, 10) : `Phone ${index + 1}`}</text>
          </g>;
        })}
      </svg>
    </div>
    <p className="mt-2 text-center text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">{scanning ? 'Scanning nearby phones' : 'Nearby phones'} · {radarDistance(scale)} range · north up<br />Solid dots: GPS position · outlined dots: signal estimate, direction unknown</p>
  </div>;
}
