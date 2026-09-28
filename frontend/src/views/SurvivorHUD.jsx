import { Mic, Check, Activity, Shirt, TreePine, FlaskConical, Flame, Pill, Hand, Droplet, TriangleAlert } from 'lucide-react';

export default function SurvivorHUD() {
    return (
        <div className="min-h-screen bg-[#050914] text-white font-sans p-8 flex flex-col">

            {/* --- TOP HEADER --- */}
            <header className="flex justify-between items-center mb-10 border-b border-gray-800 pb-6">
                <div className="flex items-center gap-8">
                    <div className="flex items-center gap-3">
                        <TriangleAlert className="text-rescue-red w-8 h-8" />
                        <span className="text-2xl font-bold">RescueMemory</span>
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-gray-200">Survivor crisis HUD</h2>
                        <p className="text-sm text-gray-500 font-mono mt-1">Node A · 09:00 · every answer is retrieved on this device</p>
                    </div>
                </div>
                <div className="bg-red-900/30 border border-red-800 text-red-500 px-6 py-2 rounded-full text-lg font-bold flex items-center gap-3">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    OFFLINE
                </div>
            </header>

            {/* --- MAIN CONTENT GRID --- */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-grow">

                {/* LEFT COLUMN (2/3 width) */}
                <div className="lg:col-span-2 flex flex-col gap-8">

                    {/* Card 1: What happened? */}
                    <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-8">
                        <h3 className="text-3xl font-bold mb-6">What happened?</h3>
                        <div className="bg-[#020617] border border-gray-700 rounded-lg p-6 mb-4 text-xl text-gray-300 min-h-[100px] flex items-center">
                            My brother fell near the CP-17 gate. Deep leg cut. Blood is pumping out fast.
                        </div>
                        <div className="flex justify-between items-center text-gray-500 text-base">
                            <span>Type or speak in your own words, no categories needed.</span>
                            <button className="flex items-center gap-3 bg-blue-900/20 text-blue-400 px-6 py-3 rounded-lg hover:bg-blue-900/40 transition text-lg font-medium">
                                <Mic className="w-5 h-5" /> Speak
                            </button>
                        </div>
                    </div>

                    {/* Card 2: What do you have? */}
                    <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-8">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-3xl font-bold">What do you have?</h3>
                            <span className="text-blue-400 font-mono text-xl">2 selected</span>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            {/* Selected Item */}
                            <button className="flex items-center justify-between bg-blue-900/20 border-2 border-blue-500 text-white p-5 rounded-lg text-lg">
                                <div className="flex items-center gap-3"><Shirt className="w-6 h-6" /> Cloth / T-shirt</div>
                                <Check className="w-6 h-6 text-blue-500" />
                            </button>
                            {/* Selected Item */}
                            <button className="flex items-center justify-between bg-blue-900/20 border-2 border-blue-500 text-white p-5 rounded-lg text-lg">
                                <div className="flex items-center gap-3"><TreePine className="w-6 h-6" /> Stick / branch</div>
                                <Check className="w-6 h-6 text-blue-500" />
                            </button>
                            {/* Normal Item */}
                            <button className="flex items-center gap-3 bg-[#020617] border border-gray-700 text-gray-400 p-5 rounded-lg hover:border-gray-500 text-lg">
                                <FlaskConical className="w-6 h-6" /> Plastic bottle
                            </button>
                            <button className="flex items-center gap-3 bg-[#020617] border border-gray-700 text-gray-400 p-5 rounded-lg hover:border-gray-500 text-lg">
                                <Flame className="w-6 h-6" /> Fire + pot
                            </button>
                            <button className="flex items-center gap-3 bg-[#020617] border border-gray-700 text-gray-400 p-5 rounded-lg hover:border-gray-500 text-lg">
                                <Pill className="w-6 h-6" /> Bleach / tablets
                            </button>
                            <button className="flex items-center gap-3 bg-[#020617] border border-gray-700 text-gray-400 p-5 rounded-lg hover:border-gray-500 text-lg">
                                <Hand className="w-6 h-6" /> Nothing
                            </button>
                        </div>
                    </div>

                    {/* Card 3: Victim status */}
                    <div className="bg-[#0f172a] border border-gray-800 rounded-xl p-8">
                        <h3 className="text-3xl font-bold mb-8">Victim status</h3>

                        <div className="space-y-6">
                            {/* Breathing Row */}
                            <div className="flex items-center gap-6">
                                <span className="w-40 text-2xl font-bold">Breathing?</span>
                                <div className="flex gap-4 flex-grow">
                                    <button className="flex-1 bg-blue-900/20 border-2 border-blue-500 text-white py-4 rounded-lg font-bold text-xl">Yes</button>
                                    <button className="flex-1 bg-[#020617] border border-gray-700 text-gray-400 py-4 rounded-lg hover:border-gray-500 text-xl">No</button>
                                    <button className="flex-1 bg-[#020617] border border-gray-700 text-gray-400 py-4 rounded-lg hover:border-gray-500 text-xl">Not sure</button>
                                </div>
                            </div>

                            {/* Bleeding Row */}
                            <div className="flex items-center gap-6">
                                <span className="w-40 text-2xl font-bold">Bleeding?</span>
                                <div className="flex gap-4 flex-grow">
                                    <button className="flex-1 bg-[#020617] border border-gray-700 text-gray-400 py-4 rounded-lg hover:border-gray-500 text-xl">None</button>
                                    <button className="flex-1 bg-[#020617] border border-gray-700 text-gray-400 py-4 rounded-lg hover:border-gray-500 text-xl">Steady</button>
                                    <button className="flex-1 bg-red-900/20 border-2 border-red-500 text-white py-4 rounded-lg font-bold flex items-center justify-center gap-3 text-xl">
                                        <Droplet className="w-5 h-5" /> Spurting
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>

                {/* RIGHT COLUMN (1/3 width) - Emergency Assessment */}
                <div className="bg-[#1a0505] border border-red-900/50 rounded-xl p-10 flex flex-col items-center text-center relative overflow-hidden">

                    {/* Big Red Circle Icon */}
                    <div className="w-40 h-40 bg-red-600 rounded-full flex items-center justify-center mb-8 shadow-[0_0_40px_rgba(220,38,38,0.6)] mt-4">
                        <Activity className="w-20 h-20 text-white" strokeWidth={3} />
                    </div>

                    <h2 className="text-4xl font-bold mb-6">Emergency<br />Assessment</h2>
                    <p className="text-gray-400 mb-10 text-lg leading-relaxed px-4">
                        Your words, your materials and the victim's status are matched against the verified first-aid pack stored on this device.
                    </p>

                    {/* Matched List */}
                    <div className="w-full text-left space-y-4 mb-10 px-4">
                        <div className="flex items-start gap-4 text-lg text-gray-300">
                            <Check className="w-6 h-6 text-green-500 flex-shrink-0 mt-1" />
                            <span>Spurting bleeding → bleeding control first</span>
                        </div>
                        <div className="flex items-start gap-4 text-lg text-gray-300">
                            <Check className="w-6 h-6 text-green-500 flex-shrink-0 mt-1" />
                            <span>Cloth + stick → improvised tourniquet unlocked</span>
                        </div>
                        <div className="flex items-start gap-4 text-lg text-gray-300">
                            <Check className="w-6 h-6 text-green-500 flex-shrink-0 mt-1" />
                            <span>Breathing → CPR not needed</span>
                        </div>
                    </div>

                    {/* Big Action Button */}
                    <button className="w-full bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-bold text-2xl py-6 rounded-xl shadow-[0_0_30px_rgba(220,38,38,0.5)] flex items-center justify-center gap-3 mt-auto">
                        <Activity className="w-6 h-6" /> Get first aid steps
                    </button>

                </div>

            </div>
        </div>
    );
}