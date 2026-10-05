// The teaser's staging in the page (window.__tz), injected as source text once the game is up, so
// it must not close over anything. The Node side (teaser.mjs) says what happens in each shot; this
// runs it frame by frame on the virtual clock (clock.mjs):
//
// - frame(t, len): the per-frame hooks (camera, captions, zoom, cruise control), then one game frame;
// - camera(fn): a scripted camera (null: the game's own) — fn(cam, ctx) places it for shot time t;
// - seat(yaw, pitch, fov): the driver's eye as the game placed it, carried by the car, turned a bit;
// - hud(mode): which of the game's panels show;
// - caption / title / zoom: the movie's own layer over the game (captions, the title, a camera
//   push-in on the phone or the ticket).
//
// Why a popover for that layer: the ticket and 設定 are modal dialogs in the top layer, which would
// cover anything in the page; a popover is in the top layer too and is raised above them.
//
// `cards`: the title and end cards' words (the Japanese teaser's by default). A null `badge` or `tag`
// takes the game's own from its title screen (data-i18n title.badge / title.tagline, already in the
// page's language); `credits` adds a line of data credits under the end card's URL; `captionBand`
// lays a soft shade behind the captions.
export function stage(cards = {}) {
  const G = window.__game;
  const V3 = G.camera.position.constructor;
  const Quat = G.camera.quaternion.constructor;
  const Euler = G.camera.rotation.constructor;
  const smooth = (k) => {
    const x = Math.min(1, Math.max(0, k));
    return x * x * (3 - 2 * x);
  };
  const tz = { t: 0, len: 1, hooks: new Map(), cam: null };

  // ---- the movie's layer ----
  const FONT = '"Hiragino Sans","Noto Sans JP",system-ui,sans-serif';
  document.head.insertAdjacentHTML(
    "beforeend",
    `<style id="tz-style">
      #tz-layer { position: fixed; inset: 0; width: 100vw; height: 100vh; margin: 0; padding: 0; border: 0;
        background: transparent; overflow: visible; pointer-events: none; color: #fff; font-family: ${FONT}; }
      #tz-cap { position: absolute; left: 64px; bottom: 60px; max-width: 1100px;
        text-shadow: 0 2px 14px rgba(0,0,0,.7), 0 0 4px rgba(0,0,0,.55); }
      #tz-cap .m { font-size: 40px; font-weight: 800; letter-spacing: .03em; line-height: 1.25; }
      #tz-cap .s { font-size: 22px; font-weight: 600; opacity: .92; margin-top: 8px; letter-spacing: .02em; }
      #tz-title, #tz-end { position: absolute; inset: 0; }
      .tz-band { position: absolute; left: 0; right: 0; bottom: 0; height: 46%;
        background: linear-gradient(to top, rgba(3,7,14,.62), rgba(3,7,14,.32) 55%, rgba(3,7,14,0)); }
      .tz-card { position: absolute; left: 0; right: 0; bottom: 70px; text-align: center;
        text-shadow: 0 2px 16px rgba(0,0,0,.6); }
      .tz-logo { display: inline-flex; align-items: center; gap: 22px; font-size: 64px; font-weight: 800;
        letter-spacing: .04em; line-height: 1; }
      .tz-logo .badge { font-size: 30px; letter-spacing: .3em; padding: 10px 6px 10px 18px; color: #12306b;
        background: #fff; border: 4px solid #d8282f; border-radius: 8px; text-shadow: none; }
      .tz-logo .open { color: #ffd23c; }
      .tz-tag { font-size: 26px; font-weight: 600; margin-top: 18px; opacity: .95; }
      .tz-url { display: inline-block; margin-top: 16px; font-size: 34px; font-weight: 700; letter-spacing: .02em;
        padding: 8px 26px; border-radius: 999px; background: rgba(255,255,255,.14);
        border: 1px solid rgba(255,255,255,.35); }
      .tz-logo.small { font-size: 44px; gap: 16px; }
      .tz-logo.small .badge { font-size: 22px; padding: 7px 4px 7px 13px; border-width: 3px; }
      .tz-logo.latin .badge { letter-spacing: .12em; padding-left: 12px; padding-right: 6px; }
      #tz-layer.band #tz-cap::before { content: ""; position: absolute; z-index: -1; left: -64px; right: -160px; top: -40px;
        bottom: -60px; background: radial-gradient(ellipse 75% 100% at 28% 100%, rgba(3,7,14,.6), rgba(3,7,14,.32) 55%, rgba(3,7,14,0) 100%); }
      .tz-credits { margin-top: 18px; font-size: 17px; font-weight: 600; opacity: .85; letter-spacing: .01em; }
    </style>`,
  );
  const fromTitle = (key) => document.querySelector(`[data-i18n="${key}"]`)?.textContent.trim() ?? "";
  const words = {
    badge: "法令厳守",
    tag: "東京都オープンデータ × PLATEAU 3D 都市モデルで 23 区を走る",
    endTag: "ブラウザでそのまま遊べます",
    url: "https://kexi.github.io/tokyo-od-game/",
    credits: "",
    ...cards,
  };
  words.badge ??= fromTitle("title.badge");
  words.tag ??= fromTitle("title.tagline");
  // The badge's letters spaced as the title screen spaces them (wide for 法令厳守, narrower for Latin).
  const isLatin = /^[\x20-\x7e]+$/.test(words.badge);
  const layer = document.createElement("div");
  layer.id = "tz-layer";
  layer.popover = "manual";
  // A soft shade behind the captions (the English cut's longer lines over busy pictures).
  if (words.captionBand) layer.classList.add("band");
  const logo = (cls = "") =>
    `<div class="tz-logo ${cls} ${isLatin ? "latin" : ""}"><span class="badge"></span><span>TOKYO <span class="open">OPEN</span> DRIVE</span></div>`;
  layer.innerHTML = `
    <div id="tz-title" style="opacity:0"><div class="tz-band"></div><div class="tz-card">${logo()}
      <div class="tz-tag" data-w="tag"></div></div></div>
    <div id="tz-end" style="opacity:0"><div class="tz-band"></div><div class="tz-card">${logo("small")}
      <div class="tz-tag" data-w="endTag"></div>
      <div class="tz-url" data-w="url"></div>${words.credits ? '<div class="tz-credits" data-w="credits"></div>' : ""}</div></div>
    <div id="tz-cap" style="opacity:0"><div class="m"></div><div class="s"></div></div>`;
  for (const el of layer.querySelectorAll(".badge")) el.textContent = words.badge;
  for (const el of layer.querySelectorAll("[data-w]")) el.textContent = words[el.dataset.w];
  document.documentElement.append(layer);
  layer.showPopover();
  /** Back on top of a dialog opened since (the top layer stacks in the order things were shown). */
  tz.raise = () => {
    layer.hidePopover();
    layer.showPopover();
  };

  /**
   * A fade (and a short slide) in at `at` and out at `out` seconds of shot time; `at` null: already
   * up when the shot starts (a caption carried over a cut), `out` null: stays.
   */
  const fader =
    (el, { at = 0, out = null, slide = 0, rise = 0 }) =>
    (t) => {
      const k = at === null ? 1 : smooth((t - at) / 0.45);
      const o = out === null ? 1 : 1 - smooth((t - out) / 0.45);
      el.style.opacity = String(Math.min(k, o));
      el.style.translate = `${(1 - k) * -slide}px ${(1 - k) * rise}px`;
    };
  tz.caption = (main, sub = "", timing = {}) => {
    const el = document.getElementById("tz-cap");
    el.querySelector(".m").textContent = main ?? "";
    el.querySelector(".s").textContent = sub;
    el.style.opacity = "0";
    if (main) tz.hooks.set("caption", fader(el, { slide: 28, ...timing }));
    else tz.hooks.delete("caption");
  };
  tz.card = (id, timing) => {
    for (const other of ["tz-title", "tz-end"]) document.getElementById(other).style.opacity = "0";
    if (!id) return tz.hooks.delete("card");
    tz.hooks.set("card", fader(document.getElementById(id), { rise: 18, ...timing }));
  };

  // ---- the game's own panels ----
  const HUD = {
    // Nothing of the HUD (the data credits stay).
    none: "#hud > :not(#attribution) { visibility: hidden !important; }",
    // Driving: the location, the navi, the small map, the licence and speed; not the key bar.
    drive:
      "#hud-toolbar, #hud-time, #hud-score, #hud-mission, #phone-button, #toasts, #notice-log, #talk-hint, #autopilot-chip { visibility: hidden !important; }",
    // As drive, with the toasts (what the game says happened).
    talk: "#hud-toolbar, #hud-time, #hud-score, #hud-mission, #phone-button, #notice-log, #talk-hint, #autopilot-chip { visibility: hidden !important; }",
    // As talk, with the notices (the violation named, who saw it).
    law: "#hud-toolbar, #hud-time, #hud-score, #hud-mission, #phone-button, #talk-hint, #autopilot-chip { visibility: hidden !important; }",
    // Seen from outside the car (the chase view): as drive, without the speedometer and the lamps
    // the chase view puts at the lower left, under the captions.
    outside:
      "#hud-toolbar, #hud-time, #hud-score, #hud-mission, #phone-button, #toasts, #notice-log, #talk-hint, #autopilot-chip, #hud-speed, #car-status { visibility: hidden !important; }",
    // As outside, with the autopilot's chip.
    auto: "#hud-toolbar, #hud-time, #hud-score, #hud-mission, #phone-button, #toasts, #notice-log, #talk-hint, #hud-speed, #car-status { visibility: hidden !important; }",
    // A pursuit from outside: the chip, the notices and the police radio, not the how-to-stop guide.
    pursuit:
      "#hud-toolbar, #hud-time, #hud-score, #hud-mission, #phone-button, #talk-hint, #autopilot-chip, #hud-speed, #car-status, #stop-guide { visibility: hidden !important; }",
    // On foot: the hint of who to talk to and the toasts, no car panels.
    foot: "#hud-toolbar, #hud-time, #hud-score, #hud-mission, #phone-button, #notice-log, #autopilot-chip, #nav, #hud-license, #car-status { visibility: hidden !important; }",
    // Only the time-of-day and weather buttons (and the data credits).
    sky: "#hud > :not(#attribution):not(#hud-time) { visibility: hidden !important; }",
    all: "",
  };
  const hudStyle = document.createElement("style");
  document.head.append(hudStyle);
  tz.hud = (mode) => (hudStyle.textContent = HUD[mode]);

  // ---- cameras ----
  tz.camera = (fn) => {
    tz.cam = fn;
    G.setDebugCamera(
      fn
        ? (cam) => {
            const car = G.vehicle.object.position;
            const yaw = G.vehicle.yaw();
            const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
            const left = { x: fwd.z, z: -fwd.x };
            fn(cam, { G, t: tz.t, len: tz.len, k: smooth(tz.t / tz.len), car, yaw, fwd, left, V3 });
            cam.updateProjectionMatrix();
            tz.sunCover?.(cam);
          }
        : null,
    );
  };
  /** The driver's eye where the game last put it, in the car's frame (taken before a seat shot). */
  tz.seat = (yaw = 0, pitch = 0, fov = null, to = null) => {
    const car = G.vehicle.object;
    car.updateMatrixWorld();
    const inv = car.matrixWorld.clone().invert();
    const eye = G.camera.position.clone().applyMatrix4(inv);
    const look = car.quaternion.clone().invert().multiply(G.camera.quaternion);
    const fov0 = G.camera.fov;
    const turn = (y, p) => new Quat().setFromEuler(new Euler(p, y, 0, "YXZ"));
    tz.camera((cam, c) => {
      car.updateMatrixWorld();
      // Optionally turning from (yaw, pitch, fov) to `to` over the shot.
      const k = to ? smooth(c.t / (to.over ?? c.len)) : 0;
      const y = yaw + ((to?.yaw ?? yaw) - yaw) * k;
      const p = pitch + ((to?.pitch ?? pitch) - pitch) * k;
      const f0 = fov ?? fov0;
      cam.position.copy(eye).applyMatrix4(car.matrixWorld);
      cam.quaternion.copy(car.quaternion).multiply(look).multiply(turn(y, p));
      cam.fov = f0 + ((to?.fov ?? f0) - f0) * k;
    });
  };

  /**
   * The lens flare's sun probe shows as a black square at the sun's centre in the WebGPU build of
   * 2026-10-05 (alpha 0 in an opaque canvas comes out black). Until the game is fixed, a disc of
   * the sun's own colour is laid over that spot, as strong as the flare finds the sun visible (0
   * behind a building), so the movie does not show the bug.
   */
  tz.coverSun = (on) => {
    document.getElementById("tz-sun")?.remove();
    tz.sunCover = null;
    if (!on) return;
    const disc = document.createElement("div");
    disc.id = "tz-sun";
    disc.style.cssText =
      "position:fixed;left:0;top:0;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;pointer-events:none;" +
      "background:radial-gradient(circle,rgb(255,252,246) 0,rgb(255,252,246) 42%,rgba(255,252,246,0) 70%)";
    document.getElementById("scene").after(disc);
    const p = new V3();
    tz.sunCover = (cam) => {
      cam.updateMatrixWorld();
      p.copy(G.env.sunDir).multiplyScalar(1000).add(cam.position).project(cam);
      const isAhead = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      disc.style.opacity = String(isAhead ? Math.min(1, G.lensFlare.seen * 1.2) : 0);
      disc.style.translate = `${((p.x + 1) / 2) * innerWidth}px ${((1 - p.y) / 2) * innerHeight}px`;
    };
  };

  // ---- a camera push-in on the page (the phone, the ticket, the navi panel) ----
  /**
   * Keyframes [{ t, sel, fx, fy, s }]: at shot time t the point (fx, fy) of `sel`'s box (fractions,
   * default its middle) sits mid-frame, enlarged s times; s 1 with no sel is the plain frame. The
   * body is scaled (the canvas with it, like a lens), and each open modal dialog alike, as the top
   * layer is outside the body. The boxes are measured once, unzoomed, when the zoom is set.
   * `edges`: the frame kept inside the page (the focus slides off the middle rather than show what
   * lies past the page's edge, black); off by default, as the Japanese teaser was filmed.
   */
  tz.zoom = (keys, { edges = false } = {}) => {
    const targets = () => [document.body, ...document.querySelectorAll("dialog[open]")];
    for (const el of [...targets(), ...(tz.zoomed ?? [])]) {
      el.style.translate = "";
      el.style.scale = "";
      el.style.transformOrigin = "";
    }
    if (!keys) return tz.hooks.delete("zoom");
    const W = innerWidth;
    const H = innerHeight;
    const points = keys.map((key) => {
      const r = key.sel ? document.querySelector(key.sel)?.getBoundingClientRect() : null;
      const x = r ? r.left + r.width * (key.fx ?? 0.5) : W / 2;
      const y = r ? r.top + r.height * (key.fy ?? 0.5) : H / 2;
      return { t: key.t, x, y, s: key.s ?? 1 };
    });
    const boxes = targets().map((el) => ({ el, box: el.getBoundingClientRect() }));
    tz.zoomed = boxes.map(({ el }) => el);
    tz.hooks.set("zoom", (t) => {
      let i = 0;
      while (i < points.length - 1 && points[i + 1].t <= t) i++;
      const a = points[i];
      const b = points[Math.min(i + 1, points.length - 1)];
      const k = b === a ? 1 : smooth((t - a.t) / (b.t - a.t));
      const s = a.s + (b.s - a.s) * k;
      const keep = (v, size) =>
        edges && s >= 1 ? Math.min(size - size / (2 * s), Math.max(size / (2 * s), v)) : v;
      const x = keep(a.x + (b.x - a.x) * k, W);
      const y = keep(a.y + (b.y - a.y) * k, H);
      // Scaled about the focus point and moved by its offset from the middle: the point lands
      // mid-frame in every layer alike.
      for (const { el, box } of boxes) {
        el.style.transformOrigin = `${x - box.left}px ${y - box.top}px`;
        el.style.translate = `${W / 2 - x}px ${H / 2 - y}px`;
        el.style.scale = String(s);
      }
    });
  };

  // ---- driving ----
  /** Cruise control by the accelerator key: held below `kmh`, released above (null: let go). */
  tz.drive = (kmh) => {
    let isDown = false;
    const press = (down) => {
      if (down === isDown) return;
      isDown = down;
      window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code: "KeyW" }));
    };
    if (kmh === null) {
      tz.hooks.get("drive")?.release();
      return tz.hooks.delete("drive");
    }
    const hook = () => press(G.vehicle.speedKmh() < kmh - 1);
    hook.release = () => press(false);
    tz.hooks.get("drive")?.release();
    tz.hooks.set("drive", hook);
  };
  tz.key = (code, down = null, shiftKey = false) => {
    const fire = (type) => window.dispatchEvent(new KeyboardEvent(type, { code, shiftKey }));
    if (down !== false) fire("keydown");
    if (down !== true) fire("keyup");
  };

  tz.frame = (t, len) => {
    tz.t = t;
    tz.len = len;
    for (const hook of tz.hooks.values()) hook(t, len);
    window.__clock.frame(1000 / 30);
  };
  window.__tz = tz;
}
