// Slow soap bubbles that rise from the timeline and pop, behind the dashboard.
(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.getElementById("bubbles");
  const ctx = canvas.getContext("2d");

  // All positions use the 1920x1080 Figma frame, like the rest of the page.
  const TIMELINE_Y = 962;
  const LINE_LEFT = 129;
  const LINE_RIGHT = 1771;
  const PHOTO_LEFT = 502;
  const PHOTO_RIGHT = 1418;
  const PHOTO_TOP = 338;
  const PHOTO_BOTTOM = 904;
  const MAX_BUBBLES = 16;
  const SPAWN_EVERY = 1.5;
  const GROW_TIME = 1.6;
  const POP_TIME = 0.45;

  const TEAL = "1, 161, 175";
  const YELLOW = "251, 198, 64";

  const random = (min, max) => min + Math.random() * (max - min);
  const bubbles = [];
  const pops = [];
  let spawnTimer = 0;
  let pointer = null;
  let last = performance.now();
  let view = { scale: 1, x: 0, y: 0, dpr: 1 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = Math.min(width / 1920, height / 1080);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    view = { scale, dpr, x: (width - 1920 * scale) / 2, y: (height - 1080 * scale) / 2 };
  }

  // Most bubbles rise beside the photo. The rest pass behind it and reappear above.
  function spawn() {
    const roll = Math.random();
    let x;
    let popY;
    if (roll < 0.85) {
      x = roll < 0.425 ? random(LINE_LEFT, PHOTO_LEFT - 30) : random(PHOTO_RIGHT + 30, LINE_RIGHT);
      popY = random(90, 780);
    } else {
      x = random(PHOTO_LEFT + 40, PHOTO_RIGHT - 40);
      popY = random(30, PHOTO_TOP - 50);
    }
    bubbles.push({
      x,
      y: TIMELINE_Y,
      popY,
      radius: random(9, 38),
      speed: random(24, 46),
      sway: random(8, 24),
      swaySpeed: random(0.35, 0.8),
      phase: random(0, Math.PI * 2),
      age: 0,
    });
  }

  function drawBubble(x, y, r) {
    const fill = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.1, x, y, r);
    fill.addColorStop(0, `rgba(${TEAL}, 0)`);
    fill.addColorStop(0.72, `rgba(${TEAL}, 0.04)`);
    fill.addColorStop(1, `rgba(${TEAL}, 0.2)`);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `rgba(${TEAL}, 0.36)`;
    ctx.stroke();

    ctx.lineWidth = 1.6;
    ctx.strokeStyle = `rgba(${YELLOW}, 0.6)`;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.82, 0.25, 1.25);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.17, r * 0.1, -0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPop(pop) {
    const t = pop.age / POP_TIME;
    const fade = 1 - t;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(${TEAL}, ${0.34 * fade})`;
    ctx.beginPath();
    ctx.arc(pop.x, pop.y, pop.radius * (1 + t * 0.35), 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = `rgba(${TEAL}, ${0.5 * fade})`;
    pop.drops.forEach((angle) => {
      const distance = pop.radius * (1 + t * 0.8);
      ctx.beginPath();
      ctx.arc(
        pop.x + Math.cos(angle) * distance,
        pop.y + Math.sin(angle) * distance + t * t * 10,
        1.8 * fade + 0.4,
        0,
        Math.PI * 2
      );
      ctx.fill();
    });
  }

  function popBubble(index) {
    const b = bubbles[index];
    const drops = Array.from({ length: 7 }, () => random(0, Math.PI * 2));
    pops.push({ x: b.drawX, y: b.y, radius: b.drawRadius, age: 0, drops });
    bubbles.splice(index, 1);
  }

  const behindPhoto = (x, y) =>
    x > PHOTO_LEFT && x < PHOTO_RIGHT && y > PHOTO_TOP && y < PHOTO_BOTTOM;

  function distanceToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
      : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // Checks the whole path since the last event, so a fast mouse still pops bubbles.
  function popTouched(event) {
    const x = (event.clientX - view.x) / view.scale;
    const y = (event.clientY - view.y) / view.scale;
    const from = pointer || { x, y };
    pointer = { x, y };
    for (let i = bubbles.length - 1; i >= 0; i -= 1) {
      const b = bubbles[i];
      if (b.drawX === undefined || behindPhoto(b.drawX, b.y)) continue;
      if (distanceToSegment(b.drawX, b.y, from.x, from.y, x, y) <= b.drawRadius) popBubble(i);
    }
  }

  window.addEventListener("pointermove", popTouched);
  window.addEventListener("pointerdown", popTouched);
  document.documentElement.addEventListener("pointerleave", () => { pointer = null; });

  function frame(now) {
    // A long gap means the tab was in the background, so don't jump ahead.
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    spawnTimer -= dt;
    if (spawnTimer <= 0 && bubbles.length < MAX_BUBBLES) {
      spawn();
      spawnTimer = random(SPAWN_EVERY * 0.6, SPAWN_EVERY * 1.4);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(
      view.dpr * view.scale, 0, 0, view.dpr * view.scale,
      view.dpr * view.x, view.dpr * view.y
    );

    for (let i = bubbles.length - 1; i >= 0; i -= 1) {
      const b = bubbles[i];
      b.age += dt;
      b.y -= b.speed * dt;
      b.drawX = b.x + Math.sin(b.age * b.swaySpeed + b.phase) * b.sway;
      b.drawRadius = b.radius * (0.25 + 0.75 * Math.min(b.age / GROW_TIME, 1));
      if (b.y <= b.popY) {
        popBubble(i);
        continue;
      }
      drawBubble(b.drawX, b.y, b.drawRadius);
    }

    for (let i = pops.length - 1; i >= 0; i -= 1) {
      pops[i].age += dt;
      if (pops[i].age >= POP_TIME) pops.splice(i, 1);
      else drawPop(pops[i]);
    }

    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frame);
})();
