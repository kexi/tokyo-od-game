// The teaser's virtual clock, injected into the page before its own scripts (as source text, so
// it must not close over anything). Loading runs on the real clock; `window.__clock.start()` then
// freezes time for the page: performance.now, Date.now, requestAnimationFrame, the timers and the
// CSS animations only move when the teaser calls `window.__clock.frame(ms)`. Every frame of the
// movie is then exactly 1/30 s of game, however long the machine takes to draw it.
//
// Why not the game's own `advance(dt)`: its step takes dt from performance.now() (the real time
// spent drawing, capped at 50 ms), and the game's rAF loop keeps running between the calls, so on
// a busy machine the movie ran fast and jerky. Why not CDP's virtual time
// (Emulation.setVirtualTimePolicy): it does not hold rAF in the new headless mode.
export function installClock() {
  const realNow = performance.now.bind(performance);
  const realDateNow = Date.now.bind(Date);
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCaf = window.cancelAnimationFrame.bind(window);
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window);
  const realClearInterval = window.clearInterval.bind(window);
  let isVirtual = false;
  let now = 0;
  let dateAtStart = 0;
  let nowAtStart = 0;
  // Ids far above the browser's own, so clear*() can tell the virtual ones apart.
  let nextId = 1e9;
  const frames = new Map();
  const timers = new Map();

  performance.now = () => (isVirtual ? now : realNow());
  Date.now = () => (isVirtual ? dateAtStart + (now - nowAtStart) : realDateNow());
  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    if (isVirtual) {
      frames.set(id, cb);
      return id;
    }
    // Asked for on the real clock but switched over before it ran: it waits for the next frame.
    const real = realRaf((ts) => {
      if (!frames.has(id)) return;
      if (isVirtual) return frames.set(id, cb);
      frames.delete(id);
      cb(ts);
    });
    frames.set(id, { real });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    const entry = frames.get(id);
    frames.delete(id);
    if (entry && entry.real !== undefined) realCaf(entry.real);
  };
  const addTimer = (cb, ms, args, every) => {
    const id = nextId++;
    timers.set(id, { due: now + Math.max(0, Number(ms) || 0), cb, args, every });
    return id;
  };
  window.setTimeout = (cb, ms, ...args) =>
    isVirtual && typeof cb === "function" ? addTimer(cb, ms, args, 0) : realSetTimeout(cb, ms, ...args);
  window.setInterval = (cb, ms, ...args) =>
    isVirtual && typeof cb === "function"
      ? addTimer(cb, ms, args, Math.max(1, Number(ms) || 0))
      : realSetInterval(cb, ms, ...args);
  window.clearTimeout = (id) => (timers.delete(id) ? undefined : realClearTimeout(id));
  window.clearInterval = (id) => (timers.delete(id) ? undefined : realClearInterval(id));

  /** CSS animations and transitions, held and moved by hand (each with its own time). */
  const animationTimes = new WeakMap();
  const stepAnimations = (ms) => {
    for (const a of document.getAnimations()) {
      // New since the last frame: from its start (it may have run a little on the real clock).
      const time = animationTimes.has(a) ? animationTimes.get(a) + ms : 0;
      animationTimes.set(a, time);
      a.pause();
      a.currentTime = time;
    }
  };

  window.__clock = {
    start() {
      if (isVirtual) return;
      now = realNow();
      nowAtStart = now;
      dateAtStart = realDateNow();
      isVirtual = true;
    },
    get virtual() {
      return isVirtual;
    },
    /** One frame: time moves by `ms`, due timers fire, then the animation frame callbacks run. */
    frame(ms) {
      now += ms;
      for (let pass = 0; pass < 8; pass++) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.due <= now)
          .toSorted((a, b) => a[1].due - b[1].due);
        if (due.length === 0) break;
        for (const [id, t] of due) {
          if (!timers.has(id)) continue;
          if (t.every) t.due += t.every * Math.max(1, Math.ceil((now - t.due) / t.every));
          else timers.delete(id);
          try {
            t.cb(...t.args);
          } catch (error) {
            console.error(error);
          }
        }
      }
      stepAnimations(ms);
      const ready = [...frames.entries()].filter(([, cb]) => typeof cb === "function");
      for (const [id] of ready) frames.delete(id);
      for (const [, cb] of ready) {
        try {
          cb(now);
        } catch (error) {
          console.error(error);
        }
      }
    },
  };
}
