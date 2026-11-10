'use strict';

/*
 * Draws and animates one marble machine on a <canvas>. MarbleModel decides what
 * happens to each marble; this file only plays that journey back.
 */
const Machine = (() => {
  // The drawing uses fixed logical coordinates and is scaled to fit the canvas.
  const WIDTH = 420;
  const HEIGHT = 520;
  const WALL_LEFT = 14;
  const WALL_RIGHT = 406;
  const WALL_THICKNESS = 4;
  const TRAY_FLOOR_GAP = 6;
  const GATE_A_Y = 92;
  const GATE_B_Y = 232;
  const SHUFFLER_TOP = 124;
  const SHUFFLER_BOTTOM = 204;
  const PLATE_HEIGHT = 10;

  // The tray has 100 slots, so the pile can be read directly as a percentage.
  const TRAY_COLUMNS = 20;
  const TRAY_ROWS = 5;
  const CELL = 19;
  const TRAY_LEFT = (WIDTH - TRAY_COLUMNS * CELL) / 2;
  const TRAY_TOP = 404;
  const TRAY_BOTTOM = TRAY_TOP + TRAY_ROWS * CELL;
  // Marbles pile up in the column they fall into, up to just below Gate B, then sort into the tray.
  const MAX_PILE_ROWS = 12;
  const SETTLE_DISTANCE = 36;

  const MARBLE_RADIUS = 6.5;
  const GRAVITY = 1500;
  const MAX_FALL_SPEED = 520;
  const SHUFFLER_SPEED = 230;
  const SETTLE_SECONDS = 0.16;
  const MORPH_SECONDS = 1.2;
  const ORGANIZE_PAUSE_SECONDS = 0.35;
  const ORGANIZE_SECONDS = 0.9;
  const SPAWN_SECONDS = 0.042;
  const MAX_FRAME_SECONDS = 1 / 30;
  const MAX_GATE_DROOP_RADIANS = 0.3;
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp01 = (value) => Math.min(1, Math.max(0, value));
  const lerp = (from, to, amount) => from + (to - from) * amount;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const toX = (position) => WALL_LEFT + (position / 100) * (WALL_RIGHT - WALL_LEFT);

  function readColors() {
    const styles = getComputedStyle(document.documentElement);
    const read = (name) => styles.getPropertyValue(name).trim();
    return {
      ink: read('--ink'),
      paper: read('--machine'),
      a: read('--a'),
      b: read('--b'),
      muted: read('--muted'),
      slot: read('--slot'),
      aText: read('--a-text'),
    };
  }

  function cellCenter(index) {
    const column = index % TRAY_COLUMNS;
    const row = Math.floor(index / TRAY_COLUMNS);
    return {
      x: TRAY_LEFT + column * CELL + CELL / 2,
      y: TRAY_BOTTOM - row * CELL - CELL / 2,
    };
  }

  function cellsFromStats(stats) {
    const { landed, landedA, landedB } = stats;
    return [
      ...Array(landedA).fill('a'),
      ...Array(landedB).fill('b'),
      ...Array(landed - landedA - landedB).fill('both'),
    ].map((tint, index) => ({ tint, filled: true, ...cellCenter(index) }));
  }

  /** The animated parts of a config: Gate B's position, the overlap, and the shuffler. */
  function poseFor(config) {
    const side = config.layout === 'side';
    // Stacked positions only show while stacked, so doors in one wall keep plain centered ones.
    const stacked = MarbleModel.doorsFor({ ...config, layout: 'stack', ...(side ? { overlap: undefined } : {}) });
    return {
      layout: side ? 1 : 0,
      overlap: side ? config.overlap || 0 : 0,
      shuffler: config.shuffler === false ? 0 : 1,
      pB: config.pB,
      stackA: stacked.a.start,
      stackB: stacked.b.start,
    };
  }

  class Machine {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.context = canvas.getContext('2d');
      this.colors = readColors();
      this.config = { labelA: 'A', labelB: 'B', ...config };
      this.pose = poseFor(this.config);
      this.gatesVisible = true;
      this.guess = null;
      this.frameId = null;
      this._clearRun();

      new ResizeObserver(() => this._resize()).observe(canvas);
      window.addEventListener('damage-repaired', () => this.render());
      this._resize();
    }

    /** Replaces the config, dropping any marbles in flight or in the tray. */
    setConfig(config) {
      this.config = { ...this.config, ...config };
      this.pose = poseFor(this.config);
      this.morph = null;
      this.reset();
    }

    reset() {
      this._clearRun();
      this.render();
    }

    setGuess(guess) {
      this.guess = guess;
      this.render();
    }

    setGatesVisible(visible) {
      this.gatesVisible = visible;
      this.render();
    }

    /** Animates to a new config: Gate B slides, the doors overlap, or the shuffler fades. */
    morphTo(changes, onDone) {
      this.config = { ...this.config, ...changes };
      this._clearRun();
      const target = poseFor(this.config);

      if (prefersReducedMotion()) {
        this.pose = target;
        this.render();
        if (onDone) onDone();
        return;
      }
      this.morph = { from: { ...this.pose }, to: target, elapsed: 0, onDone };
      this._wake();
    }

    /** Returns false if the doors don't fit, since no marble can be dropped then. */
    run(total, { onProgress, onDone } = {}) {
      if (!MarbleModel.fits(this.config)) return false;
      this._clearRun();
      this.stats = MarbleModel.emptyStats(total);
      this.onProgress = onProgress;
      this.onDone = onDone;

      if (prefersReducedMotion()) {
        this.stats = MarbleModel.simulate(this.config, total);
        this._finishRun();
        return true;
      }

      this.running = true;
      const plan = MarbleModel.scrambleRoutes(
        MarbleModel.planRun(this.config, total),
        this.config.layout,
        Explosions.chaos(),
      );
      this.plan = plan;
      this._wake();
      return true;
    }

    _clearRun() {
      this.running = false;
      this.marbles = [];
      this.cells = [];
      this.columnHeights = Array(TRAY_COLUMNS).fill(0);
      this.organizing = null;
      this.moves = [];
      this.stats = null;
      this.spawnClock = 0;
      this.onProgress = null;
      this.onDone = null;
    }

    _finishRun() {
      this.running = false;
      this.organizing = null;
      this.moves = [];
      this.cells = cellsFromStats(this.stats);
      this.render();
      if (this.onProgress) this.onProgress(this.stats);
      if (this.onDone) this.onDone(this.stats);
    }

    _resize() {
      const { width } = this.canvas.getBoundingClientRect();
      if (!width) return;
      const pixelRatio = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(width * pixelRatio);
      this.canvas.height = Math.round(width * (HEIGHT / WIDTH) * pixelRatio);
      this.scale = this.canvas.width / WIDTH;
      this.render();
    }

    _wake() {
      if (this.frameId !== null) return;
      this.lastFrameTime = null;
      this.frameId = requestAnimationFrame((time) => this._frame(time));
    }

    _frame(time) {
      this.frameId = null;
      const elapsed = this.lastFrameTime === null ? 0 : (time - this.lastFrameTime) / 1000;
      this.lastFrameTime = time;
      const dt = Math.min(elapsed, MAX_FRAME_SECONDS);

      this._updateMorph(dt);
      if (this.running) this._updateRun(dt);
      this.render();

      if (this.morph || this.running) {
        this.frameId = requestAnimationFrame((next) => this._frame(next));
      }
    }

    _updateMorph(dt) {
      if (!this.morph) return;
      const morph = this.morph;
      morph.elapsed += dt;
      const progress = clamp01(morph.elapsed / MORPH_SECONDS);
      Object.keys(morph.to).forEach((key) => {
        this.pose[key] = lerp(morph.from[key], morph.to[key], easeInOut(progress));
      });
      if (progress === 1) {
        this.morph = null;
        if (morph.onDone) morph.onDone();
      }
    }

    _updateRun(dt) {
      if (this.organizing) {
        this._updateOrganizing(dt);
        return;
      }

      this.spawnClock += dt;
      while (this.stats.dropped < this.stats.total && this.spawnClock >= SPAWN_SECONDS) {
        this.spawnClock -= SPAWN_SECONDS;
        this._spawnMarble();
      }

      this.marbles.forEach((marble) => this._updateMarble(marble, dt));
      this.marbles = this.marbles.filter((marble) => !marble.done);
      if (this.onProgress) this.onProgress(this.stats);

      if (this.stats.dropped === this.stats.total && this.marbles.length === 0) this._startOrganizing();
    }

    /** Once every marble has landed, they slide from where they fell into groups. */
    _startOrganizing() {
      const targets = cellsFromStats(this.stats);
      const key = (cell) => cell.tint;
      const leftToRight = (p, q) => p.x - q.x || q.y - p.y;
      const groupBy = (cells) => cells.reduce((groups, cell) => {
        (groups[key(cell)] ||= []).push(cell);
        return groups;
      }, {});

      // Pairing each group left to right keeps marbles from crossing over one another.
      const landed = groupBy(this.cells);
      this.moves = [];
      Object.entries(groupBy(targets)).forEach(([group, destinations]) => {
        const sources = (landed[group] || []).sort(leftToRight);
        [...destinations].sort(leftToRight).forEach((target, index) => {
          const source = sources[index] || target;
          this.moves.push({
            cell: { ...target, x: source.x, y: source.y },
            fromX: source.x,
            fromY: source.y,
            toX: target.x,
            toY: target.y,
          });
        });
      });
      this.cells = this.moves.map((move) => move.cell);
      this.organizing = { elapsed: -ORGANIZE_PAUSE_SECONDS };
    }

    _updateOrganizing(dt) {
      this.organizing.elapsed += dt;
      const amount = easeInOut(clamp01(this.organizing.elapsed / ORGANIZE_SECONDS));
      this.moves.forEach((move) => {
        move.cell.x = lerp(move.fromX, move.toX, amount);
        move.cell.y = lerp(move.fromY, move.toY, amount);
      });
      if (amount === 1) this._finishRun();
    }

    /**
     * Where a marble falling at x lands: on top of the pile below it, or on the next pile
     * over if that one is as high as it can go. Pass reserve to claim the spot.
     */
    _landingSlot(x, reserve = false) {
      const below = Math.round((x - TRAY_LEFT - CELL / 2) / CELL);
      const column = Math.min(TRAY_COLUMNS - 1, Math.max(0, below));
      for (let distance = 0; distance < TRAY_COLUMNS; distance += 1) {
        const chosen = [column - distance, column + distance]
          .find((c) => c >= 0 && c < TRAY_COLUMNS && this.columnHeights[c] < MAX_PILE_ROWS);
        if (chosen !== undefined) {
          const row = this.columnHeights[chosen];
          if (reserve) this.columnHeights[chosen] += 1;
          return { x: TRAY_LEFT + chosen * CELL + CELL / 2, y: TRAY_BOTTOM - row * CELL - CELL / 2 };
        }
      }
      return cellCenter(this.cells.length);
    }

    _spawnMarble() {
      const route = this.plan[this.stats.dropped];
      this.stats.dropped += 1;
      this.marbles.push({
        route,
        x: toX(route.entry),
        y: -MARBLE_RADIUS - Math.random() * 16,
        fallSpeed: 80,
        driftSpeed: 0,
        tint: null,
        phase: 'falling',
        alpha: 1,
        passedFirstGate: false,
      });
    }

    _updateMarble(marble, dt) {
      if (marble.phase === 'bouncing') {
        marble.fallSpeed += GRAVITY * dt;
        marble.y += marble.fallSpeed * dt;
        marble.x += marble.driftSpeed * dt;
        marble.alpha -= dt * 3.4;
        if (marble.alpha <= 0) marble.done = true;
        return;
      }

      if (marble.phase === 'settling') {
        marble.settleTime += dt / SETTLE_SECONDS;
        const amount = easeInOut(clamp01(marble.settleTime));
        marble.x = lerp(marble.fromX, marble.toX, amount);
        marble.y = lerp(marble.fromY, marble.toY, amount);
        if (marble.settleTime >= 1) {
          marble.cell.filled = true;
          marble.done = true;
          this._explode(marble);
        }
        return;
      }

      this._updateFalling(marble, dt);
    }

    _explode(marble) {
      const { left, top, width } = this.canvas.getBoundingClientRect();
      const pageScale = width / WIDTH;
      const palettes = {
        a: [this.colors.a],
        b: [this.colors.b],
        both: [this.colors.a, this.colors.b],
      };
      Explosions.burst(left + marble.x * pageScale, top + marble.y * pageScale, palettes[marble.cell.tint]);
    }

    _updateFalling(marble, dt) {
      const stacked = this.config.layout !== 'side';
      const { route } = marble;
      const inShuffler = stacked && this.config.shuffler !== false
        && marble.y > SHUFFLER_TOP && marble.y < SHUFFLER_BOTTOM;

      const speedLimit = inShuffler ? SHUFFLER_SPEED : MAX_FALL_SPEED;
      marble.fallSpeed = Math.min(speedLimit, marble.fallSpeed + GRAVITY * dt);
      const previousY = marble.y;
      marble.y += marble.fallSpeed * dt;

      if (!marble.passedFirstGate && marble.y >= GATE_A_Y) {
        marble.passedFirstGate = true;
        if (route.outcome === 'stoppedA' || route.outcome === 'missed') {
          MarbleModel.recordStop(this.stats, route.outcome);
          this._bounce(marble, GATE_A_Y);
          return;
        } else if (route.outcome === 'b') {
          marble.tint = 'b';
        } else {
          // Side-by-side doors only pass a marble through both where they overlap.
          marble.tint = route.outcome === 'both' && !stacked ? 'both' : 'a';
        }
      }

      if (inShuffler) {
        // Wander on the way to the new position, so the marble visibly "forgets" where it was.
        const progress = clamp01((marble.y - SHUFFLER_TOP) / (SHUFFLER_BOTTOM - SHUFFLER_TOP));
        const wander = Math.sin(progress * Math.PI * 4) * 12 * (1 - progress);
        marble.x = lerp(toX(route.entry), toX(route.exit), easeInOut(progress)) + wander;
      } else if (stacked && marble.y >= SHUFFLER_BOTTOM) {
        marble.x = toX(route.exit);
      }

      if (stacked && previousY < GATE_B_Y && marble.y >= GATE_B_Y) {
        if (route.outcome === 'stoppedB') {
          MarbleModel.recordStop(this.stats, route.outcome);
          this._bounce(marble, GATE_B_Y);
          return;
        }
        marble.tint = 'both';
      }

      if (route.outcome === 'lost') {
        if (marble.y > HEIGHT + MARBLE_RADIUS) {
          MarbleModel.recordStop(this.stats, route.outcome);
          marble.done = true;
        }
        return;
      }

      if (marble.y >= this._landingSlot(marble.x).y - SETTLE_DISTANCE) this._startSettling(marble);
    }

    /** A stopped marble keeps its color as it fades out. */
    _bounce(marble, gateY) {
      marble.phase = 'bouncing';
      marble.y = gateY - MARBLE_RADIUS - PLATE_HEIGHT / 2;
      marble.fallSpeed = -170 - Math.random() * 90;
      marble.driftSpeed = (Math.random() - 0.5) * 170;
    }

    _startSettling(marble) {
      MarbleModel.recordLanding(this.stats, marble.route.outcome);
      const target = this._landingSlot(marble.x, true);
      const cell = { tint: marble.tint, filled: false, ...target };
      this.cells.push(cell);

      marble.phase = 'settling';
      marble.settleTime = 0;
      marble.fromX = marble.x;
      marble.fromY = marble.y;
      marble.cell = cell;
      marble.toX = target.x;
      marble.toY = target.y;
    }

    /* ---------- Drawing ---------- */

    render() {
      const ctx = this.context;
      if (!this.scale) return;
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = this.colors.paper;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      this._drawWalls();
      this._drawTray();
      if (this.gatesVisible) {
        this._drawShuffler();
        this.marbles.forEach((marble) => this._drawMarble(marble.x, marble.y, marble.tint, marble.alpha));

        // Damage pulls the gates loose, so they droop from the left wall.
        ctx.save();
        ctx.translate(WALL_LEFT, GATE_A_Y);
        ctx.rotate(Explosions.sag() * MAX_GATE_DROOP_RADIANS);
        ctx.translate(-WALL_LEFT, -GATE_A_Y);
        this._drawGates();
        ctx.restore();
      } else {
        this._drawHiddenGates();
      }
    }

    _drawWalls() {
      const ctx = this.context;
      // One continuous outline: the side walls run down into the tray's floor.
      const floorY = TRAY_BOTTOM + TRAY_FLOOR_GAP;
      ctx.fillStyle = this.colors.ink;
      ctx.fillRect(WALL_LEFT - WALL_THICKNESS, 0, WALL_THICKNESS, floorY + WALL_THICKNESS);
      ctx.fillRect(WALL_RIGHT, 0, WALL_THICKNESS, floorY + WALL_THICKNESS);
      ctx.fillRect(WALL_LEFT, floorY, WALL_RIGHT - WALL_LEFT, WALL_THICKNESS);
    }

    _drawTray() {
      const ctx = this.context;
      for (let i = 0; i < TRAY_COLUMNS * TRAY_ROWS; i += 1) {
        const { x, y } = cellCenter(i);
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = this.colors.slot;
        ctx.fill();
      }
      this.cells.forEach((cell) => {
        if (cell.filled) this._drawMarble(cell.x, cell.y, cell.tint, 1);
      });

      if (this.guess > 0) {
        const { x, y } = cellCenter(this.guess - 1);
        this._drawGuessMarker(x, y);
      }
    }

    _drawGuessMarker(x, y) {
      const ctx = this.context;
      const reach = MARBLE_RADIUS + 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y - reach);
      ctx.lineTo(x + reach, y);
      ctx.lineTo(x, y + reach);
      ctx.lineTo(x - reach, y);
      ctx.closePath();
      ctx.strokeStyle = this.colors.ink;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    _drawMarble(x, y, tint, alpha) {
      const ctx = this.context;
      ctx.globalAlpha = Math.max(0, alpha);
      if (tint === 'both') {
        // Two colors on one marble: it has been through A and through B.
        ctx.beginPath();
        ctx.arc(x, y, MARBLE_RADIUS, Math.PI / 2, -Math.PI / 2);
        ctx.fillStyle = this.colors.a;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, MARBLE_RADIUS, -Math.PI / 2, Math.PI / 2);
        ctx.fillStyle = this.colors.b;
        ctx.fill();
      } else {
        const fills = { a: this.colors.a, b: this.colors.b };
        ctx.beginPath();
        ctx.arc(x, y, MARBLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = fills[tint] || this.colors.ink;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    _drawShuffler() {
      const ctx = this.context;
      const visibility = this.pose.shuffler * (1 - clamp01(this.pose.layout / 0.45));
      if (visibility === 0) return;

      ctx.globalAlpha = visibility;
      ctx.fillStyle = this.colors.muted;
      const rows = 4;
      const columns = 13;
      for (let row = 0; row < rows; row += 1) {
        const y = lerp(SHUFFLER_TOP + 8, SHUFFLER_BOTTOM - 8, row / (rows - 1));
        const offset = row % 2 === 0 ? 0 : 14;
        for (let column = 0; column < columns; column += 1) {
          ctx.beginPath();
          ctx.arc(WALL_LEFT + 14 + offset + column * 28, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.globalAlpha = visibility;
      const label = 'Shuffler';
      ctx.font = `600 13px ${FONT}`;
      const labelWidth = ctx.measureText(label).width + 14;
      const labelY = (SHUFFLER_TOP + SHUFFLER_BOTTOM) / 2;
      ctx.fillStyle = this.colors.paper;
      ctx.fillRect(WIDTH / 2 - labelWidth / 2, labelY - 8, labelWidth, 16);
      ctx.fillStyle = this.colors.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, WIDTH / 2, labelY);
      ctx.globalAlpha = 1;
    }

    _drawGates() {
      const ctx = this.context;
      const progress = this.pose.layout;

      // Gate B rises first, then the doors slide together as the upper wall opens.
      const rise = easeInOut(clamp01(progress / 0.6));
      const slide = easeInOut(clamp01((progress - 0.5) / 0.5));

      const { pA } = this.config;
      const { pB, stackA, stackB, overlap } = this.pose;
      const stacked = {
        a: { start: stackA, end: stackA + pA },
        b: { start: stackB, end: stackB + pB },
      };
      const side = MarbleModel.doorsFor({ ...this.config, pB, layout: 'side', overlap });
      const doorA = {
        start: lerp(stacked.a.start, side.a.start, slide),
        end: lerp(stacked.a.end, side.a.end, slide),
      };
      const doorB = {
        start: lerp(stacked.b.start, side.b.start, slide),
        end: lerp(stacked.b.end, side.b.end, slide),
      };
      const gateBY = lerp(GATE_B_Y, GATE_A_Y, rise);
      const sameRow = rise === 1;
      const shared = { start: Math.max(doorA.start, doorB.start), end: Math.min(doorA.end, doorB.end) };

      ctx.save();
      ctx.beginPath();
      ctx.rect(WALL_LEFT, 0, WALL_RIGHT - WALL_LEFT, HEIGHT);
      ctx.clip();

      // Gate B's plate fades out on the way up, so it never smears over Gate A's door.
      const plateBVisibility = 1 - clamp01(progress / 0.35);
      if (plateBVisibility > 0) {
        ctx.globalAlpha = plateBVisibility;
        this._drawPlate(doorB, gateBY);
        ctx.globalAlpha = 1;
      }
      this._drawPlate({ start: doorA.start, end: lerp(doorA.end, side.b.end, slide) }, GATE_A_Y);
      this._drawDoor(doorA, GATE_A_Y, this.colors.a);
      this._drawDoor(doorB, gateBY, this.colors.b);
      // Where the doors overlap, the top edge shows both colors.
      if (sameRow && shared.end > shared.start) {
        ctx.fillStyle = this.colors.a;
        ctx.fillRect(toX(shared.start), GATE_A_Y - PLATE_HEIGHT / 2 - 3, toX(shared.end) - toX(shared.start), 1.5);
      }
      ctx.restore();

      this._drawDoorLabels(doorA, doorB, gateBY);
      if (sameRow && this.pose.overlap >= 0.5) this._drawOverlapLabel(shared);
      // Without the shuffler, the part of Gate B under Gate A's door gives the chance of B after A.
      const linedUp = 1 - this.pose.shuffler;
      if (progress === 0 && linedUp > 0 && shared.end > shared.start) this._drawLinedUp(doorA, doorB, shared, gateBY, linedUp);
      if (progress === 1 && !MarbleModel.fits(this.config)) this._drawJam();
    }

    _drawPlate(opening, y) {
      const ctx = this.context;
      ctx.fillStyle = this.colors.ink;
      const top = y - PLATE_HEIGHT / 2;
      ctx.fillRect(WALL_LEFT, top, toX(opening.start) - WALL_LEFT, PLATE_HEIGHT);
      ctx.fillRect(toX(opening.end), top, WALL_RIGHT - toX(opening.end), PLATE_HEIGHT);
    }

    _drawDoor(door, y, color) {
      const ctx = this.context;
      const left = toX(door.start);
      const width = toX(door.end) - left;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = color;
      ctx.fillRect(left, y - PLATE_HEIGHT / 2, width, PLATE_HEIGHT);
      ctx.globalAlpha = 1;
      ctx.fillRect(left, y - PLATE_HEIGHT / 2 - 3, width, 3);
    }

    _drawDoorLabels(doorA, doorB, gateBY) {
      const ctx = this.context;
      const { pA, labelA, labelB } = this.config;
      const { pB } = this.pose;
      ctx.font = `600 14px ${FONT}`;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'center';

      const textA = `${labelA} ${formatPercent(pA)}`;
      const textB = `${labelB} ${formatPercent(pB)}`;
      const halfWidthA = ctx.measureText(textA).width / 2;
      const halfWidthB = ctx.measureText(textB).width / 2;
      const clampX = (x, half) => Math.min(WALL_RIGHT - half - 4, Math.max(WALL_LEFT + half + 4, x));

      let xA = clampX((toX(doorA.start) + toX(doorA.end)) / 2, halfWidthA);
      let xB = clampX((toX(doorB.start) + toX(doorB.end)) / 2, halfWidthB);

      // Narrow doors on the same row would have overlapping labels, so push them apart.
      const sameRow = Math.abs(gateBY - GATE_A_Y) < 24;
      const overlap = halfWidthA + halfWidthB + 10 - (xB - xA);
      if (sameRow && overlap > 0) {
        xA = clampX(xA - overlap / 2, halfWidthA);
        xB = clampX(xA + halfWidthA + halfWidthB + 10, halfWidthB);
        xA = clampX(xB - halfWidthA - halfWidthB - 10, halfWidthA);
      }

      const labelGap = PLATE_HEIGHT / 2 + 9;
      ctx.fillStyle = this.colors.aText;
      ctx.fillText(textA, xA, GATE_A_Y - labelGap);
      ctx.fillStyle = this.colors.b;
      ctx.fillText(textB, xB, gateBY - labelGap);
    }

    _drawOverlapLabel(shared) {
      const ctx = this.context;
      ctx.fillStyle = this.colors.ink;
      ctx.font = `600 13px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const x = toX((shared.start + shared.end) / 2);
      ctx.fillText(`Both ${formatPercent(this.pose.overlap)}`, x, GATE_A_Y + PLATE_HEIGHT / 2 + 6);
    }

    /**
     * Marbles that pass Gate A fall straight down under its door. Dashed lines run down
     * from Gate A's door edges and up from Gate B's, so the stretch inside both is where
     * they line up. That stretch is labeled with its share of Gate A's door: P(B | A).
     */
    _drawLinedUp(doorA, doorB, shared, gateBY, alpha) {
      const ctx = this.context;
      const { pA, labelA, labelB } = this.config;
      const top = GATE_A_Y + PLATE_HEIGHT / 2;
      const bottom = gateBY - PLATE_HEIGHT / 2 - 3;
      const sharedLeft = toX(shared.start);
      const sharedRight = toX(shared.end);

      ctx.globalAlpha = alpha * 0.8;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      [[doorA, this.colors.a], [doorB, this.colors.b]].forEach(([door, color]) => {
        ctx.strokeStyle = color;
        ctx.beginPath();
        [door.start, door.end].forEach((position) => {
          ctx.moveTo(toX(position), top);
          ctx.lineTo(toX(position), bottom);
        });
        ctx.stroke();
      });
      ctx.setLineDash([]);

      const middle = (top + bottom) / 2;
      const x = (sharedLeft + sharedRight) / 2;
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.colors.muted;
      ctx.font = `500 12px ${FONT}`;
      ctx.fillText(`P(${labelB} | ${labelA})`, x, middle - 10);
      ctx.fillStyle = this.colors.ink;
      ctx.font = `700 18px ${FONT}`;
      ctx.fillText(formatPercent(((shared.end - shared.start) / pA) * 100), x, middle + 9);
      ctx.globalAlpha = 1;
    }

    _drawJam() {
      const ctx = this.context;
      const { pA, pB } = this.config;
      ctx.fillStyle = this.colors.aText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 24px ${FONT}`;
      ctx.fillText('Doors don’t fit', WIDTH / 2, 190);
      ctx.font = `400 15px ${FONT}`;
      ctx.fillText(`${formatPercent(pA + pB)} of a 100% wall`, WIDTH / 2, 222);
    }

    _drawHiddenGates() {
      const ctx = this.context;
      ctx.fillStyle = this.colors.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `400 15px ${FONT}`;
      ctx.fillText('The gates appear after you answer.', WIDTH / 2, 190);
    }
  }

  function formatPercent(value) {
    return `${Math.round(value)}%`;
  }

  return Machine;
})();
