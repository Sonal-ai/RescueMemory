import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ActivationScreen from './views/ActivationScreen';
import SurvivorHUD from './views/SurvivorHUD';
import SafePlace from './views/SafePlace';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ActivationScreen />} />
        <Route path="/crisis" element={<SurvivorHUD />} />
        <Route path="/safe-place" element={<SafePlace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;