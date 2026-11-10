'use strict';

/*
 * Optional full-screen explosions, off until the visitor turns them on. Shards and
 * fire burst out across a canvas that covers the page, and the page shakes. Each
 * one also leaves lasting weathering and damage that eventually break the machine,
 * until explosions are turned off. There is deliberately no full-screen flash,
 * because a run sets off many explosions per second and rapid flashing can trigger
 * seizures.
 */
const Explosions = (() => {
  const SHARDS_PER_BURST = 36;
  const MAX_SHARDS = 1400;
  const MIN_SPEED = 250;
  const MAX_SPEED = 1500;
  const GRAVITY = 1100;
  const MIN_LIFE_SECONDS = 0.7;
  const MAX_LIFE_SECONDS = 1.3;
  const MIN_SHARD_SIZE = 4;
  const MAX_SHARD_SIZE = 13;
  const RING_SECONDS = 0.45;
  const RING_REACH = 0.6;

  const FLAMES_PER_BURST = 22;
  const SMOKE_PER_BURST = 5;
  const MAX_FIRE_PUFFS = 800;
  const FIRE_MAX_SPEED = 420;
  const FIRE_BUOYANCY = -520;
  const FIRE_DRAG_PER_SECOND = 1.8;
  const FLAME_MIN_SIZE = 50;
  const FLAME_MAX_SIZE = 170;
  const FLAME_MIN_LIFE = 0.45;
  const FLAME_MAX_LIFE = 0.95;
  const SMOKE_MIN_SIZE = 90;
  const SMOKE_MAX_SIZE = 220;
  const SMOKE_MIN_LIFE = 0.9;
  const SMOKE_MAX_LIFE = 1.6;
  const SMOKE_OPACITY = 0.3;
  const SPRITE_SIZE = 64;

  const TRAUMA_PER_BURST = 0.3;
  const TRAUMA_DECAY_PER_SECOND = 1.6;
  const MAX_SHAKE_PIXELS = 26;
  const MAX_SHAKE_DEGREES = 1.4;
  const MAX_FRAME_SECONDS = 1 / 30;

  // Damage builds with every explosion. Halfway to the limit the machine starts
  // misbehaving, and at the limit it stops working.
  const BREAK_AFTER_BURSTS = 400;
  const CHAOS_STARTS_AT_DAMAGE = 0.5;

  const SCORCHES_PER_BURST = 3;
  const SOOT_PATCHES_PER_BURST = 3;
  const SPECKS_PER_BURST = 6;
  const SOOT_PATCH_CENTERS = 7;
  const SOOT_PATCH_SPREAD = 0.22;
  const CRACKS_START_AT_DAMAGE = 0.2;
  const CRACK_MAX_DEPTH = 2;

  const randomBetween = (low, high) => low + Math.random() * (high - low);
  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** A soft round puff, drawn once and reused, because gradients are slow to draw per frame. */
  function makeSprite(red, green, blue) {
    const sprite = document.createElement('canvas');
    sprite.width = SPRITE_SIZE;
    sprite.height = SPRITE_SIZE;
    const spriteContext = sprite.getContext('2d');
    const middle = SPRITE_SIZE / 2;
    const glow = spriteContext.createRadialGradient(middle, middle, 0, middle, middle, middle);
    glow.addColorStop(0, `rgba(${red}, ${green}, ${blue}, 1)`);
    glow.addColorStop(0.45, `rgba(${red}, ${green}, ${blue}, 0.6)`);
    glow.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
    spriteContext.fillStyle = glow;
    spriteContext.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    return sprite;
  }

  // A flame cools from yellow through orange to red as it ages.
  const FLAME_SPRITES = [makeSprite(255, 200, 40), makeSprite(255, 110, 15), makeSprite(200, 35, 10)];
  const SMOKE_SPRITE = makeSprite(55, 50, 50);
  const BURN_SPRITE = makeSprite(95, 50, 20);
  const CHAR_SPRITE = makeSprite(24, 18, 14);

  const canvas = document.createElement('canvas');
  canvas.className = 'explosions';
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');

  let enabled = false;
  let shards = [];
  let rings = [];
  let flames = [];
  let smoke = [];
  let trauma = 0;
  let burstCount = 0;
  let frameId = null;
  let lastFrameTime = null;

  // Weathering is drawn once and never cleared, so it builds up like real soot.
  const weatheringCanvas = document.createElement('canvas');
  weatheringCanvas.className = 'weathering';
  weatheringCanvas.setAttribute('aria-hidden', 'true');
  const weathering = weatheringCanvas.getContext('2d');

  // Soot gathers in a few places, which keeps the darkening patchy across the page.
  const sootPatchCenters = Array.from({ length: SOOT_PATCH_CENTERS }, () => ({
    x: Math.random(),
    y: Math.random(),
  }));

  const damage = () => Math.min(1, burstCount / BREAK_AFTER_BURSTS);
  const isBroken = () => damage() >= 1;
  const sag = () => damage() ** 2;
  const chaos = () => Math.max(0, (damage() - CHAOS_STARTS_AT_DAMAGE) / (1 - CHAOS_STARTS_AT_DAMAGE));

  /** A bell-curve random offset, so marks cluster near their center. */
  function randomNear(center, spread) {
    return center + (Math.random() + Math.random() + Math.random() - 1.5) * spread;
  }

  function fitToWindow() {
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * pixelRatio);
    const height = Math.round(window.innerHeight * pixelRatio);
    canvas.width = width;
    canvas.height = height;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    // Resizing a canvas erases it, so carry the weathering across.
    const saved = document.createElement('canvas');
    saved.width = weatheringCanvas.width;
    saved.height = weatheringCanvas.height;
    saved.getContext('2d').drawImage(weatheringCanvas, 0, 0);
    weatheringCanvas.width = width;
    weatheringCanvas.height = height;
    weathering.setTransform(1, 0, 0, 1, 0, 0);
    weathering.drawImage(saved, 0, 0, width, height);
    weathering.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function stamp(sprite, x, y, width, height, opacity) {
    weathering.globalAlpha = opacity;
    weathering.drawImage(sprite, x - width / 2, y - height / 2, width, height);
  }

  function drawCrack(x, y, direction, depth) {
    let pointX = x;
    let pointY = y;
    let heading = direction;
    const segments = Math.round(randomBetween(6, 18));

    weathering.beginPath();
    weathering.moveTo(pointX, pointY);
    for (let i = 0; i < segments; i += 1) {
      heading += randomBetween(-0.6, 0.6);
      const length = randomBetween(12, 45);
      pointX += Math.cos(heading) * length;
      pointY += Math.sin(heading) * length;
      weathering.lineTo(pointX, pointY);
      if (depth < CRACK_MAX_DEPTH && Math.random() < 0.15) {
        weathering.stroke();
        drawCrack(pointX, pointY, heading + randomBetween(-1.2, 1.2), depth + 1);
        weathering.beginPath();
        weathering.moveTo(pointX, pointY);
      }
    }
    weathering.stroke();
  }

  function addWeathering(x, y) {
    const level = damage();

    // Burn marks where the explosion happened. They spread out as damage builds.
    for (let i = 0; i < SCORCHES_PER_BURST; i += 1) {
      const size = randomBetween(25, 90 + level * 160);
      const spread = 70 + level * 420;
      const sprite = Math.random() < 0.5 ? BURN_SPRITE : CHAR_SPRITE;
      stamp(sprite, randomNear(x, spread), randomNear(y, spread), size, size * randomBetween(0.6, 1.2), randomBetween(0.04, 0.12));
    }

    // Soot rises, so each explosion leaves a smear above it.
    const smearHeight = randomBetween(120, 380);
    stamp(CHAR_SPRITE, randomNear(x, 90), y - smearHeight / 2, randomBetween(25, 80), smearHeight, randomBetween(0.03, 0.08));

    // Patches of soot well away from the explosion, which eventually reach everywhere.
    for (let i = 0; i < SOOT_PATCHES_PER_BURST; i += 1) {
      const center = sootPatchCenters[Math.floor(Math.random() * SOOT_PATCH_CENTERS)];
      const size = randomBetween(120, 420);
      stamp(
        CHAR_SPRITE,
        randomNear(center.x, SOOT_PATCH_SPREAD * 3) * window.innerWidth,
        randomNear(center.y, SOOT_PATCH_SPREAD * 3) * window.innerHeight,
        size,
        size * randomBetween(0.5, 1),
        randomBetween(0.015, 0.05),
      );
    }

    // Fine specks of grit.
    for (let i = 0; i < SPECKS_PER_BURST; i += 1) {
      const size = randomBetween(2, 7);
      stamp(CHAR_SPRITE, randomNear(x, 500), randomNear(y, 500), size, size, randomBetween(0.3, 0.8));
    }

    if (level > CRACKS_START_AT_DAMAGE && Math.random() < level * 0.08) {
      weathering.globalAlpha = 0.8;
      weathering.strokeStyle = '#0c0907';
      weathering.lineWidth = randomBetween(0.8, 1.8);
      drawCrack(randomNear(x, 300), randomNear(y, 300), randomBetween(0, Math.PI * 2), 0);
    }
    weathering.globalAlpha = 1;
  }

  /** Publishes the damage level to the stylesheet, which bends and darkens the page. */
  function showDamage() {
    const root = document.documentElement;
    root.style.setProperty('--damage', damage());
    root.style.setProperty('--sag', sag());
    root.classList.toggle('is-broken', isBroken());
  }

  function updateFirePuffs(puffs, dt) {
    const drag = Math.max(0, 1 - FIRE_DRAG_PER_SECOND * dt);
    puffs.forEach((puff) => {
      puff.speedX *= drag;
      puff.speedY = puff.speedY * drag + FIRE_BUOYANCY * dt;
      puff.x += puff.speedX * dt;
      puff.y += puff.speedY * dt;
      puff.age += dt;
    });
    return puffs.filter((puff) => puff.age < puff.life);
  }

  function update(dt) {
    shards.forEach((shard) => {
      shard.speedY += GRAVITY * dt;
      shard.x += shard.speedX * dt;
      shard.y += shard.speedY * dt;
      shard.angle += shard.spin * dt;
      shard.age += dt;
    });
    shards = shards.filter((shard) => shard.age < shard.life);

    flames = updateFirePuffs(flames, dt);
    smoke = updateFirePuffs(smoke, dt);

    rings.forEach((ring) => { ring.age += dt; });
    rings = rings.filter((ring) => ring.age < RING_SECONDS);

    trauma = Math.max(0, trauma - TRAUMA_DECAY_PER_SECOND * dt);
  }

  function shakePage() {
    if (trauma === 0) {
      document.body.style.transform = '';
      return;
    }
    // Squaring makes the shake fall off sharply instead of fading evenly.
    const strength = trauma * trauma;
    const x = randomBetween(-1, 1) * MAX_SHAKE_PIXELS * strength;
    const y = randomBetween(-1, 1) * MAX_SHAKE_PIXELS * strength;
    const angle = randomBetween(-1, 1) * MAX_SHAKE_DEGREES * strength;
    document.body.style.transform = `translate(${x}px, ${y}px) rotate(${angle}deg)`;
  }

  function drawPuff(puff, sprite, opacity) {
    const progress = puff.age / puff.life;
    const size = puff.size * (0.5 + progress);
    context.globalAlpha = opacity * (1 - progress);
    context.drawImage(sprite, puff.x - size / 2, puff.y - size / 2, size, size);
  }

  function drawFire() {
    smoke.forEach((puff) => drawPuff(puff, SMOKE_SPRITE, SMOKE_OPACITY));

    // Overlapping flames add together, so the middle of a fireball glows hottest.
    context.globalCompositeOperation = 'lighter';
    flames.forEach((puff) => {
      const stage = Math.floor((puff.age / puff.life) * FLAME_SPRITES.length);
      drawPuff(puff, FLAME_SPRITES[stage], 1);
    });
    context.globalCompositeOperation = 'source-over';
  }

  function draw() {
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    drawFire();

    const reach = Math.hypot(window.innerWidth, window.innerHeight) * RING_REACH;
    rings.forEach((ring) => {
      const progress = ring.age / RING_SECONDS;
      context.globalAlpha = (1 - progress) * 0.5;
      context.strokeStyle = ring.color;
      context.lineWidth = 8 * (1 - progress) + 1;
      context.beginPath();
      context.arc(ring.x, ring.y, progress * reach, 0, Math.PI * 2);
      context.stroke();
    });

    shards.forEach((shard) => {
      context.globalAlpha = 1 - shard.age / shard.life;
      context.fillStyle = shard.color;
      context.save();
      context.translate(shard.x, shard.y);
      context.rotate(shard.angle);
      context.fillRect(-shard.size / 2, -shard.size / 2, shard.size, shard.size * 0.6);
      context.restore();
    });
    context.globalAlpha = 1;
  }

  function frame(time) {
    const elapsed = lastFrameTime === null ? 0 : (time - lastFrameTime) / 1000;
    lastFrameTime = time;
    update(Math.min(elapsed, MAX_FRAME_SECONDS));
    shakePage();
    draw();

    const active = shards.length > 0 || rings.length > 0 || flames.length > 0 || smoke.length > 0 || trauma > 0;
    frameId = active ? requestAnimationFrame(frame) : null;
  }

  function makeFirePuff(x, y, minSize, maxSize, minLife, maxLife) {
    const direction = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(0, FIRE_MAX_SPEED);
    return {
      x,
      y,
      speedX: Math.cos(direction) * speed,
      speedY: Math.sin(direction) * speed,
      size: randomBetween(minSize, maxSize),
      age: 0,
      life: randomBetween(minLife, maxLife),
    };
  }

  function addFire(x, y) {
    for (let i = 0; i < FLAMES_PER_BURST; i += 1) {
      flames.push(makeFirePuff(x, y, FLAME_MIN_SIZE, FLAME_MAX_SIZE, FLAME_MIN_LIFE, FLAME_MAX_LIFE));
    }
    for (let i = 0; i < SMOKE_PER_BURST; i += 1) {
      smoke.push(makeFirePuff(x, y, SMOKE_MIN_SIZE, SMOKE_MAX_SIZE, SMOKE_MIN_LIFE, SMOKE_MAX_LIFE));
    }
    // Long runs retire the oldest puffs first, which keeps the frame rate steady.
    if (flames.length > MAX_FIRE_PUFFS) flames = flames.slice(flames.length - MAX_FIRE_PUFFS);
    if (smoke.length > MAX_FIRE_PUFFS) smoke = smoke.slice(smoke.length - MAX_FIRE_PUFFS);
  }

  /** Sets off one explosion at a point on the screen, in the given colors. */
  function burst(x, y, colors) {
    if (!enabled || prefersReducedMotion()) return;

    for (let i = 0; i < SHARDS_PER_BURST; i += 1) {
      const direction = randomBetween(0, Math.PI * 2);
      const speed = randomBetween(MIN_SPEED, MAX_SPEED);
      shards.push({
        x,
        y,
        speedX: Math.cos(direction) * speed,
        speedY: Math.sin(direction) * speed,
        angle: direction,
        spin: randomBetween(-12, 12),
        size: randomBetween(MIN_SHARD_SIZE, MAX_SHARD_SIZE),
        color: colors[i % colors.length],
        age: 0,
        life: randomBetween(MIN_LIFE_SECONDS, MAX_LIFE_SECONDS),
      });
    }
    if (shards.length > MAX_SHARDS) shards = shards.slice(shards.length - MAX_SHARDS);

    addFire(x, y);
    rings.push({ x, y, color: colors[0], age: 0 });
    trauma = Math.min(1, trauma + TRAUMA_PER_BURST);
    burstCount += 1;
    addWeathering(x, y);
    showDamage();

    if (frameId === null) {
      lastFrameTime = null;
      frameId = requestAnimationFrame(frame);
    }
  }

  /** Turning explosions off is the only thing that repairs the damage. */
  function setEnabled(value) {
    enabled = value;
    if (enabled) return;
    burstCount = 0;
    trauma = 0;
    weathering.clearRect(0, 0, window.innerWidth, window.innerHeight);
    showDamage();
    window.dispatchEvent(new Event('damage-repaired'));
  }

  document.body.append(weatheringCanvas, canvas);
  fitToWindow();
  window.addEventListener('resize', fitToWindow);

  return { burst, setEnabled, isBroken, sag, chaos };
})();
