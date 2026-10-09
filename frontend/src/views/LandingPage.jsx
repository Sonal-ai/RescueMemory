import { useEffect, useRef } from 'react';
import template from './landing/template.html?raw';
import { initializeLanding } from './landing/motion.js';
import { initializeGlobe } from './landing/network.js';
import './landing/landing.css';
import './landing/responsive.css';

export default function LandingPage() {
  const root = useRef(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    const stopMotion = initializeLanding(root.current);
    const stopGlobe = initializeGlobe(root.current);
    return () => { stopMotion(); stopGlobe(); };
  }, []);

  // This template is bundled, authored markup; no remote or user HTML is inserted.
  return <div className="landing-page" ref={root} dangerouslySetInnerHTML={{ __html: template }} />;
}
