// The constellation sky: one drifting point of light with a soft halo and a faint fading trail (canvas),
// and the person's captured steps as still stars joined by faint lines (stars are DOM, so they can be read and tested).
// The light drifts slowly on a smooth path; it hovers where the next star will land, and during playback it
// travels star to star. prefers-reduced-motion: the light sits still and only fades.

export type Sense = "visual" | "auditory" | "kinesthetic" | "olfactory" | "gustatory" | "other";

export interface StarModel {
  index: number;
  modality: Sense;
  content: string;
  isAnchor: boolean;
}

/** Where the light wants to be. */
export type LightMode =
  | { kind: "drift" } // wide, slow wandering across the sky (opening questions)
  | { kind: "pending" } // hovering where the next star will appear
  | { kind: "star"; index: number } // resting on one star
  | { kind: "constellation" } // a slow loop around the whole constellation
  | { kind: "still" }; // stopped: no motion, dimmed

export interface Sky {
  setStars(stars: StarModel[]): void;
  setMode(mode: LightMode): void;
  /** Brighten one star (playback), or none. */
  setActive(index: number | null): void;
  /** Soft hover highlight (anchor choice preview). */
  setPreview(index: number | null): void;
  /** The anchor star blooms. */
  bloom(index: number): void;
  setDim(dim: boolean): void;
}

const SENSE_WORD: Record<Sense, string> = {
  visual: "picture",
  auditory: "sound",
  kinesthetic: "feeling",
  olfactory: "smell",
  gustatory: "taste",
  other: "",
};

// Gentle vertical zig-zag and horizontal jitter, in px at full spacing, so the stars read as a constellation not a row.
const ZIG = [14, -30, 8, -22, 26, -14, 18];
const JIT = [0, 10, -6, 8, -10, 4, -4];

interface Vec {
  x: number;
  y: number;
}

interface LiveStar {
  model: StarModel;
  el: HTMLElement;
  pos: Vec;
  vel: Vec;
  born: number;
}

const reduce = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createSky(canvas: HTMLCanvasElement, starLayer: HTMLElement): Sky {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  let w = 0;
  let h = 0;
  let dpr = 1;

  let stars: LiveStar[] = [];
  let mode: LightMode = { kind: "drift" };
  let active: number | null = null;
  let preview: number | null = null;
  let dim = false;

  // Light state: a spring-smoothed path centre and amplitude, plus the wandering wave on top.
  const centre: Vec = { x: 0, y: 0 };
  const centreVel: Vec = { x: 0, y: 0 };
  const amp: Vec = { x: 0, y: 0 };
  let brightness = 1;
  const trail: Vec[] = [];
  let light: Vec = { x: 0, y: 0 };
  let started = false;

  function resize(): void {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  /** Vertical centre of the sky band, above the words. */
  const skyY = (): number => Math.max(110, h * (w < 600 ? 0.22 : 0.26));

  /** Where star i sits when there are n stars. Centred, gently zig-zagged. */
  function layout(i: number, n: number): Vec {
    const spacing = Math.min(150, (w - 96) / Math.max(n, 2));
    const s = spacing / 150;
    return {
      x: w / 2 + (i - (n - 1) / 2) * spacing + JIT[i % JIT.length] * s,
      y: skyY() + ZIG[i % ZIG.length] * Math.max(0.55, s),
    };
  }

  function targetFor(): { c: Vec; a: Vec; b: number } {
    const n = stars.length;
    switch (mode.kind) {
      case "drift":
        return { c: { x: w / 2, y: skyY() + 6 }, a: { x: Math.min(w * 0.3, 380), y: Math.min(h * 0.08, 64) }, b: 1 };
      case "pending":
        return { c: layout(n, n + 1), a: { x: 20, y: 13 }, b: 1 };
      case "star": {
        const s = stars[mode.index];
        const c = s ? layout(mode.index, n) : { x: w / 2, y: skyY() };
        return { c, a: { x: 5, y: 4 }, b: 1 };
      }
      case "constellation": {
        const span = n > 1 ? Math.abs(layout(n - 1, n).x - layout(0, n).x) / 2 + 30 : 60;
        return { c: { x: w / 2, y: skyY() - 34 }, a: { x: span, y: 30 }, b: 0.9 };
      }
      case "still":
        return { c: { x: centre.x, y: centre.y }, a: { x: 0, y: 0 }, b: 0.45 };
    }
  }

  function makeStarEl(m: StarModel): HTMLElement {
    const el = document.createElement("div");
    el.className = "star";
    el.setAttribute("data-testid", "step");
    el.setAttribute("role", "listitem");
    const core = document.createElement("span");
    core.className = "star-core";
    const mark = document.createElement("span");
    mark.className = "star-mark";
    const label = document.createElement("span");
    label.className = "star-label";
    el.append(mark, core, label);
    return el;
  }

  function syncStarEl(s: LiveStar): void {
    const m = s.model;
    const el = s.el;
    el.dataset.index = String(m.index);
    el.dataset.modality = m.modality;
    el.dataset.anchor = m.isAnchor ? "true" : "false";
    el.dataset.active = active === m.index ? "true" : "false";
    el.dataset.preview = preview === m.index ? "true" : "false";
    el.title = m.content;
    el.setAttribute("aria-label", `Step ${m.index + 1}${SENSE_WORD[m.modality] ? `, ${SENSE_WORD[m.modality]}` : ""}: ${m.content}${m.isAnchor ? " (anchor)" : ""}`);
    const label = el.querySelector(".star-label") as HTMLElement;
    const word = SENSE_WORD[m.modality];
    label.textContent = m.isAnchor ? (word ? `${word} · anchor` : "anchor") : word;
  }

  function setStars(models: StarModel[]): void {
    const n = models.length;
    const next: LiveStar[] = [];
    for (let i = 0; i < n; i++) {
      const m = models[i];
      let s = stars[i];
      if (!s) {
        const el = makeStarEl(m);
        starLayer.append(el);
        // A new star is born where the light is hovering (when it is near), otherwise at its place.
        const home = layout(i, n);
        const near = started && Math.hypot(light.x - home.x, light.y - home.y) < 90;
        const pos = near ? { ...light } : home;
        s = { model: m, el, pos, vel: { x: 0, y: 0 }, born: performance.now() };
        el.classList.add("born");
      }
      s.model = m;
      syncStarEl(s);
      next.push(s);
    }
    for (let i = n; i < stars.length; i++) stars[i].el.remove();
    stars = next;
    starLayer.dataset.count = String(n);
    if (reduce()) placeAll();
  }

  function placeAll(): void {
    const n = stars.length;
    stars.forEach((s, i) => {
      const p = layout(i, n);
      s.pos = p;
      s.vel = { x: 0, y: 0 };
      s.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    });
  }

  // ── animation ─────────────────────────────────────────────────────────────

  let last = performance.now();
  const t0 = last;

  function spring(pos: Vec, vel: Vec, target: Vec, k: number, dt: number): void {
    vel.x += (k * k * (target.x - pos.x) - 2 * k * vel.x) * dt;
    vel.y += (k * k * (target.y - pos.y) - 2 * k * vel.y) * dt;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
  }

  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    const still = reduce();
    const tgt = targetFor();

    if (!started) {
      centre.x = tgt.c.x;
      centre.y = tgt.c.y;
      amp.x = tgt.a.x;
      amp.y = tgt.a.y;
      started = true;
    }
    if (still) {
      centre.x = tgt.c.x;
      centre.y = tgt.c.y;
      amp.x = 0;
      amp.y = 0;
    } else {
      spring(centre, centreVel, tgt.c, mode.kind === "star" ? 2.2 : 1.25, dt);
      const ka = 1 - Math.exp(-dt * 0.9);
      amp.x += (tgt.a.x - amp.x) * ka;
      amp.y += (tgt.a.y - amp.y) * ka;
    }
    const wantB = (dim ? 0.4 : 1) * tgt.b;
    brightness = still ? wantB : brightness + (wantB - brightness) * (1 - Math.exp(-dt * 1.5));

    // A slow, organic wander: two incommensurate sines per axis.
    const wx = Math.sin(t * 0.21) * 0.72 + Math.sin(t * 0.347 + 1.3) * 0.28;
    const wy = Math.sin(t * 0.29 + 0.6) * 0.62 + Math.sin(t * 0.153 + 2.1) * 0.38;
    light = { x: centre.x + amp.x * wx, y: centre.y + amp.y * wy };

    // Stars glide to their places when the constellation grows.
    const n = stars.length;
    for (let i = 0; i < n; i++) {
      const s = stars[i];
      const p = layout(i, n);
      if (still) {
        s.pos = p;
      } else {
        spring(s.pos, s.vel, p, 1.6, dt);
      }
      s.el.style.transform = `translate(${s.pos.x.toFixed(1)}px, ${s.pos.y.toFixed(1)}px)`;
    }

    draw(now, still);
    requestAnimationFrame(frame);
  }

  function draw(now: number, still: boolean): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Faint lines between consecutive stars, drawn in as each new star is born.
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    for (let i = 1; i < stars.length; i++) {
      const a = stars[i - 1].pos;
      const b = stars[i].pos;
      const grow = still ? 1 : Math.min(1, Math.max(0, (now - stars[i].born - 300) / 1400));
      const ease = 1 - Math.pow(1 - grow, 3);
      const lit = active !== null && (active === i || active === i - 1);
      ctx.strokeStyle = `rgba(214, 226, 255, ${lit ? 0.34 : 0.16})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + (b.x - a.x) * ease, a.y + (b.y - a.y) * ease);
      ctx.stroke();
    }

    // Trail: a short fading wake behind the light.
    if (!still) {
      trail.push({ ...light });
      if (trail.length > 70) trail.shift();
      for (let i = 0; i < trail.length - 1; i++) {
        const p = trail[i];
        const f = i / trail.length;
        ctx.fillStyle = `rgba(225, 233, 255, ${0.11 * f * f * brightness})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.6 + 1.3 * f, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      trail.length = 0;
    }

    // The light: a wide soft halo, a tighter glow, a small bright core.
    const pulse = still ? 1 : 1 + 0.06 * Math.sin(now / 1000 * 1.1);
    const b = brightness;
    const halo = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, 70 * pulse);
    halo.addColorStop(0, `rgba(235, 241, 255, ${0.2 * b})`);
    halo.addColorStop(0.35, `rgba(205, 218, 255, ${0.07 * b})`);
    halo.addColorStop(1, "rgba(205, 218, 255, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(light.x, light.y, 70 * pulse, 0, Math.PI * 2);
    ctx.fill();

    const glow = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, 14);
    glow.addColorStop(0, `rgba(255, 255, 255, ${0.9 * b})`);
    glow.addColorStop(0.4, `rgba(240, 245, 255, ${0.35 * b})`);
    glow.addColorStop(1, "rgba(240, 245, 255, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(light.x, light.y, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, 0.4 + b)})`;
    ctx.beginPath();
    ctx.arc(light.x, light.y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  resize();
  window.addEventListener("resize", () => {
    resize();
    if (reduce()) placeAll();
  });
  requestAnimationFrame(frame);

  return {
    setStars,
    setMode(m) {
      mode = m;
    },
    setActive(i) {
      active = i;
      for (const s of stars) syncStarEl(s);
    },
    setPreview(i) {
      preview = i;
      for (const s of stars) syncStarEl(s);
    },
    bloom(i) {
      const s = stars[i];
      if (!s) return;
      s.el.classList.remove("bloom");
      void s.el.offsetWidth;
      s.el.classList.add("bloom");
    },
    setDim(d) {
      dim = d;
    },
  };
}
