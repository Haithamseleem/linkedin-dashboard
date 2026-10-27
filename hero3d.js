import * as THREE from './vendor/three.module.js';

const PAPER = ['#fbf6ec', '#f5ecdc', '#efe3cf', '#f8f0e2', '#f2e7d4', '#faf4e8'];
const CARD_W = 1.6, CARD_D = 2.0, CARD_T = 0.026, GAP = 0.034;

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function inkTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 640;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(139, 90, 51, 0.95)';
  g.fillRect(56, 70, 210, 20);
  g.fillStyle = 'rgba(122, 101, 83, 0.55)';
  [400, 400, 330, 400, 380, 260, 400, 300].forEach((w, i) => g.fillRect(56, 140 + i * 46, w, 12));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createHero(canvas) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(2.35, 2.25, 3.05);
  camera.lookAt(0, 0.12, 0);

  scene.add(new THREE.HemisphereLight('#fff7ea', '#c8ad88', 1.15));
  const key = new THREE.DirectionalLight('#ffe8c8', 2.4);
  key.position.set(-3.5, 6, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 5;
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.01;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#f3d2a8', 0.7);
  rim.position.set(4, 2.5, -3);
  scene.add(rim);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ color: '#5a3b22', opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const cardGeo = new THREE.ExtrudeGeometry(roundedRect(CARD_W, CARD_D, 0.09), { depth: CARD_T, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 8 });
  cardGeo.rotateX(-Math.PI / 2);
  const inkMat = new THREE.MeshStandardMaterial({ map: inkTexture(), transparent: true, roughness: 0.9, depthWrite: false });
  const inkGeo = new THREE.PlaneGeometry(CARD_W - 0.12, CARD_D - 0.12);
  inkGeo.rotateX(-Math.PI / 2);

  const leather = new THREE.MeshStandardMaterial({ color: '#7a4b2a', roughness: 0.55, metalness: 0.05 });
  const embossed = new THREE.MeshStandardMaterial({ color: '#e7cfac', roughness: 0.45, metalness: 0.15 });
  function makeSeal() {
    const g = new THREE.Group();
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.28, 0.035, 48), leather);
    disk.castShadow = true;
    g.add(disk);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 10, 64), embossed);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.019;
    g.add(ring);
    const tick = (len, x, z, rot) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, 0.035), embossed);
      m.position.set(x, 0.022, z);
      m.rotation.y = rot;
      g.add(m);
    };
    tick(0.11, -0.045, 0.02, -Math.PI / 4);
    tick(0.2, 0.04, -0.015, Math.PI / 4.2);
    return g;
  }

  const stack = new THREE.Group();
  scene.add(stack);
  let cards = [];
  let top = null;

  function build(count) {
    for (const c of cards) stack.remove(c);
    cards = [];
    const n = Math.max(2, Math.min(6, count + 1));
    for (let i = 0; i < n; i++) {
      const card = new THREE.Group();
      const mesh = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ color: PAPER[i % PAPER.length], roughness: 0.92 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      card.add(mesh);
      card.position.set(Math.sin(i * 2.3) * 0.05, i * GAP, Math.cos(i * 1.7) * 0.05);
      card.rotation.y = Math.sin(i * 1.9) * 0.11;
      stack.add(card);
      cards.push(card);
    }
    top = cards.at(-1);
    const ink = new THREE.Mesh(inkGeo, inkMat);
    ink.position.y = CARD_T + 0.006;
    top.add(ink);
    const seal = makeSeal();
    seal.position.set(0.42, CARD_T + 0.02, 0.58);
    top.add(seal);
    top.userData.baseY = top.position.y;
  }
  build(2);

  function resize() {
    const w = canvas.clientWidth || 380, hgt = canvas.clientHeight || 210;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(() => { resize(); renderer.render(scene, camera); });
  ro.observe(canvas);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  const start = performance.now();
  function frame() {
    const t = (performance.now() - start) / 1000;
    stack.rotation.y = -0.35 + Math.sin(t * 0.25) * 0.22;
    if (top) {
      top.position.y = top.userData.baseY + 0.06 + Math.sin(t * 0.9) * 0.035;
      top.rotation.z = Math.sin(t * 0.7) * 0.03;
    }
    renderer.render(scene, camera);
  }
  if (reduce) {
    stack.rotation.y = -0.35;
    renderer.render(scene, camera);
  } else {
    renderer.setAnimationLoop(() => { if (visible && !document.hidden) frame(); });
  }

  return {
    setCount(n) {
      if (n === this.count) return;
      this.count = n;
      build(n);
      if (reduce) renderer.render(scene, camera);
    },
  };
}
