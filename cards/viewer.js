/* Shared holographic card viewer.
   Each card page ships a card.json next to it; this module renders it. */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const stage = document.querySelector("#stage");
const loading = document.querySelector("#loading");
const $ = (id) => document.getElementById(id);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const HOME_X = 0.025;
const HOME_Y = -0.13;

let renderer, composer, root, uniforms, config;
let auto = false;
let flipped = false;
let dragging = false;
let targetX = HOME_X;
let targetY = HOME_Y;
let targetZoom = 1;
let rotationX = targetX;
let rotationY = targetY;
let last = { x: 0, y: 0 };
let lastTime = 0;
let elapsed = 0;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-5, 5, 5.65, -5.65, 0.1, 100);
camera.position.set(0, 0, 20);
camera.lookAt(0, 0, 0);

/* ---------- shaders ---------- */

const vertex = `
varying vec2 vUv;
void main(){
  vUv = vec2(uv.x, 1.0 - uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/* Helpers shared by every face: the iridescence is driven by uView, the card's
   own view vector, so the foil moves with the card rather than with the clock. */
const shared = `
precision highp float;
varying vec2 vUv;
uniform float uTime, uFoil, uScale, uDepth, uBgDepth, uSafeScale;
uniform vec2 uSafeOffset;
uniform vec3 uView;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

vec3 spectrum(float t){
  t = fract(t);
  vec3 pink = vec3(1.0, 0.32, 0.62), yellow = vec3(1.0, 0.85, 0.32), blue = vec3(0.22, 0.62, 1.0);
  if (t < 0.35) return mix(pink, yellow, t / 0.35);
  if (t < 0.70) return mix(yellow, blue, (t - 0.35) / 0.35);
  return mix(blue, vec3(1.0), (t - 0.70) / 0.30);
}

vec3 overlay(vec3 b, vec3 f){ return mix(2.0 * b * f, 1.0 - 2.0 * (1.0 - b) * (1.0 - f), step(vec3(0.5), b)); }

float inside(vec2 p){ return step(0.0, p.x) * step(0.0, p.y) * step(p.x, 1.0) * step(p.y, 1.0); }

vec2 parallax(vec2 p, float s, float d){
  return (p - 0.5) * s + 0.5 + uView.xy / max(abs(uView.z), 0.35) * d * 0.14;
}

float wave(vec2 p){
  vec2 a = p + uView.xy * 2.4;
  return 0.5 + 0.5 * sin((a.x * 0.848 - a.y * 0.530) * 6.283 * 0.55 + 7.0 * noise(a * 1.5));
}

/* Sparse twinkling stars, cheap Worley edges gated by a hash so only a few cells light up. */
float star(vec2 p){
  vec2 q = p * 105.0, id = floor(q), f = fract(q);
  float first = 9.0, second = 9.0;
  for (int y = -1; y <= 1; y++){
    for (int x = -1; x <= 1; x++){
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash(id + g), hash(id + g + 43.3));
      float d = length(g + o - f);
      if (d < first){ second = first; first = d; } else second = min(second, d);
    }
  }
  float edge = 1.0 - smoothstep(0.01, 0.035, second - first);
  float sparse = step(0.90, hash(id + 8.8));
  float twinkle = pow(0.5 + 0.5 * sin(uTime * 1.8 + hash(id) * 30.0 + uView.x * 27.0 + uView.y * 21.0), 6.0);
  return edge * sparse * twinkle;
}
`;

const frontFragment = shared + `
uniform sampler2D tBackground;
#ifdef HAS_SUBJECT
uniform sampler2D tSubject;
#endif
#ifdef HAS_LINE
uniform sampler2D tLine;
#endif
#ifdef HAS_TEXT
uniform sampler2D tText;
#endif

void main(){
  vec2 uv = vUv;
  vec2 bu = parallax(uv, 1.0, uBgDepth);
  vec3 col = texture2D(tBackground, clamp(bu, 0.0, 1.0)).rgb;

  float w = wave(uv);
  vec3 foil = spectrum(w * 0.8 + noise(uv * 5.0) * 0.12);
  col = mix(col, overlay(col, foil), uFoil * 0.36);

  float subjectAlpha = 0.0;
#ifdef HAS_SUBJECT
  vec2 su = parallax(uv, uScale, uDepth) * uSafeScale + uSafeOffset;
  vec4 sub = texture2D(tSubject, clamp(su, 0.0, 1.0));
  sub.a *= inside(su);
  subjectAlpha = sub.a;
  vec3 subject = mix(sub.rgb, overlay(sub.rgb, foil), uFoil * 0.28);
  col = mix(col, subject, sub.a);
#endif

  /* One bright band raking across the face as the card turns. */
  float sweep = pow(max(0.0, sin((uv.x * 0.83 + uv.y * 0.35 + uView.x * 1.8 + uView.y * 0.9) * 6.283)), 12.0);
  col += foil * sweep * uFoil * 0.28;

#ifdef HAS_LINE
  float line = 1.0 - smoothstep(0.06, 0.25, texture2D(tLine, clamp(su, 0.0, 1.0)).r);
  col += vec3(1.0, 0.94, 0.78) * line * inside(su) * subjectAlpha * sweep * uFoil * 0.22;
#endif

  col += vec3(0.66, 0.86, 1.0) * star(bu) * uFoil * 0.65 * (1.0 - subjectAlpha * 0.7);

#ifdef HAS_TEXT
  vec4 text = texture2D(tText, uv);
  col = mix(col, text.rgb, text.a);
#endif

  /* Keep print saturation; the selective highlights feed the bloom pass. */
  gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(2.2)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const edgeFragment = shared + `
void main(){
  vec3 col = mix(vec3(0.55, 0.34, 0.10), spectrum(wave(vUv)), 0.65 + uFoil * 0.2);
  gl_FragColor = vec4(col * 0.8 + 0.14, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const backFragment = shared + `
uniform sampler2D tBack;
void main(){
  vec4 art = texture2D(tBack, vUv);
  vec2 p = vUv - 0.5;
  float filigree = 0.5 + 0.5 * sin(length(p * vec2(1.0, 1.5)) * 100.0 + noise(p * 15.0) * 4.0);
  vec3 col = mix(vec3(0.025, 0.042, 0.064), vec3(0.085, 0.092, 0.110), filigree * 0.35);
  float border = step(0.465, max(abs(p.x), abs(p.y)));
  col = mix(col, spectrum(wave(vUv)) * 0.55, border);
  col += spectrum(wave(vUv)) * uFoil * 0.08;
  col = mix(col, art.rgb, art.a);
  gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------- card back, drawn on a canvas ---------- */

function backTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1536;
  const ctx = c.getContext("2d");

  ctx.strokeStyle = "#c2a368";
  ctx.lineWidth = 2;
  ctx.strokeRect(74, 74, 876, 1388);
  ctx.strokeRect(87, 87, 850, 1362);

  ctx.save();
  ctx.translate(512, 650);
  ctx.rotate(Math.PI / 4);
  ctx.strokeRect(-210, -210, 420, 420);
  ctx.strokeRect(-196, -196, 392, 392);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = "#dbc18b";
  ctx.font = '166px "Noto Serif JP", "Yu Mincho", serif';
  ctx.fillText(config.backMark || "星", 512, 709);

  ctx.font = '30px "Noto Serif JP", "Yu Mincho", serif';
  ctx.fillText(config.collectionJa || config.collection || "", 512, 1050);

  ctx.fillStyle = "#a09a8f";
  ctx.font = "19px Prompt, Georgia, serif";
  ctx.fillText((config.collection || "").toUpperCase(), 512, 1112);
  ctx.fillText("RYOHEI IKOMA  ·  CARD ARCHIVE", 512, 1262);
  ctx.fillText(`No.${config.no || "000"}   ${config.edition || ""}`, 512, 1310);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/* ---------- setup ---------- */

async function init() {
  config = await fetch("./card.json").then((r) => {
    if (!r.ok) throw new Error("card.json を読み込めませんでした");
    return r.json();
  });

  fillMeta();

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  stage.append(renderer.domElement);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(720, 1000), 0.18, 0.35, 1.0));
  composer.addPass(new OutputPass());

  const loader = new THREE.TextureLoader();
  const layers = {};
  for (const name of ["background", "subject", "text", "lineart"]) {
    const url = config.assets[name];
    if (!url) continue;
    const tex = await loader.loadAsync(url);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    layers[name] = tex;
  }

  const prm = config.parameters || {};
  uniforms = {
    tBackground: { value: layers.background },
    tBack: { value: backTexture() },
    uTime: { value: 0 },
    uView: { value: new THREE.Vector3(0, 0, 1) },
    uFoil: { value: prm.foil ?? 0.65 },
    uScale: { value: prm.subjectScale ?? 1.25 },
    uDepth: { value: prm.subjectDepth ?? 0.4 },
    uBgDepth: { value: prm.backgroundDepth ?? -0.25 },
    uSafeScale: { value: config.safeArea?.scale ?? 1 },
    uSafeOffset: { value: new THREE.Vector2(...(config.safeArea?.offset ?? [0, 0])) },
  };

  const defines = {};
  if (layers.subject) { uniforms.tSubject = { value: layers.subject }; defines.HAS_SUBJECT = ""; }
  if (layers.text) { uniforms.tText = { value: layers.text }; defines.HAS_TEXT = ""; }
  if (layers.lineart && layers.subject) { uniforms.tLine = { value: layers.lineart }; defines.HAS_LINE = ""; }

  const frontMat = new THREE.ShaderMaterial({ uniforms, defines, vertexShader: vertex, fragmentShader: frontFragment, side: THREE.FrontSide });
  const edgeMat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: edgeFragment });
  const backMat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: backFragment });
  const goldMat = new THREE.MeshBasicMaterial({ color: 0xbfa26b });

  const gltf = await new GLTFLoader().loadAsync(config.assets.model);
  root = new THREE.Group();
  root.add(gltf.scene);
  scene.add(root);

  let face = null;
  gltf.scene.traverse((ob) => {
    if (!ob.isMesh) return;
    const role = ob.material?.name;
    if (role === "web_front") { ob.material = frontMat; face = ob; }
    else if (role === "web_back") ob.material = backMat;
    else if (role === "web_gold") ob.material = goldMat;
    else if (role === "web_text") ob.visible = false;
    else ob.material = edgeMat;
  });
  if (!face) throw new Error("カードモデルに web_front マテリアルがありません");

  setupControls();
  new ResizeObserver(resize).observe(stage);
  resize();
  loading.remove();
  stage.classList.add("is-ready");

  renderer.setAnimationLoop(animate);
}

function fillMeta() {
  const map = {
    "card-no": "no",
    "card-title": "title",
    "card-title-ja": "titleJa",
    "card-subtitle": "subtitle",
    "card-collection": "collection",
    "card-description": "description",
    "card-tagline": "tagline",
    "card-technique": "technique",
    "card-edition": "edition",
    "card-rarity": "rarity",
  };
  for (const [id, key] of Object.entries(map)) {
    const node = $(id);
    if (node && config[key]) node.textContent = config[key];
  }
  if (config.title) document.title = `${config.title} — カード図鑑 No.${config.no} | Ryohei Ikoma`;
}

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h || !renderer) return;
  const halfH = 5.65 / targetZoom;
  const aspect = w / h;
  camera.left = -halfH * aspect;
  camera.right = halfH * aspect;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
}

function setAuto(value) {
  auto = value;
  const button = $("auto");
  button.setAttribute("aria-pressed", String(auto));
  button.textContent = auto ? "自動回転を止める" : "自動で眺める";
}

function reset() {
  targetX = HOME_X;
  targetY = HOME_Y;
  targetZoom = 1;
  flipped = false;
  setAuto(false);
  syncFace();
  resize();
}

function flip() {
  flipped = !flipped;
  setAuto(false);
  targetY = flipped ? Math.PI : 0;
  targetX = 0;
  syncFace();
}

function syncFace() {
  $("flip").textContent = flipped ? "表にもどす" : "裏を見る";
  $("view-label").textContent = flipped ? "BACK ／ 裏面" : "FRONT ／ 表面";
}

function setupControls() {
  const sliders = [
    ["foil", "uFoil", (v) => `${Math.round(v * 100)}%`],
    ["depth", "uBgDepth", (v) => Number(v).toFixed(2)],
  ];
  if (uniforms.tSubject) {
    sliders.push(["scale", "uScale", (v) => Number(v).toFixed(2)]);
  }
  for (const [id, name, format] of sliders) {
    const input = $(id);
    if (!input) continue;
    input.closest(".control")?.removeAttribute("hidden");
    input.value = uniforms[name].value;
    const update = () => {
      uniforms[name].value = Number(input.value);
      $(`${id}-value`).textContent = format(input.value);
    };
    input.addEventListener("input", update);
    update();
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    setAuto(false);
    last = { x: e.clientX, y: e.clientY };
    stage.setPointerCapture(e.pointerId);
    stage.focus({ preventScroll: true });
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const base = flipped ? Math.PI : 0;
    targetY = THREE.MathUtils.clamp(targetY + (e.clientX - last.x) * 0.006, base - 0.65, base + 0.65);
    targetX = THREE.MathUtils.clamp(targetX + (e.clientY - last.y) * 0.005, -0.43, 0.43);
    last = { x: e.clientX, y: e.clientY };
  });
  const up = () => { dragging = false; };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
  stage.addEventListener("lostpointercapture", up);

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    targetZoom = THREE.MathUtils.clamp(targetZoom - e.deltaY * 0.001, 0.82, 1.18);
    resize();
  }, { passive: false });

  stage.addEventListener("keydown", (e) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "f", "F", "r", "R"];
    if (keys.includes(e.key)) { e.preventDefault(); setAuto(false); }
    const base = flipped ? Math.PI : 0;
    if (e.key === "ArrowLeft") targetY -= 0.07;
    if (e.key === "ArrowRight") targetY += 0.07;
    if (e.key === "ArrowUp") targetX -= 0.06;
    if (e.key === "ArrowDown") targetX += 0.06;
    if (e.key.toLowerCase() === "f") flip();
    if (e.key.toLowerCase() === "r") reset();
    targetY = THREE.MathUtils.clamp(targetY, base - 0.65, base + 0.65);
    targetX = THREE.MathUtils.clamp(targetX, -0.43, 0.43);
  });

  $("auto").onclick = () => { if (flipped) flip(); setAuto(!auto); };
  $("flip").onclick = flip;
  $("reset").onclick = reset;

  const save = $("save");
  if (save) {
    save.onclick = () => {
      try {
        composer.render();
        const a = document.createElement("a");
        a.download = `${(config.title || "card").toLowerCase().replace(/\s+/g, "-")}.png`;
        a.href = renderer.domElement.toDataURL("image/png");
        a.click();
      } catch {
        save.textContent = "保存できませんでした";
      }
    };
  }
}

function animate(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1) || 0;
  lastTime = now;
  if (!document.hidden) elapsed += dt;

  if (auto) {
    targetY = Math.sin(elapsed * 0.65) * 0.38;
    targetX = Math.sin(elapsed * 0.85) * 0.12;
  }

  const ease = reduced ? 1 : 1 - Math.exp(-dt * 8);
  rotationX += (targetX - rotationX) * ease;
  rotationY += (targetY - rotationY) * ease;
  root.rotation.set(rotationX, rotationY, 0);
  root.updateMatrixWorld(true);

  uniforms.uView.value
    .copy(camera.position)
    .applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert())
    .normalize();
  uniforms.uTime.value = reduced && !auto ? 0 : elapsed;

  composer.render();
}

init().catch((error) => {
  console.error(error);
  stage.classList.add("is-fallback");
  loading.innerHTML =
    '<p>3D表示を読み込めませんでした。静止画で表示しています。</p>' +
    '<p class="fine">' + String(error.message || error) + "</p>";
  loading.setAttribute("role", "alert");
});
