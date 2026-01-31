import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createNoise2D, createNoise3D } from 'simplex-noise';
import SunCalc from 'suncalc';

// --- Config ---
const isMobile = window.innerWidth < 768;
const TERRAIN_SIZE = 200;
const TERRAIN_SEGMENTS = isMobile ? 128 : 256;
const STAR_COUNT = isMobile ? 500 : 1500;
const LAT = 25.6866, LNG = -100.3161; // Monterrey fallback
let lat = LAT, lng = LNG;

// Try geolocation
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => { lat = pos.coords.latitude; lng = pos.coords.longitude; },
    () => {},
    { timeout: 3000 }
  );
}

// --- Setup ---
const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(30, 25, 50);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2.1;
controls.minDistance = 15;
controls.maxDistance = 120;
controls.target.set(0, 5, 0);
controls.autoRotate = true;
controls.autoRotateSpeed = 0.12; // ~5 min per rotation

// --- Noise ---
const noise2D = createNoise2D();
const noise3D = createNoise3D();

function fbm(x, z, octaves = 5) {
  let val = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    val += noise2D(x * freq, z * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return val / max;
}

// --- Time helpers ---
function getTimeInfo() {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const sunTimes = SunCalc.getTimes(now, lat, lng);
  const sunPos = SunCalc.getPosition(now, lat, lng);
  const moonPos = SunCalc.getMoonPosition(now, lat, lng);
  return { now, h, sunTimes, sunPos, moonPos };
}

// --- Color interpolation ---
function lerpColor(a, b, t) {
  return new THREE.Color().copy(a).lerp(b, Math.max(0, Math.min(1, t)));
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Sky color zones
const SKY_COLORS = [
  { h: 0, top: new THREE.Color('#0a0a2e'), bot: new THREE.Color('#0d1b2a') },
  { h: 4, top: new THREE.Color('#0a0a2e'), bot: new THREE.Color('#0d1b2a') },
  { h: 5, top: new THREE.Color('#1a1040'), bot: new THREE.Color('#ff6b35') },
  { h: 6, top: new THREE.Color('#2a1a5e'), bot: new THREE.Color('#ffd700') },
  { h: 7, top: new THREE.Color('#5a8fce'), bot: new THREE.Color('#ffd700') },
  { h: 8, top: new THREE.Color('#87ceeb'), bot: new THREE.Color('#b0d4e8') },
  { h: 12, top: new THREE.Color('#4a90d9'), bot: new THREE.Color('#87ceeb') },
  { h: 17, top: new THREE.Color('#4a90d9'), bot: new THREE.Color('#87ceeb') },
  { h: 18, top: new THREE.Color('#8b3a62'), bot: new THREE.Color('#ff4500') },
  { h: 19, top: new THREE.Color('#4a1a3e'), bot: new THREE.Color('#ff6b35') },
  { h: 20, top: new THREE.Color('#1a1a4e'), bot: new THREE.Color('#2a1a3e') },
  { h: 21, top: new THREE.Color('#0d1030'), bot: new THREE.Color('#1a1a4e') },
  { h: 24, top: new THREE.Color('#0a0a2e'), bot: new THREE.Color('#0d1b2a') },
];

function getSkyColors(h) {
  let i = 0;
  for (; i < SKY_COLORS.length - 1; i++) {
    if (h < SKY_COLORS[i + 1].h) break;
  }
  const a = SKY_COLORS[i], b = SKY_COLORS[Math.min(i + 1, SKY_COLORS.length - 1)];
  const t = (b.h === a.h) ? 0 : (h - a.h) / (b.h - a.h);
  return {
    top: lerpColor(a.top, b.top, t),
    bot: lerpColor(a.bot, b.bot, t),
  };
}

// --- Sky dome (canvas texture) ---
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 2;
skyCanvas.height = 256;
const skyCtx = skyCanvas.getContext('2d');
const skyTexture = new THREE.CanvasTexture(skyCanvas);

function updateSkyTexture(topColor, botColor) {
  const grad = skyCtx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#' + topColor.getHexString());
  grad.addColorStop(1, '#' + botColor.getHexString());
  skyCtx.fillStyle = grad;
  skyCtx.fillRect(0, 0, 2, 256);
  skyTexture.needsUpdate = true;
  scene.background = skyTexture;
}

// --- Terrain ---
const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
terrainGeo.rotateX(-Math.PI / 2);
const terrainMat = new THREE.MeshStandardMaterial({
  color: '#3d5c2e',
  roughness: 0.9,
  metalness: 0.0,
  flatShading: false,
});
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
scene.add(terrain);

const terrainPositions = terrainGeo.attributes.position;
const baseHeights = new Float32Array(terrainPositions.count);

for (let i = 0; i < terrainPositions.count; i++) {
  const x = terrainPositions.getX(i);
  const z = terrainPositions.getZ(i);
  const h = fbm(x * 0.008, z * 0.008) * 18 + fbm(x * 0.02, z * 0.02) * 5;
  baseHeights[i] = h;
  terrainPositions.setY(i, h);
}
terrainGeo.computeVertexNormals();

// Terrain colors
const TERRAIN_NIGHT = new THREE.Color('#1a2a1a');
const TERRAIN_DAWN = new THREE.Color('#8b7355');
const TERRAIN_DAY = new THREE.Color('#3d5c2e');

function getTerrainColor(h) {
  if (h < 5) return lerpColor(TERRAIN_NIGHT, TERRAIN_DAWN, smoothstep(4, 6, h));
  if (h < 7) return lerpColor(TERRAIN_DAWN, TERRAIN_DAY, smoothstep(5, 8, h));
  if (h < 17) return TERRAIN_DAY.clone();
  if (h < 20) return lerpColor(TERRAIN_DAY, TERRAIN_DAWN, smoothstep(17, 19, h));
  return lerpColor(TERRAIN_DAWN, TERRAIN_NIGHT, smoothstep(19, 21, h));
}

// --- Water ---
const waterGeo = new THREE.PlaneGeometry(TERRAIN_SIZE * 1.5, TERRAIN_SIZE * 1.5, 64, 64);
waterGeo.rotateX(-Math.PI / 2);
const waterMat = new THREE.MeshStandardMaterial({
  color: '#1a4a6e',
  metalness: 0.8,
  roughness: 0.15,
  transparent: true,
  opacity: 0.85,
});
const water = new THREE.Mesh(waterGeo, waterMat);
water.position.y = -2;
scene.add(water);

// --- Sun ---
const sunGeo = new THREE.SphereGeometry(3, 32, 32);
const sunMat = new THREE.MeshBasicMaterial({ color: '#fff5e0' });
const sun = new THREE.Mesh(sunGeo, sunMat);
scene.add(sun);

// --- Moon ---
const moonGeo = new THREE.SphereGeometry(1.8, 32, 32);
const moonMat = new THREE.MeshBasicMaterial({ color: '#e8e8f0' });
const moon = new THREE.Mesh(moonGeo, moonMat);
scene.add(moon);

// --- Stars ---
const starsGeo = new THREE.BufferGeometry();
const starPositions = new Float32Array(STAR_COUNT * 3);
const starPhases = new Float32Array(STAR_COUNT);
for (let i = 0; i < STAR_COUNT; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(Math.random() * 0.8 + 0.2); // upper hemisphere
  const r = 300;
  starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPositions[i * 3 + 1] = r * Math.cos(phi);
  starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  starPhases[i] = Math.random() * Math.PI * 2;
}
starsGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starsMat = new THREE.PointsMaterial({
  color: '#ffffff',
  size: isMobile ? 1.5 : 1.2,
  transparent: true,
  opacity: 0,
  sizeAttenuation: true,
});
const stars = new THREE.Points(starsGeo, starsMat);
scene.add(stars);

// --- Lights ---
const dirLight = new THREE.DirectionalLight('#ffffff', 1.0);
scene.add(dirLight);

const ambientLight = new THREE.AmbientLight('#404060', 0.1);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight('#87ceeb', '#3d5c2e', 0.3);
scene.add(hemiLight);

// --- Fog ---
scene.fog = new THREE.FogExp2('#87ceeb', 0.004);

// --- Clock UI ---
const clockTime = document.getElementById('clock-time');
const clockSeconds = document.getElementById('clock-seconds');
const clockLabel = document.getElementById('clock-label');

function updateClock(timeInfo) {
  const { now, sunTimes } = timeInfo;
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  clockSeconds.textContent = ss;
  clockTime.innerHTML = `${hh}:${mm}<span id="clock-seconds">${ss}</span>`;

  // Next event label
  const nextSunrise = sunTimes.sunrise;
  const nextSunset = sunTimes.sunset;
  let label = '';
  if (now < nextSunrise) {
    const diff = nextSunrise - now;
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    label = `sunrise in ${hrs}h ${mins}m`;
  } else if (now < nextSunset) {
    const diff = nextSunset - now;
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    label = `sunset in ${hrs}h ${mins}m`;
  } else {
    // After sunset, compute tomorrow's sunrise
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowTimes = SunCalc.getTimes(tomorrow, lat, lng);
    const diff = tomorrowTimes.sunrise - now;
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    label = `sunrise in ${hrs}h ${mins}m`;
  }
  clockLabel.textContent = label;
}

// --- Celestial body positioning ---
function celestialToWorld(altitude, azimuth, radius) {
  const x = -radius * Math.cos(altitude) * Math.sin(azimuth);
  const y = radius * Math.sin(altitude);
  const z = -radius * Math.cos(altitude) * Math.cos(azimuth);
  return new THREE.Vector3(x, y, z);
}

// --- Animation ---
const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  elapsed += dt;

  const timeInfo = getTimeInfo();
  const { h, sunPos, moonPos } = timeInfo;

  // --- Sky ---
  const sky = getSkyColors(h);
  updateSkyTexture(sky.top, sky.bot);

  // --- Fog ---
  scene.fog.color.copy(sky.bot);
  const nightness = smoothstep(19, 22, h) - smoothstep(4, 7, h);
  scene.fog.density = THREE.MathUtils.lerp(0.003, 0.008, Math.max(0, nightness));

  // --- Terrain color ---
  terrainMat.color.copy(getTerrainColor(h));

  // --- Terrain animation (slow drift) ---
  if (Math.floor(elapsed * 10) % 3 === 0) { // throttle
    for (let i = 0; i < terrainPositions.count; i++) {
      const x = terrainPositions.getX(i);
      const z = terrainPositions.getZ(i);
      const drift = noise3D(x * 0.01, z * 0.01, elapsed * 0.02) * 0.3;
      terrainPositions.setY(i, baseHeights[i] + drift);
    }
    terrainGeo.attributes.position.needsUpdate = true;
    terrainGeo.computeVertexNormals();
  }

  // --- Water animation ---
  const waterPos = waterGeo.attributes.position;
  for (let i = 0; i < waterPos.count; i++) {
    const x = waterPos.getX(i);
    const z = waterPos.getZ(i);
    const ripple = noise3D(x * 0.03, z * 0.03, elapsed * 0.5) * 0.4;
    waterPos.setY(i, ripple);
  }
  waterPos.needsUpdate = true;
  waterMat.color.copy(sky.bot).lerp(new THREE.Color('#1a4a6e'), 0.5);

  // --- Sun ---
  const sunWorld = celestialToWorld(sunPos.altitude, sunPos.azimuth, 150);
  sun.position.copy(sunWorld);
  sun.visible = sunPos.altitude > -0.05;
  const sunIntensity = Math.max(0, Math.sin(sunPos.altitude));
  
  // Sun glow color based on altitude
  if (sunPos.altitude < 0.15 && sunPos.altitude > -0.05) {
    sunMat.color.set('#ff8c42');
    sun.scale.setScalar(1.5); // bigger at horizon
  } else {
    sunMat.color.set('#fff5e0');
    sun.scale.setScalar(1);
  }

  // --- Moon ---
  const moonWorld = celestialToWorld(moonPos.altitude, moonPos.azimuth, 160);
  moon.position.copy(moonWorld);
  moon.visible = moonPos.altitude > 0;

  // --- Directional light (sun) ---
  dirLight.position.copy(sunWorld).normalize();
  dirLight.intensity = Math.max(0, sunIntensity * 2.0);
  if (sunPos.altitude < 0.2) {
    dirLight.color.set('#ffaa55');
  } else {
    dirLight.color.set('#ffffff');
  }

  // --- Ambient light ---
  const dayAmount = smoothstep(6, 8, h) - smoothstep(18, 20, h);
  ambientLight.intensity = THREE.MathUtils.lerp(0.05, 0.3, Math.max(0, dayAmount));
  if (dayAmount < 0.3) {
    ambientLight.color.set('#2a2a5a');
  } else {
    ambientLight.color.set('#404050');
  }

  // --- Hemisphere light ---
  hemiLight.color.copy(sky.top);
  hemiLight.groundColor.copy(getTerrainColor(h));
  hemiLight.intensity = THREE.MathUtils.lerp(0.1, 0.4, Math.max(0, dayAmount));

  // --- Stars ---
  const starOpacity = Math.max(0, 1 - dayAmount * 2);
  starsMat.opacity = starOpacity * (0.7 + 0.3 * Math.sin(elapsed * 0.5));

  // --- Tone mapping exposure ---
  renderer.toneMappingExposure = THREE.MathUtils.lerp(0.5, 1.2, Math.max(0, dayAmount));

  // --- Clock ---
  updateClock(timeInfo);

  // --- Controls ---
  controls.update();

  renderer.render(scene, camera);
}

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Log initial state
const init = getTimeInfo();
console.log(`Atmospheric Clock — Hour: ${init.h.toFixed(2)}, Sun alt: ${(init.sunPos.altitude * 180 / Math.PI).toFixed(1)}°`);
console.log('Sky colors:', getSkyColors(init.h));

animate();
