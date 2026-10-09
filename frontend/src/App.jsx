import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { homeRoute } from './homeRoute.js';
import { isAndroidEdge, initializeQdrantEdge, syncEdgeGuides } from './brain/qdrantEdge.js';
import { getAllLocalGuides } from './brain/offlineStorage.js';
const SurvivorHUD = lazy(() => import('./views/SurvivorHUD'));
const VolunteerBoard = lazy(() => import('./views/VolunteerBoard'));
const CommandInspector = lazy(() => import('./views/CommandInspector'));
const CentralHQ = lazy(() => import('./views/CentralHQ'));
const SafePlace = lazy(() => import('./views/SafePlace'));
const AdminPortal = lazy(() => import('./views/AdminPortal'));

const LandingPage = lazy(() => import('./views/LandingPage'));

function AppRoutes() {
  useEffect(() => {
    if (!isAndroidEdge()) return;
    const reconcile = () => getAllLocalGuides().then(syncEdgeGuides)
      .catch(error => console.error('[QdrantEdge] Guide indexing will retry:', error));
    initializeQdrantEdge().then(reconcile)
      .catch(error => console.error('[QdrantEdge] Native initialization failed:', error));
    window.addEventListener('rescue:guides-changed', reconcile);
    return () => window.removeEventListener('rescue:guides-changed', reconcile);
  }, []);
  const location = useLocation();
  const native = Capacitor.isNativePlatform();
  const home = homeRoute(native);
  const onLanding = !native && (location.pathname === '/' || location.pathname === '/landing');
  useEffect(() => {
    if (onLanding) return;
    let disposed = false;
    let detach;
    import('./brain/meshRuntime.js').then((runtime) => {
      if (disposed) return;
      runtime.startAppMesh();
      detach = runtime.detachAppMesh;
    });
    return () => { disposed = true; detach?.(); };
  }, [onLanding]);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-600 dark:text-slate-300" role="status">Opening RescueMemory…</div>}>
      <Routes>
        {/* Main Home Page: Emergency Chatbot & Triage */}
        <Route path="/" element={native ? <Navigate to="/chat" replace /> : <LandingPage />} />
        <Route path="/index.html" element={<Navigate to={home} replace />} />
        <Route path="/chat" element={<SurvivorHUD initialTab="ask" />} />
        <Route path="/compass" element={<SurvivorHUD initialTab="compass" />} />
        <Route path="/find" element={<SurvivorHUD initialTab="compass" />} />
        <Route path="/map" element={<SurvivorHUD initialTab="map" />} />
        <Route path="/radar" element={<SurvivorHUD initialTab="radar" />} />
        <Route path="/report" element={<SurvivorHUD initialTab="report" />} />
        <Route path="/beacon" element={<SurvivorHUD initialTab="beacon" />} />
        <Route path="/group" element={<Navigate to="/beacon" replace />} />
        <Route path="/crisis" element={<Navigate to="/chat" replace />} />
        
        {/* Responder & Command HQ */}
        <Route path="/admin" element={<AdminPortal initialTab="hq" />} />
        <Route path="/volunteer" element={<VolunteerBoard />} />
        <Route path="/command" element={<CommandInspector />} />
        <Route path="/hq" element={<CentralHQ />} />
        <Route path="/safeplace" element={<SafePlace />} />
        
        {/* One web landing; native launches and legacy overview links resolve safely. */}
        <Route path="/about" element={<Navigate to={home} replace />} />
        <Route path="/overview" element={<Navigate to={home} replace />} />
        <Route path="/landing" element={native ? <Navigate to="/chat" replace /> : <LandingPage />} />

        {/* Universal Fallback: Unmatched paths always resolve to Home */}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </Suspense>
  );
}

function App() {
  return <HashRouter><AppRoutes /></HashRouter>;
}

export default App;

