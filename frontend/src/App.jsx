import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ActivationScreen from './views/ActivationScreen';
import SurvivorHUD from './views/SurvivorHUD';
import VolunteerBoard from './views/VolunteerBoard';
import CommandInspector from './views/CommandInspector';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ActivationScreen />} />
        <Route path="/crisis" element={<SurvivorHUD />} />
        <Route path="/volunteer" element={<VolunteerBoard />} />
        <Route path="/command" element={<CommandInspector />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
