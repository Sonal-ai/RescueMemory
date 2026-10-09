export function initializeGlobe(root) {
const events = new AbortController();
const listen = (target, type, callback, options = {}) => target.addEventListener(type, callback, { ...options, signal: events.signal });
const dock = root.querySelector('#networkDock');
const canvas = root.querySelector('#networkCanvas');
const figure = root.querySelector('.hero-art');
const hero = root.querySelector('.hero');
const smallScreen = window.matchMedia('(max-width: 600px)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let renderer, scene, camera, earth, atmosphere, globe;
let disposed = false, resizeObserver;
let visible = false, frame = 0, previousTime = 0, loading = false, unavailable = false;
let dragging = false, lastPointer = { x: 0, y: 0 }, userTilt = 0, userRotation = 0, rotation = 0;
let spinVelocity = 0, hoverX = 0, hoverY = 0, elapsed = 0;
let lastStatusTime = 0;
const deflection = { x: 0, y: 0, rx: 0, ry: 0, rz: 0 };
const deflectionVelocity = { x: 0, y: 0, rx: 0, ry: 0, rz: 0 };
function spring(key, target, delta) {
  deflectionVelocity[key] += ((target - deflection[key]) * 48 - deflectionVelocity[key] * 11) * delta;
  deflection[key] += deflectionVelocity[key] * delta;
  return deflection[key];
}
const pulses = [];
const orbiters = [];
function enabled() { return !disposed && !smallScreen.matches && !reducedMotion.matches && !unavailable; }
function stop() { cancelAnimationFrame(frame); frame = 0; previousTime = 0; }
function render(time = 0) {
  frame = 0;
  if (!renderer || !enabled() || !visible || document.hidden) return;
  const delta = previousTime ? Math.min((time - previousTime) / 1000, .05) : 0;
  previousTime = time;
  elapsed += delta;
  if (!dragging) {
    rotation += delta * Math.PI * 2 / 36;
    userRotation += spinVelocity * delta;
    spinVelocity *= Math.exp(-delta * 4);
  }
  earth.rotation.set(.18 + userTilt, Math.PI * 187 / 180 + userRotation + rotation, 0);
  atmosphere.rotation.copy(earth.rotation);
  globe.position.x = spring('x', hoverX * .12, delta);
  globe.position.y = spring('y', -hoverY * .08, delta) + Math.sin(elapsed * 1.1) * .025;
  globe.rotation.x = spring('rx', hoverY * .32, delta);
  globe.rotation.y = spring('ry', hoverX * .5, delta);
  globe.rotation.z = spring('rz', -hoverX * .1, delta);
  pulses.forEach(({ mesh, path, offset }) => mesh.position.copy(path.getPoint((elapsed / 2.8 + offset) % 1)));
  orbiters.forEach(({ mesh, halo, radius, speed, phase }) => {
    const angle = elapsed * speed + phase;
    mesh.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    halo.position.copy(mesh.position);
    halo.scale.setScalar(1 + Math.sin(elapsed * 3 + phase) * .15);
  });
  renderer.render(scene, camera);
  if (time - lastStatusTime > 250) {
    dock.dataset.rotation = earth.rotation.y.toFixed(3);
    dock.dataset.userRotation = userRotation.toFixed(3);
    dock.dataset.deflection = [deflection.x, deflection.y, deflection.rx, deflection.ry].map(value => value.toFixed(3)).join(',');
    lastStatusTime = time;
  }
  frame = requestAnimationFrame(render);
}
function sync() {
  const live = !!renderer && enabled();
  dock.classList.toggle('is-live', live);
  figure.classList.toggle('is-interactive', live);
  canvas.tabIndex = live ? 0 : -1;
  canvas.setAttribute('aria-hidden', String(!live));
  dock.querySelector('.globe-fallback').setAttribute('aria-hidden', String(live));
  dock.dataset.renderer = live ? 'webgl' : 'static';
  dock.dataset.motion = live && visible && !document.hidden ? 'running' : 'paused';
  if (live && visible && !document.hidden) { if (!frame) frame = requestAnimationFrame(render); }
  else stop();
  if (enabled() && !renderer && !loading) initialize();
}
async function initialize() {
  loading = true;
  try {
    const THREE = await import('./vendor/three.module.min.js');
    if (disposed) return;
    const texture = await new THREE.TextureLoader().loadAsync('/landing/assets/earth-september.jpg');
    if (disposed) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    scene = new THREE.Scene();
    globe = new THREE.Group(); scene.add(globe);
    camera = new THREE.PerspectiveCamera(36, 1, .1, 20);
    camera.position.z = 4;
    scene.add(new THREE.HemisphereLight(0xc7f5ff, 0x082c41, 2));
    const sun = new THREE.DirectionalLight(0xfff2db, 3);
    sun.position.set(-3, 3, 4); scene.add(sun);
    const rim = new THREE.DirectionalLight(0x68cfc1, 1.4);
    rim.position.set(3, -1, -2); scene.add(rim);
    earth = new THREE.Group();
    earth.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshStandardMaterial({ map: texture, color: 0xa0c7ca, roughness: .92, metalness: 0 })));
    globe.add(earth);
    atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.035, 48, 32), new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vNormal; varying vec3 vView; void main(){vec4 p=modelViewMatrix*vec4(position,1.0); vNormal=normalize(normalMatrix*normal); vView=normalize(-p.xyz); gl_Position=projectionMatrix*p;}',
      fragmentShader: 'varying vec3 vNormal; varying vec3 vView; void main(){float rim=pow(1.0-max(dot(normalize(vNormal),normalize(vView)),0.0),3.2); gl_FragColor=vec4(0.29,0.85,0.77,rim*0.38);}',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    globe.add(atmosphere);
    // Two quiet orbital signals keep motion legible even when the ocean faces forward.
    [0, 1].forEach((index) => {
      const orbit = new THREE.Group();
      orbit.rotation.set(.48 + index * .9, index * .7, -.28 + index * .7);
      const radius = 1.13 + index * .08;
      const points = Array.from({ length: 97 }, (_, i) => {
        const angle = i / 96 * Math.PI * 2;
        return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      });
      orbit.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x88dccc, transparent: true, opacity: .19 })));
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(.02, 12, 8), new THREE.MeshBasicMaterial({ color: index ? 0xffc18f : 0xc3ffec }));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(.042, 12, 8), new THREE.MeshBasicMaterial({ color: index ? 0xffc18f : 0x84ffe1, transparent: true, opacity: .15, depthWrite: false }));
      orbit.add(mesh, halo); globe.add(orbit);
      orbiters.push({ mesh, halo, radius, speed: index ? -.8 : 1.05, phase: index * Math.PI });
    });
    const point = (lat, lon, radius = 1.014) => {
      const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
      return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)).multiplyScalar(radius);
    };
    // Decorative connections, not a claim of continent-wide Bluetooth range.
    const connections = [[[28.6, 77.2], [27.7, 85.3]], [[27.7, 85.3], [23.8, 90.4]], [[23.8, 90.4], [6.9, 79.9]]];
    const endpoints = new Set();
    connections.forEach(([from, to], index) => {
      const a = point(...from), b = point(...to), middle = a.clone().add(b).normalize().multiplyScalar(1.11);
      const path = new THREE.QuadraticBezierCurve3(a, middle, b);
      earth.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.getPoints(48)), new THREE.LineBasicMaterial({ color: 0x9ce9d7, transparent: true, opacity: .56 })));
      const pulse = new THREE.Mesh(new THREE.SphereGeometry(.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xd4fff0 }));
      earth.add(pulse); pulses.push({ mesh: pulse, path, offset: index / 3 });
      [from, to].forEach((location) => {
        const key = location.join(','); if (endpoints.has(key)) return; endpoints.add(key);
        const node = new THREE.Mesh(new THREE.SphereGeometry(.014, 12, 8), new THREE.MeshBasicMaterial({ color: 0xadf4df }));
        node.position.copy(point(...location, 1.02)); earth.add(node);
      });
    });
    const resize = () => {
      const { width, height } = dock.getBoundingClientRect(); if (!width || !height) return;
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); sync();
    };
    resizeObserver = new ResizeObserver(resize); resizeObserver.observe(dock); resize();
  } catch (error) {
    unavailable = true; renderer?.dispose(); renderer = null;
    console.warn('Earth illustration uses its static fallback.', error);
  } finally { loading = false; sync(); }
}
listen(canvas, 'pointerdown', (event) => {
  if (!enabled() || !renderer) return;
  dragging = true; spinVelocity = 0; lastPointer = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId);
});
listen(canvas, 'pointermove', (event) => {
  if (!dragging) return;
  const movement = (event.clientX - lastPointer.x) * .009;
  userRotation += movement;
  spinVelocity = Math.max(-2.5, Math.min(2.5, movement * 35));
  userTilt = Math.max(-.6, Math.min(.6, userTilt + (event.clientY - lastPointer.y) * .003));
  lastPointer = { x: event.clientX, y: event.clientY };
});
const release = () => { dragging = false; };
listen(hero, 'pointermove', (event) => {
  if (!enabled() || event.pointerType === 'touch') return;
  const bounds = canvas.getBoundingClientRect();
  hoverX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
  hoverY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
});
listen(hero, 'pointerleave', () => { hoverX = 0; hoverY = 0; });
listen(canvas, 'pointerup', release);
listen(canvas, 'pointercancel', release);
listen(canvas, 'lostpointercapture', release);
listen(canvas, 'keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  userRotation += event.key === 'ArrowLeft' ? -.28 : event.key === 'ArrowRight' ? .28 : 0;
  userTilt = Math.max(-.6, Math.min(.6, userTilt + (event.key === 'ArrowUp' ? -.16 : event.key === 'ArrowDown' ? .16 : 0)));
});
const visibilityObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: .05 }); visibilityObserver.observe(dock);
listen(smallScreen, 'change', sync);
listen(reducedMotion, 'change', sync);
listen(document, 'visibilitychange', sync);
listen(canvas, 'webglcontextlost', (event) => { event.preventDefault(); unavailable = true; sync(); });
sync();

return () => {
  disposed = true; stop(); events.abort(); visibilityObserver.disconnect(); resizeObserver?.disconnect();
  scene?.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => { material.map?.dispose(); material.dispose(); });
  });
  renderer?.dispose();
};
}
