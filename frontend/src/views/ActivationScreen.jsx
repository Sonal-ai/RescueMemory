import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ActivationScreen() {
    // This hook lets us navigate to other pages
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-[#0b1120] text-white flex flex-col relative overflow-hidden font-sans">

            {/* Background Image */}
            <div
                className="absolute inset-0 z-0 bg-cover bg-center"
                style={{ backgroundImage: "url('/background.jpg')" }}
            ></div>

            {/* Dark Overlay */}
            <div className="absolute inset-0 bg-[#0b1120]/70 z-0"></div>

            {/* Top Header */}
            <header className="relative z-10 flex justify-between items-center p-8 w-full">
                <div className="flex items-center gap-3">
                    <div className="w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-rescue-red"></div>
                    <span className="text-2xl font-bold tracking-wide">RescueMemory</span>
                </div>

                <div className="flex items-center gap-2 text-gray-400">
                    <div className="w-3 h-3 rounded-full bg-gray-500"></div>
                    <span>Offline Mode</span>
                </div>
            </header>

            {/* Main Content - Centered and Spread Out */}
            <main className="relative z-10 flex flex-col items-center justify-center flex-grow w-full max-w-7xl mx-auto px-8">

                {/* HUGE Title */}
                <h1 className="text-[120px] font-bold mb-6 tracking-tight text-center drop-shadow-2xl leading-none">
                    Rescue<span className="text-[#ef4444]">Memory</span>
                </h1>

                {/* Bigger Subtitle */}
                <p className="text-3xl text-gray-300 mb-12 text-center drop-shadow-md">
                    When the network disappears, <br /> memory becomes the network.
                </p>

                {/* Status Badge - Bigger */}
                <div className="flex items-center bg-[#0f172a]/90 border border-gray-700 rounded-full px-4 py-3 mb-12 shadow-lg backdrop-blur-sm">
                    <div className="flex items-center gap-3 px-6 py-2">
                        <div className="w-4 h-4 rounded-full bg-[#10b981] shadow-[0_0_15px_#10b981] animate-pulse"></div>
                        <span className="text-[#10b981] font-bold text-xl tracking-wider">EDGE NODE ACTIVE</span>
                    </div>
                    <div className="h-8 w-px bg-gray-600 mx-4"></div>
                    <div className="px-6 py-2">
                        <span className="text-gray-200 font-medium text-xl">Node A</span>
                    </div>
                </div>

                {/* Stats Container - Much Bigger */}
                <div className="w-full bg-[#0f172a]/90 backdrop-blur-md border border-gray-700 rounded-2xl p-10 flex justify-between items-center mb-16 shadow-2xl">
                    <div className="flex-1 border-r border-gray-700 px-8">
                        <div className="text-gray-400 text-lg mb-3">Local Knowledge</div>
                        <div className="text-5xl font-bold">22 <span className="text-3xl font-normal text-gray-400">records</span></div>
                    </div>
                    <div className="flex-1 border-r border-gray-700 px-8 text-center">
                        <div className="text-gray-400 text-lg mb-3">Last Updated</div>
                        <div className="text-5xl font-bold">09:00</div>
                    </div>
                    <div className="flex-1 px-8 text-right">
                        <div className="text-gray-400 text-lg mb-3">Storage</div>
                        <div className="text-5xl font-bold">1.9 MB</div>
                    </div>
                </div>

                {/* Massive Red Button - Now clickable! */}
                <button
                    onClick={() => navigate('/crisis')}
                    className="w-full max-w-5xl bg-gradient-to-r from-[#f43f5e] to-[#ef4444] hover:from-red-500 hover:to-red-600 text-white font-bold text-3xl py-8 rounded-2xl flex items-center justify-center gap-4 transition-all shadow-[0_0_50px_rgba(239,68,68,0.6)] group cursor-pointer"
                >
                    Enter Crisis Mode
                    <ArrowRight className="w-10 h-10 group-hover:translate-x-2 transition-transform" />
                </button>

            </main>
        </div>
    );
}