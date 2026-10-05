import { onLocaleChange, t, type MessageKey } from "../i18n";
import { buttonName, controlLabel, type PadInput } from "./gamepad";
import {
  bindControl,
  bindingsOf,
  clearControl,
  contextOf,
  PAD_CONTROLS,
  RANGES,
  resetBindings,
  TOGGLABLE,
  type PadControl,
  type PadProfile,
} from "./padProfile";

/**
 * 設定 › 操作 › コントローラー: the pad found, the WebHID button for the Pro Controller's gyro and
 * rumble, the stick and trigger feel, and the list of controls with their buttons — click one,
 * press a pad button to bind it (Esc or 8 s to cancel). Changes apply at once and are saved for
 * that controller (padProfile.ts). Built in code: its rows follow the pad's own bindings and names.
 */
export function mountPadSettings(root: HTMLElement, pad: PadInput): void {
  let capturing: PadControl | null = null;
  let note = "";
  let isQueued = false;
  const dialog = root.closest("dialog");

  const render = () => {
    isQueued = false;
    root.replaceChildren(...build());
  };
  const queue = () => {
    if (isQueued) return;
    isQueued = true;
    requestAnimationFrame(render);
  };
  pad.onChange(queue);
  onLocaleChange(queue);
  // Esc while waiting for a button cancels the capture, not 設定.
  dialog?.addEventListener("cancel", (e) => {
    if (!pad.capturing) return;
    e.preventDefault();
    pad.cancelCapture();
  });
  dialog?.addEventListener("close", () => pad.cancelCapture());
  liveReadout(root, pad);
  render();

  function build(): Node[] {
    const out: Node[] = [];
    const active = pad.pad;
    out.push(
      para(active ? t("pad.found", { name: active.name, id: active.key }) : t("pad.none"), "sub pad-status"),
    );
    out.push(...hidRow());
    if (!active) return out;
    const key = active.key;
    const profile = pad.profileFor(key);
    const save = (next: PadProfile, isFinal = true) => pad.setProfile(key, next, isFinal);

    const feel = div("control-options");
    feel.append(
      slider("pad.deadzone", profile.steer.deadzone, RANGES.deadzone, 0.01, pct, (v, fin) =>
        save({ ...profile, steer: { ...profile.steer, deadzone: v } }, fin),
      ),
      slider("pad.sensitivity", profile.steer.sensitivity, RANGES.sensitivity, 0.05, times, (v, fin) =>
        save({ ...profile, steer: { ...profile.steer, sensitivity: v } }, fin),
      ),
      slider("pad.linearity", profile.steer.linearity, RANGES.linearity, 0.1, curveName, (v, fin) =>
        save({ ...profile, steer: { ...profile.steer, linearity: v } }, fin),
      ),
      slider("pad.triggerRamp", profile.triggerRampS, RANGES.triggerRampS, 0.05, seconds, (v, fin) =>
        save({ ...profile, triggerRampS: v }, fin),
      ),
      check("pad.invertLookX", profile.invertLookX, (v) => save({ ...profile, invertLookX: v })),
      ...TOGGLABLE.map((c) =>
        choice(
          t("pad.holdOf", { name: controlLabel(c) }),
          profile.toggles[c] ? "toggle" : "hold",
          [
            ["hold", t("pad.hold")],
            ["toggle", t("pad.toggle")],
          ],
          (v) => save({ ...profile, toggles: { ...profile.toggles, [c]: v === "toggle" } }),
        ),
      ),
      choice(
        t("pad.conflict"),
        profile.conflict,
        [
          ["swap", t("pad.conflictSwap")],
          ["clear", t("pad.conflictClear")],
        ],
        (v) => save({ ...profile, conflict: v === "clear" ? "clear" : "swap" }),
      ),
    );
    out.push(feel);

    const gyro = div("control-options");
    const isHid = pad.procon.connected;
    gyro.append(
      check("pad.gyro", profile.gyro.enabled, (v) => {
        if (v) pad.procon.centre();
        save({ ...profile, gyro: { ...profile.gyro, enabled: v } });
      }),
      slider("pad.gyroRange", profile.gyro.rangeDeg, RANGES.gyroRangeDeg, 5, degrees, (v, fin) =>
        save({ ...profile, gyro: { ...profile.gyro, rangeDeg: v } }, fin),
      ),
      check("pad.gyroInvert", profile.gyro.invert, (v) =>
        save({ ...profile, gyro: { ...profile.gyro, invert: v } }),
      ),
      button(t("pad.gyroCentre"), () => pad.procon.centre(), !isHid),
    );
    const readout = para("", "sub pad-gyro-readout");
    readout.dataset.padGyro = "";
    out.push(
      heading("pad.gyroTitle"),
      gyro,
      para(t(isHid ? "pad.gyroNote" : "pad.gyroNeedsHid"), "sub"),
      readout,
    );

    const rumble = div("control-options");
    rumble.append(
      check("pad.rumble", profile.rumble.enabled, (v) =>
        save({ ...profile, rumble: { ...profile.rumble, enabled: v } }),
      ),
      slider("pad.rumbleIntensity", profile.rumble.intensity, RANGES.rumbleIntensity, 0.05, pct, (v, fin) =>
        save({ ...profile, rumble: { ...profile.rumble, intensity: v } }, fin),
      ),
      check("pad.engineIdle", profile.rumble.engineIdle, (v) =>
        save({ ...profile, rumble: { ...profile.rumble, engineIdle: v } }),
      ),
      button(t("pad.rumbleTest"), () => pad.rumble("test", 1), !profile.rumble.enabled),
    );
    const hasVibration = isHid || active.vibration !== null;
    out.push(
      heading("pad.rumbleTitle"),
      rumble,
      para(t(hasVibration ? "pad.rumbleNote" : "pad.rumbleNone"), "sub"),
    );

    out.push(heading("pad.bindingsTitle"), para(t("pad.bindingsNote"), "sub"));
    const table = document.createElement("table");
    table.className = "pad-bindings";
    const bindings = bindingsOf(profile);
    for (const control of PAD_CONTROLS) {
      const row = table.insertRow();
      const name = row.insertCell();
      name.textContent = controlLabel(control);
      const where = contextOf(control);
      if (where !== "any") {
        const tag = document.createElement("small");
        tag.textContent = t(where === "car" ? "pad.inCar" : "pad.onFoot");
        name.append(" ", tag);
      }
      const cell = row.insertCell();
      const index = bindings[control];
      const isWaiting = capturing === control;
      const label = isWaiting ? t("pad.press") : index === null ? "—" : buttonName(active.family, index);
      const bind = button(label, () => startCapture(control, profile, key));
      bind.classList.add("pad-bind");
      bind.classList.toggle("waiting", isWaiting);
      cell.append(bind);
      const clear = button(
        "×",
        () => {
          note = "";
          save(clearControl(profile, control));
        },
        index === null,
      );
      clear.title = t("pad.clear");
      clear.setAttribute("aria-label", `${t("pad.clear")}: ${controlLabel(control)}`);
      row.insertCell().append(clear);
    }
    out.push(table);
    const status = para(note, "sub pad-note");
    status.setAttribute("aria-live", "polite");
    out.push(
      status,
      button(t("pad.reset"), () => {
        note = t("pad.resetDone");
        save(resetBindings(profile));
      }),
    );
    return out;
  }

  function startCapture(control: PadControl, profile: PadProfile, key: string): void {
    capturing = control;
    note = t("pad.pressNote");
    pad.startCapture(
      (index, from) => {
        capturing = null;
        // The press came from another pad than the one listed: bind it there instead.
        const target = from.key === key ? profile : pad.profileFor(from.key);
        const result = bindControl(target, control, index);
        const what = buttonName(from.family, index);
        const moved = result.swapped.map(controlLabel).join("・");
        const lost = result.cleared.map(controlLabel).join("・");
        note = moved
          ? t("pad.swapped", { button: what, other: moved })
          : lost
            ? t("pad.cleared", { button: what, other: lost })
            : t("pad.bound", { button: what, name: controlLabel(control) });
        pad.setProfile(from.key, result.profile);
      },
      () => {
        capturing = null;
        note = t("pad.cancelled");
        queue();
      },
    );
    render();
  }

  function hidRow(): Node[] {
    const hid = pad.procon;
    if (hid.status === "unsupported") return [para(t("pad.hidUnsupported"), "sub")];
    const row = div("control-options");
    if (hid.connected) {
      row.append(
        para(t(hid.usb ? "pad.hidConnectedUsb" : "pad.hidConnectedBt", { name: hid.name }), "pad-hid"),
        button(t("pad.hidDisconnect"), () => void hid.disconnect()),
      );
    } else {
      const connect = button(t("pad.hidConnect"), () => void hid.request(), hid.status === "connecting");
      row.append(connect);
    }
    return [row, para(t("pad.hidNote"), "sub")];
  }
}

/** The gyro's angle under its settings while 設定 is open (to see the wheel turn and centre it). */
function liveReadout(root: HTMLElement, pad: PadInput): void {
  const tick = () => {
    requestAnimationFrame(tick);
    const isShown = root.closest("dialog")?.open ?? false;
    if (!isShown) return;
    const out = root.querySelector<HTMLElement>("[data-pad-gyro]");
    if (!out) return;
    const isLive = pad.procon.connected && performance.now() - pad.procon.imuAt < 300;
    out.textContent = isLive
      ? t("pad.gyroAngle", { deg: Math.round((pad.procon.tilt.roll * 180) / Math.PI) })
      : pad.procon.connected
        ? t("pad.gyroWaiting")
        : "";
  };
  requestAnimationFrame(tick);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `×${v.toFixed(2)}`;
const seconds = (v: number) => `${v.toFixed(2)} s`;
const degrees = (v: number) => `${Math.round(v)}°`;
const curveName = (v: number) => (v <= 1.05 ? t("pad.linear") : `${v.toFixed(1)}`);

function div(className: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

function para(text: string, className: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

function heading(key: MessageKey): HTMLElement {
  const h = document.createElement("h4");
  h.className = "pad-heading";
  h.textContent = t(key);
  return h;
}

function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

function check(key: MessageKey, value: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = value;
  input.addEventListener("change", () => onChange(input.checked));
  const span = document.createElement("span");
  span.textContent = t(key);
  label.append(input, span);
  return label;
}

function slider(
  key: MessageKey,
  value: number,
  range: readonly [number, number],
  step: number,
  show: (v: number) => string,
  onChange: (v: number, isFinal: boolean) => void,
): HTMLLabelElement {
  const label = document.createElement("label");
  const name = document.createElement("span");
  name.textContent = t(key);
  const out = document.createElement("output");
  out.textContent = show(value);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(range[0]);
  input.max = String(range[1]);
  input.step = String(step);
  input.value = String(value);
  // While dragged: applied (and the value shown) but the panel is not rebuilt under the pointer.
  input.addEventListener("input", () => {
    out.textContent = show(Number(input.value));
    onChange(Number(input.value), false);
  });
  input.addEventListener("change", () => onChange(Number(input.value), true));
  label.append(name, " ", out, input);
  return label;
}

function choice(
  text: string,
  value: string,
  options: Array<[string, string]>,
  onChange: (v: string) => void,
): HTMLLabelElement {
  const label = document.createElement("label");
  const name = document.createElement("span");
  name.textContent = text;
  const select = document.createElement("select");
  for (const [v, l] of options) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    select.append(o);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  label.append(name, select);
  return label;
}
