import { CheckSquare, Square, Droplet, AlertCircle, Route } from 'lucide-react';

export default function SafePlace() {
    return (
        <div className="min-h-screen bg-[#050914] text-white font-sans flex flex-col">

            {/* --- TOP HEADER --- */}
            <header className="flex justify-between items-center px-10 py-5 border-b border-gray-800">
                <div className="flex items-center gap-10">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="text-rescue-red w-7 h-7" />
                        <span className="text-2xl font-bold">RescueMemory</span>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-200">Find me a safe place</h2>
                        <p className="text-sm text-gray-500 font-mono mt-1">Node A · 09:15 · searched within walking distance, offline</p>
                    </div>
                </div>
                <div className="bg-red-900/30 border border-red-800 text-red-500 px-5 py-2 rounded-full text-base font-bold flex items-center gap-3">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    OFFLINE
                </div>
            </header>

            {/* --- MAIN CONTENT --- */}
            <div className="flex-grow p-8 grid grid-cols-12 gap-8">

                {/* LEFT COLUMN: Filters */}
                <div className="col-span-3 bg-[#0f172a] border border-gray-800 rounded-2xl p-8 flex flex-col">
                    <h3 className="text-3xl font-bold mb-10">Find a safer location</h3>

                    <div className="mb-10">
                        <h4 className="text-sm text-gray-500 font-bold tracking-widest mb-6">YOUR NEEDS</h4>
                        <div className="space-y-5">
                            <label className="flex items-center gap-4 cursor-pointer group">
                                <CheckSquare className="w-7 h-7 text-green-500" />
                                <span className="text-xl group-hover:text-gray-300">Water</span>
                            </label>
                            <label className="flex items-center gap-4 cursor-pointer group">
                                <CheckSquare className="w-7 h-7 text-green-500" />
                                <span className="text-xl group-hover:text-gray-300">Medical</span>
                            </label>
                            <label className="flex items-center gap-4 cursor-pointer group">
                                <CheckSquare className="w-7 h-7 text-green-500" />
                                <span className="text-xl group-hover:text-gray-300">Shelter</span>
                            </label>
                            <label className="flex items-center gap-4 cursor-pointer group">
                                <Square className="w-7 h-7 text-gray-600" />
                                <span className="text-xl text-gray-400 group-hover:text-gray-300">Food</span>
                            </label>
                        </div>
                    </div>

                    <div className="mb-10">
                        <h4 className="text-sm text-gray-500 font-bold tracking-widest mb-6">AVOID</h4>
                        <div className="space-y-5">
                            <label className="flex items-center gap-4 cursor-pointer group">
                                <CheckSquare className="w-7 h-7 text-green-500" />
                                <span className="text-xl group-hover:text-gray-300">Flooded areas</span>
                            </label>
                            <label className="flex items-center gap-4 cursor-pointer group">
                                <CheckSquare className="w-7 h-7 text-green-500" />
                                <span className="text-xl group-hover:text-gray-300">Electrical hazard</span>
                            </label>
                        </div>
                    </div>

                    <div className="mt-auto">
                        <h4 className="text-sm text-gray-500 font-bold tracking-widest mb-5">WALKING RADIUS</h4>
                        <div className="flex justify-between items-end mb-3">
                            <span className="text-4xl font-bold font-mono">1.5 <span className="text-xl text-gray-400">km</span></span>
                            <span className="text-gray-400 text-lg">~20 min</span>
                        </div>
                        <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full w-2/3 bg-blue-500 rounded-full"></div>
                        </div>
                    </div>
                </div>

                {/* MIDDLE COLUMN: Shelter List */}
                <div className="col-span-4 flex flex-col gap-5">
                    <h4 className="text-sm text-gray-500 font-bold tracking-widest mb-2">SUGGESTED SHELTERS · UNSAFE ONES EXCLUDED</h4>

                    {/* Shelter Card 1 */}
                    <div className="bg-[#0f172a] border-2 border-blue-600 rounded-2xl p-7 hover:border-blue-400 transition shadow-lg shadow-blue-900/20">
                        <div className="flex justify-between items-start mb-3">
                            <h3 className="text-2xl font-bold">Shelter Alpha</h3>
                            <span className="bg-green-900/40 text-green-400 border border-green-700 px-3 py-1 rounded-full text-sm font-bold">Operational</span>
                        </div>
                        <p className="text-gray-400 text-lg mb-4">Community hall · 510 m · 7 min walk</p>
                        <div className="flex gap-2 mb-5 flex-wrap">
                            <span className="bg-blue-900/30 text-blue-400 border border-blue-700 px-4 py-1.5 rounded-full text-sm flex items-center gap-2"><Droplet className="w-4 h-4" /> Water</span>
                            <span className="bg-gray-800 text-gray-300 border border-gray-700 px-4 py-1.5 rounded-full text-sm">Food</span>
                            <span className="bg-gray-800 text-gray-300 border border-gray-700 px-4 py-1.5 rounded-full text-sm">Shelter</span>
                            <span className="bg-gray-800 text-gray-300 border border-gray-700 px-4 py-1.5 rounded-full text-sm">300 beds</span>
                        </div>
                        <button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-lg py-4 rounded-xl flex items-center justify-center gap-3 transition shadow-lg shadow-blue-900/30">
                            <Route className="w-5 h-5" /> Navigate
                        </button>
                    </div>

                    {/* Shelter Card 2 */}
                    <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-7">
                        <div className="flex justify-between items-start mb-3">
                            <h3 className="text-2xl font-bold">Clinic Beta</h3>
                            <span className="bg-green-900/40 text-green-400 border border-green-700 px-3 py-1 rounded-full text-sm font-bold">Operational</span>
                        </div>
                        <p className="text-gray-400 text-lg mb-4">Primary clinic · 530 m · 7 min walk</p>
                        <div className="flex gap-2 flex-wrap">
                            <span className="bg-blue-900/30 text-blue-400 border border-blue-700 px-4 py-1.5 rounded-full text-sm">Medical</span>
                            <span className="bg-blue-900/30 text-blue-400 border border-blue-700 px-4 py-1.5 rounded-full text-sm">Water</span>
                        </div>
                    </div>

                    {/* Shelter Card 3 */}
                    <div className="bg-[#0f172a] border border-gray-800 rounded-2xl p-7">
                        <div className="flex justify-between items-start mb-3">
                            <h3 className="text-2xl font-bold">Water Tanker 4</h3>
                            <span className="bg-green-900/40 text-green-400 border border-green-700 px-3 py-1 rounded-full text-sm font-bold">Operational</span>
                        </div>
                        <p className="text-gray-400 text-lg mb-4">Municipal tanker · 560 m · 8 min walk</p>
                        <div className="flex gap-2 flex-wrap">
                            <span className="bg-blue-900/30 text-blue-400 border border-blue-700 px-4 py-1.5 rounded-full text-sm">Water</span>
                        </div>
                    </div>

                    {/* Exclusion Warning */}
                    <div className="bg-red-900/20 border border-red-800 rounded-2xl p-5 flex items-center gap-4 text-red-400">
                        <AlertCircle className="w-6 h-6 flex-shrink-0" />
                        <span className="text-lg font-medium">CP-17 excluded · flooded, live wires</span>
                    </div>
                </div>

                {/* RIGHT COLUMN: Map */}
                <div className="col-span-5 bg-[#0b1120] border border-gray-800 rounded-2xl relative overflow-hidden" style={{ minHeight: '750px' }}>

                    {/* Map Background - Roads */}
                    <div className="absolute inset-0 z-0">
                        {/* Vertical road (left side) */}
                        <div className="absolute top-0 left-[15%] w-14 h-full bg-[#151e32]"></div>
                        {/* Vertical road (right side) */}
                        <div className="absolute top-0 left-[60%] w-14 h-full bg-[#151e32]"></div>
                        {/* Horizontal road (middle) */}
                        <div className="absolute top-[35%] left-0 w-full h-14 bg-[#151e32]"></div>
                        {/* Diagonal road (bottom) */}
                        <div className="absolute bottom-[15%] left-0 w-full h-20 bg-[#151e32] -rotate-2 origin-left"></div>

                        {/* Buildings (dark blocks) */}
                        <div className="absolute top-6 left-6 w-20 h-20 bg-[#0f172a] rounded-lg border border-gray-800/50"></div>
                        <div className="absolute top-6 left-32 w-24 h-24 bg-[#0f172a] rounded-lg border border-gray-800/50"></div>
                        <div className="absolute top-6 right-6 w-28 h-20 bg-[#0f172a] rounded-lg border border-gray-800/50"></div>
                        <div className="absolute top-6 right-40 w-24 h-24 bg-[#0f172a] rounded-lg border border-gray-800/50"></div>
                        <div className="absolute bottom-6 left-6 w-32 h-28 bg-[#0f172a] rounded-lg border border-gray-800/50"></div>
                        <div className="absolute bottom-6 right-6 w-24 h-24 bg-[#0f172a] rounded-lg border border-gray-800/50"></div>
                        <div className="absolute top-[45%] right-6 w-28 h-24 bg-[#0f172a] rounded-lg border border-gray-800/50"></div>
                        <div className="absolute top-[55%] left-6 w-36 h-32 bg-[#0f172a] rounded-lg border border-gray-800/50"></div>
                    </div>

                    {/* SVG Layer for Route and Dashed Circle */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 10 }}>
                        {/* Dashed red circle around hazard zone */}
                        <circle cx="62%" cy="48%" r="180" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="12 8" opacity="0.5" />

                        {/* Main route line - thick blue */}
                        <line x1="38%" y1="82%" x2="22%" y2="28%" stroke="#60a5fa" strokeWidth="8" strokeLinecap="round" />
                        {/* White dashed overlay on route */}
                        <line x1="38%" y1="82%" x2="22%" y2="28%" stroke="white" strokeWidth="2" strokeDasharray="10 10" strokeLinecap="round" opacity="0.6" />
                    </svg>

                    {/* Hazard Zone - Red Circle with Stripes */}
                    <div className="absolute z-10" style={{ top: '48%', left: '62%', transform: 'translate(-50%, -50%)' }}>
                        <div className="w-64 h-64 rounded-full border-4 border-red-500 bg-red-900/25 relative overflow-hidden">
                            {/* Diagonal stripes */}
                            <div className="absolute inset-0" style={{
                                backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 10px, rgba(239, 68, 68, 0.35) 10px, rgba(239, 68, 68, 0.35) 20px)'
                            }}></div>
                        </div>

                        {/* CP-17 Marker (red square inside circle) */}
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-20">
                            <div className="bg-red-500 border-4 border-[#0b1120] w-14 h-14 rounded-xl flex items-center justify-center shadow-2xl">
                            </div>
                        </div>

                        {/* CP-17 Label (next to marker) */}
                        <div className="absolute top-1/2 left-1/2 transform -translate-y-1/2 translate-x-10 text-white font-bold text-2xl z-20 drop-shadow-lg">
                            CP-17
                        </div>
                    </div>

                    {/* You are here - Blue Circle at bottom center */}
                    <div className="absolute z-30" style={{ bottom: '15%', left: '35%', transform: 'translateX(-50%)' }}>
                        <div className="w-14 h-14 bg-blue-400 border-4 border-white rounded-full shadow-2xl shadow-blue-500/50"></div>
                    </div>

                    {/* Shelter Alpha - Green Square upper left */}
                    <div className="absolute z-30 flex items-center gap-3" style={{ top: '22%', left: '18%' }}>
                        <div className="w-12 h-12 bg-green-500 border-4 border-[#0b1120] rounded-xl shadow-2xl shadow-green-500/50"></div>
                        <span className="text-white font-bold text-2xl drop-shadow-lg whitespace-nowrap">Shelter Alpha</span>
                    </div>

                    {/* Tanker 4 - Green Square top right */}
                    <div className="absolute z-30 flex items-center gap-3" style={{ top: '5%', right: '5%' }}>
                        <div className="w-10 h-10 bg-green-500 border-4 border-[#0b1120] rounded-lg shadow-2xl shadow-green-500/50"></div>
                        <span className="text-white font-bold text-xl drop-shadow-lg whitespace-nowrap">Tanker 4</span>
                    </div>

                    {/* Legend at bottom */}
                    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-8 z-30">
                        <div className="flex items-center gap-2 text-base text-gray-400">
                            <div className="w-3 h-3 bg-blue-400 rounded-full"></div> You are here
                        </div>
                        <div className="flex items-center gap-2 text-base text-gray-400">
                            <div className="w-8 h-1.5 bg-blue-400 rounded"></div> Safe route
                        </div>
                        <div className="flex items-center gap-2 text-base text-gray-400">
                            <div className="w-3 h-3 bg-red-500 rounded-full"></div> Hazard zone
                        </div>
                    </div>

                </div>

            </div>
        </div>
    );
}