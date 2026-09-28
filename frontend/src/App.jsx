import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ActivationScreen from './views/ActivationScreen';
import SurvivorHUD from './views/SurvivorHUD';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ActivationScreen />} />
        <Route path="/crisis" element={<SurvivorHUD />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;