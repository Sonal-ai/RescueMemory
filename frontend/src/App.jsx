import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import SurvivorHUD from './views/SurvivorHUD';
import VolunteerBoard from './views/VolunteerBoard';
import CommandInspector from './views/CommandInspector';
import ActivationScreen from './views/ActivationScreen';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Main Home Page: Emergency Chatbot & Triage */}
        <Route path="/" element={<SurvivorHUD initialTab="ask" />} />
        <Route path="/chat" element={<SurvivorHUD initialTab="ask" />} />
        <Route path="/compass" element={<SurvivorHUD initialTab="compass" />} />
        <Route path="/find" element={<SurvivorHUD initialTab="compass" />} />
        <Route path="/map" element={<SurvivorHUD initialTab="map" />} />
        <Route path="/radar" element={<SurvivorHUD initialTab="radar" />} />
        <Route path="/report" element={<SurvivorHUD initialTab="report" />} />
        <Route path="/beacon" element={<SurvivorHUD initialTab="beacon" />} />
        <Route path="/group" element={<Navigate to="/beacon" replace />} />
        <Route path="/crisis" element={<Navigate to="/" replace />} />
        
        {/* Responder & Command HQ */}
        <Route path="/volunteer" element={<VolunteerBoard />} />
        <Route path="/command" element={<CommandInspector />} />
        
        {/* Project Architecture & Mesh Info */}
        <Route path="/about" element={<ActivationScreen />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

