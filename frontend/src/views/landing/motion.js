export function initializeLanding(root) {
const events = new AbortController();
const listen = (target, type, callback, options = {}) => target.addEventListener(type, callback, { ...options, signal: events.signal });
const chapters = [...root.querySelectorAll(".chapter")];
const stage = root.querySelector("#stage");
const stageCounter = root.querySelector("#stageCounter");
const stageLabel = root.querySelector("#stageLabel");
const stageProgress = root.querySelector("#stageProgress");
const pageProgress = root.querySelector("#pageProgress");
const themeToggle = root.querySelector("#themeToggle");
const themeToggleText = root.querySelector("#themeToggleText");
function applyTheme(theme, persist = false) {
  const current = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = current;
  document.documentElement.classList.toggle('dark', current === 'dark');
  document.documentElement.classList.toggle('light', current === 'light');
  root.dataset.theme = current;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", current === "light" ? "#f2f7f4" : "#081822");
  themeToggle.setAttribute("aria-label", `Switch to ${current === "dark" ? "light" : "dark"} mode`);
  themeToggleText.textContent = current === "dark" ? "Light mode" : "Dark mode";

  if (persist) {
    try { localStorage.setItem("rescue.theme", current); localStorage.setItem("theme", current); } catch { /* Storage can be unavailable in private browsing. */ }
  }
}
applyTheme(document.documentElement.dataset.theme);
listen(themeToggle, "click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true));
const labels = ["OFFLINE KNOWLEDGE", "SAFER ROUTING", "NEARBY SOS", "SOS OUTBOX"];
const descriptions = [
  "Bundled phone knowledge retrieves first-aid guidance without internet.",
  "A compass and evacuation view use SOS, food, shelter, and hazard context for safer routing.",
  "Android BLE sends a compact SOS packet to a nearby RescueMemory phone.",
  "Stored SOS reports reach volunteer and command workflows as connectivity allows."
];
let lastStep = -1;
let scheduled = false;
let storyFrame = 0;

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function updateStory() {
  scheduled = false;
  const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  pageProgress.style.width = `${(window.scrollY / scrollable) * 100}%`;

  const stageHeight = stage.getBoundingClientRect().height;
  const anchor = window.innerWidth <= 900
    ? stageHeight + (window.innerHeight - stageHeight) * .5
    : window.innerHeight * .53;
  let active = 0;
  let nearest = Infinity;
  chapters.forEach((chapter, index) => {
    const rect = chapter.getBoundingClientRect();
    const distance = Math.abs(rect.top + rect.height / 2 - anchor);
    if (distance < nearest) { nearest = distance; active = index; }
  });

  const start = chapters[0].getBoundingClientRect();
  const end = chapters[chapters.length - 1].getBoundingClientRect();
  const total = (end.top + end.height / 2) - (start.top + start.height / 2);
  const moved = anchor - (start.top + start.height / 2);
  const journey = clamp(total > 0 ? moved / total : 0, 0, 1);
  const runnerX = 6 + journey * 60;
  stage.style.setProperty("--runner-x", `${runnerX}%`);
  stage.style.setProperty("--glow-x", `${runnerX - 8}%`);
  stageProgress.style.width = `${25 + journey * 75}%`;

  if (active !== lastStep) {
    lastStep = active;
    stage.dataset.stage = String(active);
    stageCounter.textContent = `0${active + 1} / 04`;
    stageLabel.textContent = labels[active];
    stage.setAttribute("aria-label", descriptions[active]);
    chapters.forEach((chapter, index) => chapter.classList.toggle("active", index === active));
  }
  updateScrollVisuals();
}

function scheduleUpdate() {
  if (!scheduled) { scheduled = true; storyFrame = requestAnimationFrame(updateStory); }
}

const revealObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); }
  });
}, { threshold: .14 });
root.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));

const filmOriginal = root.querySelector(".film-set");
const filmRepeat = root.querySelectorAll(".film-set")[1];
if (filmOriginal && filmRepeat) filmRepeat.innerHTML = filmOriginal.innerHTML;

const motionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => entry.target.classList.toggle("in-view", entry.isIntersecting));
}, { threshold: .05 });
root.querySelectorAll(".stage, .film-shell, .architecture-diagram").forEach((element) => motionObserver.observe(element));

const menuToggle = root.querySelector("#menuToggle");
const mobileNav = root.querySelector("#mobileNav");
listen(menuToggle, "click", () => {
  const open = mobileNav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
});
mobileNav.querySelectorAll("a").forEach((link) => listen(link, "click", () => {
  mobileNav.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open menu");
}));

listen(window, "scroll", scheduleUpdate, { passive: true });
listen(window, "resize", scheduleUpdate);
listen(window, "load", scheduleUpdate);
// Every visual below is a pure function of scroll position: no timers or inertia.
const diagrams = [...root.querySelectorAll(".architecture-diagram")];
const scrollMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const architectureNodes = [...root.querySelectorAll(".architecture-diagram [data-node]")]
  .sort((a, b) => Number(a.dataset.order) - Number(b.dataset.order))
  .map((node) => ({ node, name: node.dataset.node,
    start: Number(node.dataset.order) === 0 ? -.065 : Number(node.dataset.order) / 10 * .92,
    end: Number(node.dataset.order) === 0 ? 0 : Number(node.dataset.order) / 10 * .92 + .065 }));
const architectureByName = new Map(architectureNodes.map((component) => [component.name, component]));
const architectureLinks = [...root.querySelectorAll(".architecture-diagram [data-requires]")].map((link) => ({
  link, ends: link.dataset.requires.split(" ").map((name) => architectureByName.get(name))
}));
const filmTrack = root.querySelector(".film-track");
const filmSection = root.querySelector(".technology-section");
const architectureSection = root.querySelector(".architecture-section");
const architectureNotes = architectureSection.querySelector(".implementation-notes");

function sceneProgress(section) {
  const pin = section.querySelector(".scroll-scene-pin");
  const distance = Math.max(1, section.offsetHeight - pin.offsetHeight);
  return clamp(-section.getBoundingClientRect().top / distance, 0, 1);
}

function updateScrollVisuals() {
  const reduced = scrollMotion.matches;
  architectureSection.classList.toggle("scroll-scene", !reduced && !architectureNotes.open);
  filmSection.classList.toggle("scroll-scene", !reduced);
  const progress = reduced || architectureNotes.open ? 1 : sceneProgress(architectureSection);
  let shown = 0;
  architectureNodes.forEach((component) => {
    component.opacity = clamp((progress - component.start) / (component.end - component.start), 0, 1);
    component.node.style.opacity = component.opacity;
    component.node.style.transform = `translateY(${(1 - component.opacity) * 5}px)`;
    if (component.opacity === 1) shown++;
  });
  architectureLinks.forEach(({ link, ends }) => {
    const ready = ends.every((component) => component.opacity === 1);
    const end = Math.max(...ends.map((component) => component.end));
    // On reverse scroll the connector vanishes before either endpoint starts fading.
    link.style.opacity = ready ? clamp((progress - end) / .03, 0, 1) : 0;
  });
  root.querySelectorAll(".arch-signal").forEach((signal, index) => {
    signal.style.offsetDistance = `${((progress * 2 + index * .35) % 1) * 100}%`;
  });
  diagrams.forEach((diagram) => {
    diagram.dataset.revealed = String(shown / diagrams.length);
    diagram.dataset.progress = progress.toFixed(4);
  });

  const period = filmOriginal.offsetWidth;
  // Add enough copies to keep the rotating strip filled at wide breakpoints.
  const copies = Math.max(2, Math.ceil(window.innerWidth / Math.max(1, period)) + 2);
  while (filmTrack.children.length < copies) {
    const repeat = filmOriginal.cloneNode(true);
    repeat.setAttribute("aria-hidden", "true");
    filmTrack.append(repeat);
  }
  const filmProgress = reduced ? 0 : sceneProgress(filmSection);
  const offset = reduced ? 0 : -period + filmProgress * period * .92;
  filmSection.dataset.progress = filmProgress.toFixed(4);
  filmTrack.style.transform = `translate3d(${offset}px,0,0)`;
}
listen(architectureNotes, "toggle", scheduleUpdate);
listen(scrollMotion, "change", scheduleUpdate);
listen(root, 'click', (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || link.getAttribute('href').startsWith('#/')) return;
  const target = root.querySelector(link.getAttribute('href'));
  if (target) { event.preventDefault(); target.scrollIntoView({ behavior: scrollMotion.matches ? 'instant' : 'smooth', block: 'start' }); }
});
listen(window, 'storage', (event) => { if (event.key === 'rescue.theme') applyTheme(event.newValue); });
updateStory();
return () => { events.abort(); cancelAnimationFrame(storyFrame); revealObserver.disconnect(); motionObserver.disconnect(); };

}
