import { afterEach, describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import { CarNavi, type CarNaviState } from "../src/game/carNavi";
import { NaviTv } from "../src/game/naviTv";

afterEach(() => vi.unstubAllGlobals());

function display() {
  const fillRect = vi.fn();
  const context = new Proxy(
    { fillRect },
    {
      get: (target, key) => Reflect.get(target, key) ?? (() => {}),
    },
  );
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const tv = new NaviTv({
    audio: { muted: true, volume: 0, context: null } as never,
    voice: { enabled: false } as never,
    areas: null,
    info: () => null as never,
    speakerAt: () => new Vector3(),
    canSpeak: () => false,
  });
  return { canvas, fillRect, tv, map: new CarNavi() };
}

const state: CarNaviState = {
  now: 1000,
  graph: null,
  route: null,
  at: 0,
  pos: new Vector3(),
  yaw: 0,
  night: false,
  kmh: 0,
  limit: null,
  place: "東京駅",
  clock: "12:00",
};

describe("navi canvas ownership and texture updates", () => {
  it("keeps TV visible between redraws without requesting another upload", () => {
    const { tv, canvas, fillRect } = display();
    expect(tv.draw(canvas, 1000)).toEqual({ visible: false, changed: false });
    tv.press();
    expect(tv.draw(canvas, 1001)).toEqual({ visible: true, changed: true });
    fillRect.mockClear();
    expect(tv.draw(canvas, 1010)).toEqual({ visible: true, changed: false });
    expect(fillRect).not.toHaveBeenCalled();
    expect(tv.draw(canvas, 1070)).toEqual({ visible: true, changed: true });
    expect(fillRect).toHaveBeenCalled();
  });

  it("restores the map immediately after a brief TV visit, even before its redraw interval", () => {
    const { tv, canvas, map } = display();
    expect(map.draw(state)).toBe(true);
    tv.press();
    expect(tv.draw(canvas, 1001).changed).toBe(true);
    tv.press();
    expect(tv.draw(canvas, 1002)).toEqual({ visible: false, changed: false });
    expect(map.draw({ ...state, now: 1002 }, true)).toBe(true);
    expect(map.draw({ ...state, now: 1010 })).toBe(false);
    tv.press();
    expect(tv.draw(canvas, 1011)).toEqual({ visible: true, changed: true });
  });

  it("does not request an upload when a canvas context is unavailable", () => {
    const { tv } = display();
    tv.press();
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(tv.draw(canvas, 1000)).toEqual({ visible: false, changed: false });
  });

  it("redraws a changed channel immediately instead of retaining the previous picture", () => {
    const { tv, canvas } = display();
    tv.press();
    expect(tv.draw(canvas, 1000).changed).toBe(true);
    tv.channelUp();
    expect(tv.draw(canvas, 1001)).toEqual({ visible: true, changed: true });
  });
});
