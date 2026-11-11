import type { CrossObject } from "../src/expressway/compile";
import { planeAt } from "../src/expressway/geo";
import { type Network, normalizeNode, normalizeWay } from "../src/expressway/network";

/**
 * Two main lines of one road coming down to the same place (P2.7-3a, the 都心環状線's 41009552 and
 * 668292569): the lower (layer 1) runs east from a ground end at x = 0 to one at x = 2000 on y = 0;
 * the upper (layer 2) runs west from a ground end at (2000, 80) and comes down beside it, `gap` m
 * north, from x = `over` to its own ground end at x = `touchdown`. A street at ground level passes
 * under the lower only, at x = `road`. Built in a plane around 芝公園, as the other synthetic nets.
 */
export const TOUCHDOWN_PLANE = planeAt(139.75, 35.65);

export type TouchdownNet = {
  /** Design speed of both (maxspeed). */
  speed?: string;
  /** The upper's class: a main line, or a ramp (motorway_link). */
  upper?: "main" | "ramp";
  /** The upper's OSM layer (1 makes the two one surface). */
  upperLayer?: string;
  /** Where the upper comes down to the ground (x); 0 is the lower's own ground end. */
  touchdown?: number;
  /**
   * How the upper ends: going on at grade, into a tunnel (a portal end), at a node inside a tunnel
   * that crosses on into a viaduct apart from the two (pruneBelow defers that tunnel, and the end
   * reads as a ground end only after it), or after a loop back west and north to (−30, 40), 50 m
   * from the lower's touchdown but far along its own run from where the two overlap (it goes on east at grade).
   */
  ending?: "grade" | "tunnel" | "deferredTunnel" | "loop";
  /** Where the upper is before it comes beside the lower: y beyond `over` + `transition` (80 north). */
  side?: number;
  transition?: number;
  /** Sample spacing of the upper west of x = 600 (m). */
  step?: number;
  /** Lay the ways in the opposite order (T8: the input's order). */
  reversed?: boolean;
  /** A second copy elsewhere: added to every way and node id, and to y (m). */
  offset?: { id: number; y: number };
  over?: number;
  gap?: number;
  road?: number;
};

type WaySpec = { id: number; pts: Array<[number, number]>; nodeIds: number[]; tags: Record<string, string> };

function touchdownWays(o: TouchdownNet): WaySpec[] {
  const speed = o.speed ?? "40";
  const over = o.over ?? 400;
  const gap = o.gap ?? 3;
  const touchdown = o.touchdown ?? 0;
  const side = o.side ?? 80;
  const transition = o.transition ?? 200;
  const step = o.step ?? 50;
  const elevated = (layer: string) => ({
    highway: "motorway",
    bridge: "yes",
    layer,
    lanes: "2",
    maxspeed: speed,
  });
  const atGrade = { highway: "motorway", lanes: "2", maxspeed: speed };
  const tunnel = { highway: "motorway", tunnel: "yes", layer: "-1", lanes: "2", maxspeed: speed };
  const lowPts: Array<[number, number]> = [];
  for (let x = -300; x <= 2300; x += 50) lowPts.push([x, 0]);
  const lowIds = lowPts.map((_, i) => 1000 + i);
  const li = (x: number) => lowPts.findIndex(([px]) => px === x);
  const upPts: Array<[number, number]> = [];
  const yAt = (x: number) =>
    x <= over ? gap : x >= over + transition ? side : gap + ((side - gap) * (x - over)) / transition;
  for (let x = 2300; x >= -300; x -= x > 600 ? 50 : step) upPts.push([x, yAt(x)]);
  const isLoop = o.ending === "loop";
  if (isLoop)
    for (const p of [
      [-300, 20],
      [-300, 40],
      [-200, 40],
      [-100, 40],
      [-30, 40],
    ] as const)
      upPts.push([...p]);
  const upIds = upPts.map((_, i) => 5000 + i);
  const ui = (x: number) => upPts.findIndex(([px]) => px === x);
  const upper =
    o.upper === "ramp"
      ? { highway: "motorway_link", bridge: "yes", layer: o.upperLayer ?? "2", maxspeed: speed }
      : elevated(o.upperLayer ?? "2");
  const ways: WaySpec[] = [
    { id: 1, pts: lowPts.slice(0, li(0) + 1), nodeIds: lowIds.slice(0, li(0) + 1), tags: atGrade },
    {
      id: 2,
      pts: lowPts.slice(li(0), li(2000) + 1),
      nodeIds: lowIds.slice(li(0), li(2000) + 1),
      tags: elevated("1"),
    },
    { id: 3, pts: lowPts.slice(li(2000)), nodeIds: lowIds.slice(li(2000)), tags: atGrade },
    { id: 4, pts: upPts.slice(0, ui(2000) + 1), nodeIds: upIds.slice(0, ui(2000) + 1), tags: atGrade },
  ];
  const end = isLoop ? upPts.length - 1 : ui(touchdown);
  ways.push({
    id: 5,
    pts: upPts.slice(ui(2000), end + 1),
    nodeIds: upIds.slice(ui(2000), end + 1),
    tags: upper,
  });
  if (o.ending === "deferredTunnel") {
    // A tunnel passing through the upper's last node, on into a viaduct of its own to the north-east.
    const pts: Array<[number, number]> = [];
    const ids: number[] = [];
    for (let k = -4; k <= 6; k++) {
      pts.push([touchdown + 50 * k, gap + 50 * k]);
      ids.push(k === 0 ? upIds[end] : 8000 + k);
    }
    ways.push({ id: 7, pts: pts.slice(0, 7), nodeIds: ids.slice(0, 7), tags: tunnel });
    ways.push({ id: 8, pts: pts.slice(6), nodeIds: ids.slice(6), tags: elevated("1") });
  } else if (isLoop) {
    ways.push({ id: 6, pts: [upPts[end], [20, 40]], nodeIds: [upIds[end], 7000], tags: atGrade });
  } else {
    const beyond = o.ending === "tunnel" ? tunnel : atGrade;
    ways.push({ id: 6, pts: upPts.slice(end), nodeIds: upIds.slice(end), tags: beyond });
  }
  return ways;
}

export function touchdownNet(...copies: TouchdownNet[]): Network {
  const net: Network = { ways: new Map(), nodes: new Map() };
  for (const o of copies.length > 0 ? copies : [{}]) {
    const ways = touchdownWays(o);
    const dId = o.offset?.id ?? 0;
    const dy = o.offset?.y ?? 0;
    for (const w of o.reversed ? [...ways].reverse() : ways) {
      const nodeIds = w.nodeIds.map((n) => n + dId);
      net.ways.set(w.id + dId, normalizeWay(w.id + dId, nodeIds, w.tags));
      nodeIds.forEach((id, i) => {
        const [lon, lat] = TOUCHDOWN_PLANE.toLonLat(w.pts[i][0], w.pts[i][1] + dy);
        net.nodes.set(id, normalizeNode(id, lon, lat, {}));
      });
    }
  }
  return net;
}

/** The street under the lower main line only (it stops short of the upper). */
export function touchdownRoad(o: TouchdownNet = {}): CrossObject {
  const x = o.road ?? 130;
  const gap = o.gap ?? 3;
  return {
    kind: "road",
    id: 900,
    pts: [TOUCHDOWN_PLANE.toLonLat(x, -40), TOUCHDOWN_PLANE.toLonLat(x, gap / 2)],
  };
}

/** Flat ground at T.P. 3 m. */
export const touchdownGround = () => 3;
