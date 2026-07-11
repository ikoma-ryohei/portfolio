/* Starfield + shooting stars background — three.js, GPU-driven.
   Perf budget: all stars are ONE Points draw call; twinkle runs in the
   shader (per-frame CPU work = one uniform update). Meteors are a fixed
   pool of 4 lines, so nothing is allocated after startup. */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js";

(function () {
  "use strict";

  var canvas = document.querySelector(".bg-stars");
  if (!canvas) return;

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: "low-power",
    });
  } catch (e) {
    canvas.remove();
    return;
  }

  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(DPR);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    1,
    2000
  );

  /* ---------- Stars ---------- */

  var STAR_COUNT = 8000;
  var BAND_COUNT = 3400; /* stars pulled toward the Milky Way band */

  var positions = new Float32Array(STAR_COUNT * 3);
  var sizes = new Float32Array(STAR_COUNT);
  var phases = new Float32Array(STAR_COUNT);
  var speeds = new Float32Array(STAR_COUNT);
  var colors = new Float32Array(STAR_COUNT * 3);

  /* Tilted plane the band stars are compressed toward */
  var bandNormal = new THREE.Vector3(0.35, 1, 0.2).normalize();
  var v = new THREE.Vector3();

  for (var i = 0; i < STAR_COUNT; i++) {
    /* uniform direction on a sphere */
    var u = Math.random() * 2 - 1;
    var theta = Math.random() * Math.PI * 2;
    var s = Math.sqrt(1 - u * u);
    v.set(s * Math.cos(theta), u, s * Math.sin(theta));

    if (i < BAND_COUNT) {
      var along = v.dot(bandNormal);
      v.addScaledVector(bandNormal, -along * (0.85 + Math.random() * 0.12));
      v.normalize();
    }

    var radius = 420 + Math.random() * 560;
    positions[i * 3] = v.x * radius;
    positions[i * 3 + 1] = v.y * radius;
    positions[i * 3 + 2] = v.z * radius;

    /* power law: many faint stars, a few bright ones */
    sizes[i] = 1.0 + 3.4 * Math.pow(Math.random(), 4.5);
    phases[i] = Math.random() * Math.PI * 2;
    speeds[i] = 0.4 + Math.random() * 1.8;

    var r = 1, g = 1, b = 1;
    var tint = Math.random();
    if (tint < 0.22) {
      r = 0.72; g = 0.83; /* blue-white */
    } else if (tint < 0.38) {
      g = 0.9; b = 0.72; /* warm */
    } else if (tint < 0.42) {
      g = 0.72; b = 0.55; /* rare orange */
    }
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  var starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  starGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  starGeo.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  starGeo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

  var starMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: DPR },
    },
    vertexShader: [
      "attribute float aSize;",
      "attribute float aPhase;",
      "attribute float aSpeed;",
      "attribute vec3 aColor;",
      "uniform float uTime;",
      "uniform float uPixelRatio;",
      "varying vec3 vColor;",
      "varying float vTwinkle;",
      "void main() {",
      "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
      "  float tw = 0.72 + 0.28 * sin(uTime * aSpeed + aPhase);",
      "  vTwinkle = tw;",
      "  vColor = aColor;",
      "  gl_PointSize = aSize * uPixelRatio * (420.0 / -mv.z) * (0.85 + 0.15 * tw);",
      "  gl_Position = projectionMatrix * mv;",
      "}",
    ].join("\n"),
    fragmentShader: [
      "varying vec3 vColor;",
      "varying float vTwinkle;",
      "void main() {",
      "  vec2 uv = gl_PointCoord - 0.5;",
      "  float d = length(uv) * 2.0;",
      "  if (d > 1.0) discard;",
      "  float core = exp(-d * d * 6.5);",
      "  float glow = exp(-d * 3.0) * 0.35;",
      "  float a = (core + glow) * vTwinkle;",
      "  gl_FragColor = vec4(vColor * a, a);",
      "}",
    ].join("\n"),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true,
  });

  var starGroup = new THREE.Group();
  starGroup.add(new THREE.Points(starGeo, starMat));
  starGroup.rotation.z = 0.12; /* slight tilt so the band crosses diagonally */
  scene.add(starGroup);

  /* ---------- Shooting stars (fixed pool, additive-fading line trails) ---------- */

  var METEOR_POOL = 4;
  var TRAIL = 32;
  var meteors = [];

  for (var m = 0; m < METEOR_POOL; m++) {
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(TRAIL * 3);
    var col = new Float32Array(TRAIL * 3);
    for (var j = 0; j < TRAIL; j++) {
      /* head bright & slightly blue, tail fades to black (invisible in additive) */
      var k = Math.pow(1 - j / (TRAIL - 1), 2.2);
      col[j * 3] = 0.85 * k;
      col[j * 3 + 1] = 0.92 * k;
      col[j * 3 + 2] = 1.0 * k;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

    var mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    var line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);

    meteors.push({
      line: line,
      positions: pos,
      head: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      speed: 0,
      trailLen: 0,
      life: 0,
      age: 0,
      active: false,
    });
  }

  function spawnMeteor() {
    for (var i = 0; i < meteors.length; i++) {
      if (!meteors[i].active) {
        var mt = meteors[i];
        mt.head.set(
          (Math.random() * 2 - 1) * 500,
          140 + Math.random() * 280,
          -600
        );
        var sign = Math.random() < 0.5 ? -1 : 1;
        mt.dir
          .set(
            sign * (0.55 + Math.random() * 0.4),
            -(0.35 + Math.random() * 0.45),
            (Math.random() - 0.5) * 0.3
          )
          .normalize();
        mt.speed = 380 + Math.random() * 260;
        mt.trailLen = mt.speed * 0.3;
        mt.life = 0.9 + Math.random() * 0.7;
        mt.age = 0;
        mt.active = true;
        mt.line.visible = true;
        return;
      }
    }
  }

  function updateMeteors(dt) {
    for (var i = 0; i < meteors.length; i++) {
      var mt = meteors[i];
      if (!mt.active) continue;

      mt.age += dt;
      if (mt.age >= mt.life) {
        mt.active = false;
        mt.line.visible = false;
        mt.line.material.opacity = 0;
        continue;
      }

      mt.head.addScaledVector(mt.dir, mt.speed * dt);

      var t = mt.age / mt.life;
      mt.line.material.opacity = Math.sin(Math.PI * t);

      var p = mt.positions;
      for (var j = 0; j < TRAIL; j++) {
        var back = (j / (TRAIL - 1)) * mt.trailLen;
        p[j * 3] = mt.head.x - mt.dir.x * back;
        p[j * 3 + 1] = mt.head.y - mt.dir.y * back;
        p[j * 3 + 2] = mt.head.z - mt.dir.z * back;
      }
      mt.line.geometry.attributes.position.needsUpdate = true;
    }
  }

  /* ---------- Loop ---------- */

  var clock = new THREE.Clock();
  var nextMeteorIn = 1.5 + Math.random() * 3;
  var scrollY = 0;
  var rafId = null;

  window.addEventListener(
    "scroll",
    function () {
      scrollY = window.pageYOffset;
    },
    { passive: true }
  );

  function frame() {
    rafId = requestAnimationFrame(frame);

    var dt = Math.min(clock.getDelta(), 0.1);
    var t = clock.elapsedTime;

    starMat.uniforms.uTime.value = t;
    starGroup.rotation.y = t * 0.006; /* one slow drift, ~17 min per turn */
    starGroup.rotation.x = -scrollY * 0.00012; /* subtle scroll parallax */

    nextMeteorIn -= dt;
    if (nextMeteorIn <= 0) {
      spawnMeteor();
      nextMeteorIn = 2.5 + Math.random() * 5;
    }
    updateMeteors(dt);

    renderer.render(scene, camera);
  }

  function start() {
    if (rafId === null) {
      clock.getDelta(); /* swallow the pause so meteors don't jump */
      frame();
    }
  }

  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (reducedMotion) return;
    document.hidden ? stop() : start();
  });

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      if (reducedMotion) renderer.render(scene, camera);
    }, 150);
  });

  if (reducedMotion) {
    /* static sky: one frame, no meteors, no loop */
    starMat.uniforms.uTime.value = 1;
    renderer.render(scene, camera);
  } else {
    start();
  }
})();
