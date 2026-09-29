import { AlertCircle, Upload, ArrowRight } from 'lucide-react';

export default function CentralHQ() {
    return (
        <div className="min-h-screen bg-[#050914] text-white font-sans flex flex-col">

            {/* --- TOP HEADER --- */}
            <header className="flex justify-between items-center px-10 py-6 border-b border-gray-800">
                <div className="flex items-center gap-10">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="text-rescue-red w-8 h-8" />
                        <span className="text-3xl font-bold">RescueMemory</span>
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-gray-200">Central Rescue HQ</h2>
                        <p className="text-base text-gray-500 font-mono mt-1">central_HQ · :8000 · last uplink 09:52 from Volunteer V</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="bg-green-900/30 border border-green-700 text-green-400 px-6 py-2.5 rounded-full text-lg font-bold flex items-center gap-3">
                        <Upload className="w-5 h-5" />
                        Uplink restored
                    </div>
                    <span className="text-3xl font-mono text-gray-400">10:05</span>
                </div>
            </header>

            {/* --- STATS ROW --- */}
            <div className="grid grid-cols-5 gap-6 p-8 pb-4">
                {/* Stat 1 */}
                <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-7">
                    <div className="text-gray-400 text-base mb-3">Devices heard from</div>
                    <div className="text-6xl font-bold mb-3">6</div>
                    <div className="text-gray-500 text-base">4 survivors · 1 volunteer · HQ</div>
                </div>
                {/* Stat 2 */}
                <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-7">
                    <div className="text-gray-400 text-base mb-3">Events in ledger</div>
                    <div className="text-6xl font-bold mb-3">7</div>
                    <div className="text-gray-500 text-base">0 duplicates · 0 rejected</div>
                </div>
                {/* Stat 3 - Red highlight */}
                <div className="bg-red-950/40 border-2 border-red-800 rounded-2xl p-7">
                    <div className="text-gray-400 text-base mb-3">Immediate casualties</div>
                    <div className="text-6xl font-bold mb-3 text-red-500">2</div>
                    <div className="text-gray-400 text-base">1 responder en route</div>
                </div>
                {/* Stat 4 */}
                <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-7">
                    <div className="text-gray-400 text-base mb-3">Unsafe checkpoints</div>
                    <div className="text-6xl font-bold mb-3 text-orange-400">1</div>
                    <div className="text-gray-500 text-base">CP-17 · 1 conflict open</div>
                </div>
                {/* Stat 5 */}
                <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-7">
                    <div className="text-gray-400 text-base mb-3">Longest relay</div>
                    <div className="text-6xl font-bold mb-3 font-mono">3 <span className="text-4xl text-gray-400">hops</span></div>
                    <div className="text-gray-500 text-base">Survivor C → HQ</div>
                </div>
            </div>

            {/* --- MAIN CONTENT: Map + Incident Stream --- */}
            <div className="flex-grow px-8 pb-8 grid grid-cols-12 gap-6">

                {/* LEFT: Map (7 cols) */}
                <div className="col-span-7 bg-[#0b1120] border border-gray-800 rounded-2xl relative overflow-hidden" style={{ minHeight: '650px' }}>

                    {/* Map Background - Roads */}
                    <div className="absolute inset-0 z-0">
                        {/* Vertical roads */}
                        <div className="absolute top-0 left-[20%] w-12 h-full bg-[#151e32]"></div>
                        <div className="absolute top-0 left-[55%] w-12 h-full bg-[#151e32]"></div>
                        {/* Horizontal roads */}
                        <div className="absolute top-[30%] left-0 w-full h-12 bg-[#151e32]"></div>
                        <div className="absolute top-[60%] left-0 w-full h-12 bg-[#151e32]"></div>

                        {/* River (blue curved band at bottom) */}
                        <div className="absolute bottom-[15%] left-0 w-full h-20 bg-blue-900/40 -rotate-2"></div>
                        <div className="absolute bottom-[18%] left-0 w-full h-10 bg-blue-800/30 -rotate-2"></div>

                        {/* Buildings */}
                        <div className="absolute top-6 left-6 w-20 h-20 bg-[#0f172a] rounded border border-gray-800/50"></div>
                        <div className="absolute top-6 left-32 w-24 h-24 bg-[#0f172a] rounded border border-gray-800/50"></div>
                        <div className="absolute top-6 right-6 w-24 h-20 bg-[#0f172a] rounded border border-gray-800/50"></div>
                        <div className="absolute top-6 right-36 w-20 h-24 bg-[#0f172a] rounded border border-gray-800/50"></div>
                        <div className="absolute bottom-6 left-6 w-24 h-24 bg-[#0f172a] rounded border border-gray-800/50"></div>
                        <div className="absolute bottom-6 right-6 w-28 h-20 bg-[#0f172a] rounded border border-gray-800/50"></div>
                        <div className="absolute bottom-6 right-40 w-20 h-24 bg-[#0f172a] rounded border border-gray-800/50"></div>
                    </div>

                    {/* SVG Layer for dashed circle ONLY (Red line removed) */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 10 }}>
                        {/* Dashed red circle around CP-17 */}
                        <circle cx="38%" cy="65%" r="120" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="10 8" opacity="0.5" />
                    </svg>

                    {/* Hazard Zone - CP-17 */}
                    <div className="absolute z-10" style={{ top: '65%', left: '38%', transform: 'translate(-50%, -50%)' }}>
                        <div className="w-44 h-44 rounded-full border-4 border-red-500 bg-red-900/25 relative overflow-hidden">
                            <div className="absolute inset-0" style={{
                                backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 8px, rgba(239, 68, 68, 0.3) 8px, rgba(239, 68, 68, 0.3) 16px)'
                            }}></div>
                        </div>
                        {/* CP-17 Marker */}
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-20">
                            <div className="bg-red-500 border-4 border-[#0b1120] w-12 h-12 rounded-lg flex items-center justify-center shadow-xl"></div>
                        </div>
                        <div className="absolute top-1/2 left-1/2 transform -translate-y-1/2 translate-x-10 text-white font-bold text-2xl z-20 drop-shadow-lg">CP-17</div>
                    </div>

                    {/* North School - Green marker top left */}
                    <div className="absolute z-30 flex items-center gap-3" style={{ top: '8%', left: '8%' }}>
                        <div className="w-10 h-10 bg-green-500 border-4 border-[#0b1120] rounded-lg shadow-lg"></div>
                        <span className="text-white font-bold text-xl drop-shadow-lg">North School</span>
                    </div>
                    {/* Green dot below North School */}
                    <div className="absolute z-30" style={{ top: '20%', left: '13%' }}>
                        <div className="w-8 h-8 bg-green-400 rounded-full border-2 border-green-600 shadow-lg"></div>
                    </div>

                    {/* Tanker 4 - Green marker */}
                    <div className="absolute z-30 flex items-center gap-3" style={{ top: '42%', left: '42%' }}>
                        <div className="w-10 h-10 bg-green-500 border-4 border-[#0b1120] rounded-lg shadow-lg"></div>
                        <span className="text-white font-bold text-xl drop-shadow-lg">Tanker 4</span>
                    </div>

                    {/* Shelter Alpha - Green marker */}
                    <div className="absolute z-30 flex items-center gap-3" style={{ top: '52%', left: '22%' }}>
                        <div className="w-10 h-10 bg-green-500 border-4 border-[#0b1120] rounded-lg shadow-lg"></div>
                        <span className="text-white font-bold text-xl drop-shadow-lg">Shelter Alpha</span>
                    </div>

                    {/* Clinic Beta - Green marker */}
                    <div className="absolute z-30 flex items-center gap-3" style={{ bottom: '12%', left: '42%' }}>
                        <div className="w-10 h-10 bg-green-500 border-4 border-[#0b1120] rounded-lg shadow-lg"></div>
                        <span className="text-white font-bold text-xl drop-shadow-lg">Clinic Beta</span>
                    </div>

                    {/* Red danger dots */}
                    <div className="absolute z-30" style={{ top: '48%', left: '58%' }}>
                        <div className="w-10 h-10 bg-red-500/30 rounded-full flex items-center justify-center">
                            <div className="w-5 h-5 bg-red-500 rounded-full border-2 border-red-700"></div>
                        </div>
                    </div>
                    <div className="absolute z-30" style={{ top: '58%', left: '48%' }}>
                        <div className="w-10 h-10 bg-red-500/30 rounded-full flex items-center justify-center">
                            <div className="w-5 h-5 bg-red-500 rounded-full border-2 border-red-700"></div>
                        </div>
                    </div>

                    {/* Orange delayed dot */}
                    <div className="absolute z-30" style={{ top: '62%', left: '15%' }}>
                        <div className="w-10 h-10 bg-orange-500/30 rounded-full flex items-center justify-center">
                            <div className="w-5 h-5 bg-orange-500 rounded-full border-2 border-orange-700"></div>
                        </div>
                    </div>

                    {/* Green dot far right */}
                    <div className="absolute z-30" style={{ bottom: '22%', right: '8%' }}>
                        <div className="w-10 h-10 bg-green-500 border-4 border-[#0b1120] rounded-lg shadow-lg"></div>
                    </div>

                    {/* Legend at bottom left */}
                    <div className="absolute bottom-6 left-6 flex gap-8 z-30 bg-[#0b1120]/90 py-4 px-6 rounded-xl border border-gray-800">
                        <div className="flex items-center gap-3 text-lg text-gray-300">
                            <div className="w-4 h-4 bg-green-500 rounded-full"></div> Open
                        </div>
                        <div className="flex items-center gap-3 text-lg text-gray-300">
                            <div className="w-4 h-4 bg-red-500 rounded-full"></div> Danger / immediate
                        </div>
                        <div className="flex items-center gap-3 text-lg text-gray-300">
                            <div className="w-4 h-4 bg-orange-500 rounded-full"></div> Delayed
                        </div>
                    </div>
                </div>

                {/* RIGHT: Incident Stream (5 cols) */}
                <div className="col-span-5 bg-[#0f172a] border border-gray-800 rounded-2xl p-8 flex flex-col">
                    <div className="flex justify-between items-center mb-8">
                        <h3 className="text-4xl font-bold">Incident stream</h3>
                        <span className="text-gray-500 font-mono text-base tracking-widest">WITH RELAY PATH</span>
                    </div>

                    <div className="flex-grow space-y-2 overflow-y-auto">
                        {/* Incident 1 */}
                        <div className="flex items-start gap-5 py-5 border-b border-gray-800">
                            <div className="w-4 h-4 bg-red-500 rounded-full mt-2 flex-shrink-0"></div>
                            <div className="flex-grow">
                                <div className="flex items-baseline gap-4">
                                    <span className="text-gray-500 font-mono text-xl">09:31</span>
                                    <span className="text-white font-bold text-xl">Casualty: spurting thigh bleed</span>
                                </div>
                                <div className="text-gray-500 text-base mt-2 ml-20">Survivor A → V → HQ</div>
                            </div>
                        </div>

                        {/* Incident 2 */}
                        <div className="flex items-start gap-5 py-5 border-b border-gray-800">
                            <div className="w-4 h-4 bg-red-500 rounded-full mt-2 flex-shrink-0"></div>
                            <div className="flex-grow">
                                <div className="flex items-baseline gap-4">
                                    <span className="text-gray-500 font-mono text-xl">09:25</span>
                                    <span className="text-white font-bold text-xl">CP-17 flooded, live wires</span>
                                </div>
                                <div className="text-gray-500 text-base mt-2 ml-20">Survivor A → B → V → HQ</div>
                            </div>
                        </div>

                        {/* Incident 3 */}
                        <div className="flex items-start gap-5 py-5 border-b border-gray-800">
                            <div className="w-4 h-4 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                            <div className="flex-grow">
                                <div className="flex items-baseline gap-4">
                                    <span className="text-gray-500 font-mono text-xl">09:20</span>
                                    <span className="text-white font-bold text-xl">Water at North School tap</span>
                                </div>
                                <div className="text-gray-500 text-base mt-2 ml-20">Survivor B → V → HQ</div>
                            </div>
                        </div>

                        {/* Incident 4 */}
                        <div className="flex items-start gap-5 py-5 border-b border-gray-800">
                            <div className="w-4 h-4 bg-red-500 rounded-full mt-2 flex-shrink-0"></div>
                            <div className="flex-grow">
                                <div className="flex items-baseline gap-4">
                                    <span className="text-gray-500 font-mono text-xl">09:12</span>
                                    <span className="text-white font-bold text-xl">Elderly woman, hypothermia</span>
                                </div>
                                <div className="text-gray-500 text-base mt-2 ml-20">Survivor B → V → HQ</div>
                            </div>
                        </div>

                        {/* Incident 5 */}
                        <div className="flex items-start gap-5 py-5 border-b border-gray-800">
                            <div className="w-4 h-4 bg-orange-500 rounded-full mt-2 flex-shrink-0"></div>
                            <div className="flex-grow">
                                <div className="flex items-baseline gap-4">
                                    <span className="text-gray-500 font-mono text-xl">09:08</span>
                                    <span className="text-white font-bold text-xl">Suspected broken forearm</span>
                                </div>
                                <div className="text-gray-500 text-base mt-2 ml-20">Survivor C → B → V → HQ</div>
                            </div>
                        </div>

                        {/* Incident 6 */}
                        <div className="flex items-start gap-5 py-5">
                            <div className="w-4 h-4 bg-blue-400 rounded-full mt-2 flex-shrink-0"></div>
                            <div className="flex-grow">
                                <div className="flex items-baseline gap-4">
                                    <span className="text-gray-500 font-mono text-xl">09:00</span>
                                    <span className="text-white font-bold text-xl">Reference pack published</span>
                                </div>
                                <div className="text-gray-500 text-base mt-2 ml-20">HQ</div>
                            </div>
                        </div>
                    </div>

                    {/* Open conflict button */}
                    <button className="mt-8 w-full bg-[#0b1120] border border-gray-700 hover:border-gray-500 text-white font-bold text-xl py-5 rounded-xl flex items-center justify-center gap-3 transition">
                        Open conflict: CP-17
                        <ArrowRight className="w-6 h-6" />
                    </button>
                </div>

            </div>
        </div>
    );
}