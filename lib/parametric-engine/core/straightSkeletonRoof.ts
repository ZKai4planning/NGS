import type { GeometryResult, Point2D } from "../types";

/**
 * Roofing an arbitrary footprint properly means computing its STRAIGHT
 * SKELETON: shrink the footprint inward at a uniform rate, and the paths
 * traced by the corners are exactly the roof's hips, valleys and ridges.
 * Every original wall edge becomes one planar roof face rising at the
 * pitch, and the faces meet along the skeleton. This is the standard
 * construction behind real hip-roof CAD, and it handles L-shapes, T-shapes,
 * crosses and non-90-degree corners -- the cases fitRoofToFootprint.ts
 * explicitly could not.
 *
 * Two kinds of event drive the shrink:
 *  - EDGE EVENT: an edge shrinks to nothing and its two corners merge.
 *  - SPLIT EVENT: a reflex (inward-pointing) corner runs into an opposite
 *    edge and splits the shrinking polygon in two. Reflex corners are
 *    exactly what an L- or T-shaped building has, and split events are why
 *    such a roof develops a valley -- handling them is the whole point of
 *    doing this rather than bounding-box fitting.
 *
 * Numerical robustness is the known weak spot of straight skeletons
 * (near-simultaneous events, near-degenerate corners). Rather than emit a
 * confidently wrong roof, this implementation validates its own output and
 * returns a `warning` -- or null -- when it can't finish cleanly.
 */

const EPS = 1e-7;
const TIME_EPS = 1e-6;

export interface SkeletonNode {
  x: number;
  y: number;
  /** Inward offset distance at which this node appears; roof height above
   *  the eave is `t * tan(pitch)`. */
  t: number;
}

export type ArcKind = "hip" | "valley" | "ridge";

export interface SkeletonArc {
  a: SkeletonNode;
  b: SkeletonNode;
  kind: ArcKind;
}

/**
 * One roof face in its own 2D coordinates: `u` runs along the face's eave
 * edge, `t` is the horizontal distance inward from that edge. Every point
 * of a straight-skeleton face is at distance `t` from its own edge -- that
 * is the defining property of the construction -- so these coordinates are
 * exactly what a rafter schedule needs: a common/jack rafter at position
 * `u` has horizontal run `t` and therefore slope length `t / cos(pitch)`.
 *
 * `upper` is the face's upper boundary as a chain ascending in `u`,
 * including the two eave corners at t=0, so it can be interpolated
 * directly at any `u`.
 */
export interface RoofFaceLocal {
  edgeIndex: number;
  edgeLengthMm: number;
  upper: { u: number; t: number }[];
}

export interface PolygonRoofResult {
  geometry: GeometryResult;
  faces: RoofFaceLocal[];
  arcs: SkeletonArc[];
  /** One planar face per footprint edge, as 3D-ready outlines. */
  faceCount: number;
  ridgeLengthMm: number;
  hipLengthMm: number;
  valleyLengthMm: number;
  /** True sloped surface area (footprint area / cos(pitch)). */
  surfaceAreaMm2: number;
  footprintAreaMm2: number;
  apexHeightMm: number;
  warning: string | null;
}

interface LavVertex {
  pos: Point2D;
  vel: Point2D;
  t: number;
  leftEdge: number; // original edge index arriving at this vertex
  rightEdge: number; // original edge index leaving this vertex
  node: SkeletonNode;
  dead: boolean;
  reflex: boolean;
}

function sub(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y };
}
function len(a: Point2D): number {
  return Math.hypot(a.x, a.y);
}
function norm(a: Point2D): Point2D {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}
function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}
function cross(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x;
}

/** Signed area; positive means counter-clockwise. */
export function signedArea(poly: Point2D[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Inward normal of edge a->b for a counter-clockwise polygon (interior
 *  lies to the left of the edge direction). */
function inwardNormal(a: Point2D, b: Point2D): Point2D {
  const d = norm(sub(b, a));
  return { x: -d.y, y: d.x };
}

/**
 * Corner velocity: the direction+speed at which a corner travels so that
 * BOTH its edges sweep inward at unit rate. Solving v·n1 = 1 and v·n2 = 1
 * gives the angle bisector automatically, and gives reflex corners the
 * correct outward-leaning (faster) motion that produces valleys.
 */
function cornerVelocity(n1: Point2D, n2: Point2D): Point2D | null {
  const det = n1.x * n2.y - n1.y * n2.x;
  if (Math.abs(det) < EPS) {
    // Collinear edges: the corner just rides straight in with the edges.
    return { x: n1.x, y: n1.y };
  }
  return { x: (n2.y - n1.y) / det, y: (n1.x - n2.x) / det };
}

/** Removes consecutive duplicate and collinear points, which otherwise
 *  create zero-length edges and degenerate corners. */
function cleanPolygon(poly: Point2D[]): Point2D[] {
  const out: Point2D[] = [];
  for (const p of poly) {
    if (out.length === 0 || len(sub(p, out[out.length - 1])) > 1e-6) out.push(p);
  }
  while (out.length > 1 && len(sub(out[0], out[out.length - 1])) < 1e-6) out.pop();
  // Drop collinear middles.
  const res: Point2D[] = [];
  for (let i = 0; i < out.length; i++) {
    const prev = out[(i - 1 + out.length) % out.length];
    const cur = out[i];
    const next = out[(i + 1) % out.length];
    const d1 = norm(sub(cur, prev));
    const d2 = norm(sub(next, cur));
    if (Math.abs(cross(d1, d2)) > 1e-9 || dot(d1, d2) < 0) res.push(cur);
  }
  return res.length >= 3 ? res : out;
}

/**
 * Miter-offsets a polygon outward by `distance` -- used to push the eave
 * line out to include the roof overhang before the skeleton is computed, so
 * overhang is part of the roof surface rather than bolted on afterwards.
 */
export function offsetPolygon(poly: Point2D[], distance: number): Point2D[] {
  if (distance === 0) return poly.map((p) => ({ ...p }));
  const n = poly.length;
  const out: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    // Outward is the negative inward normal.
    const n1 = inwardNormal(prev, cur);
    const n2 = inwardNormal(cur, next);
    const v = cornerVelocity(n1, n2);
    if (!v) return poly.map((p) => ({ ...p }));
    out.push({ x: cur.x - v.x * distance, y: cur.y - v.y * distance });
  }
  return out;
}

/** A corner's position extrapolated back to time zero, so events between
 *  corners created at different times solve correctly. (A corner born at an
 *  event carries `pos` as of `t`, not as of time 0 -- ignoring that makes
 *  later events between an original and a newly-created corner come out
 *  wrong or go undetected entirely.) */
function originAtZero(v: LavVertex): Point2D {
  return { x: v.pos.x - v.vel.x * v.t, y: v.pos.y - v.vel.y * v.t };
}

/** Time at which two adjacent corners meet (their shared edge vanishes). */
function edgeEventTime(a: LavVertex, b: LavVertex): number | null {
  const a0 = originAtZero(a);
  const b0 = originAtZero(b);
  const dv = sub(a.vel, b.vel);
  const dp = sub(b0, a0);
  const denom = Math.abs(dv.x) > Math.abs(dv.y) ? dv.x : dv.y;
  if (Math.abs(denom) < EPS) return null;
  const t = (Math.abs(dv.x) > Math.abs(dv.y) ? dp.x : dp.y) / denom;
  if (!Number.isFinite(t)) return null;
  // Must be in the future for BOTH corners, not just past absolute zero.
  if (t <= a.t + TIME_EPS && t <= b.t + TIME_EPS) return null;
  if (t < Math.max(a.t, b.t) - TIME_EPS) return null;
  // Confirm both components agree -- guards against a spurious root.
  const pa = { x: a0.x + a.vel.x * t, y: a0.y + a.vel.y * t };
  const pb = { x: b0.x + b.vel.x * t, y: b0.y + b.vel.y * t };
  if (len(sub(pa, pb)) > 1e-4 * Math.max(1, t)) return null;
  return t;
}

/**
 * Time at which a reflex corner crashes into a non-adjacent moving edge.
 * The edge sweeps inward at unit rate, so the corner meets it when its
 * distance to the edge's original line equals the elapsed time.
 */
function splitEventTime(
  v: LavVertex,
  edgeA: Point2D,
  edgeB: Point2D
): { t: number; point: Point2D } | null {
  if (!v.reflex) return null;
  const v0 = originAtZero(v);
  const n = inwardNormal(edgeA, edgeB);
  const denom = 1 - dot(v.vel, n);
  if (Math.abs(denom) < EPS) return null;
  const t = dot(sub(v0, edgeA), n) / denom;
  if (!Number.isFinite(t) || t <= v.t + TIME_EPS) return null;
  const point = { x: v0.x + v.vel.x * t, y: v0.y + v.vel.y * t };
  // The hit must land within the edge's own swept span, not past its ends.
  const d = norm(sub(edgeB, edgeA));
  const proj = dot(sub(point, edgeA), d);
  const edgeLen = len(sub(edgeB, edgeA));
  if (proj < -t - 1e-3 || proj > edgeLen + t + 1e-3) return null;
  return { t, point };
}

interface BuildOptions {
  pitchDeg?: number;
  eaveHeightMm?: number;
  overhangMm?: number;
}

/**
 * Builds a real multi-plane roof over an arbitrary footprint polygon.
 * Returns null only when the input isn't a usable polygon; when the
 * skeleton itself is imperfect it still returns geometry plus a `warning`
 * describing what to distrust.
 */
export function buildPolygonRoof(footprint: Point2D[], options: BuildOptions = {}): PolygonRoofResult | null {
  const pitchDeg = options.pitchDeg ?? 30;
  const eaveHeightMm = options.eaveHeightMm ?? 2400;
  const overhangMm = options.overhangMm ?? 0;

  if (pitchDeg <= 0 || pitchDeg >= 90) return null;

  let poly = cleanPolygon(footprint.map((p) => ({ x: p.x, y: p.y })));
  if (poly.length < 3) return null;
  // Normalize to counter-clockwise so "inward normal = left normal" holds.
  if (signedArea(poly) < 0) poly.reverse();
  if (overhangMm > 0) {
    poly = cleanPolygon(offsetPolygon(poly, overhangMm));
    if (poly.length < 3) return null;
    if (signedArea(poly) < 0) poly.reverse();
  }

  const footprintAreaMm2 = Math.abs(signedArea(poly));
  if (footprintAreaMm2 < EPS) return null;

  const n = poly.length;
  const edges = poly.map((p, i) => ({ a: p, b: poly[(i + 1) % n] }));

  // No point of a straight skeleton can lie further inward than the radius
  // of the largest inscribed circle, which in turn can never exceed half
  // the footprint's smallest bounding-box dimension. Near-simultaneous
  // events on symmetric plans can otherwise throw a solved event far
  // outside the building; this bound rejects those outright instead of
  // letting one bad node distort the whole roof.
  const bboxW = Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x));
  const bboxH = Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y));
  const maxInwardT = 0.5 * Math.min(bboxW, bboxH) * (1 + 1e-6) + 1e-3;

  // --- Build the initial list of active vertices (the shrinking outline).
  const makeVertex = (i: number): LavVertex => {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const n1 = inwardNormal(prev, cur);
    const n2 = inwardNormal(cur, next);
    const vel = cornerVelocity(n1, n2) ?? { x: 0, y: 0 };
    const d1 = norm(sub(cur, prev));
    const d2 = norm(sub(next, cur));
    return {
      pos: { ...cur },
      vel,
      t: 0,
      leftEdge: (i - 1 + n) % n,
      rightEdge: i,
      node: { x: cur.x, y: cur.y, t: 0 },
      dead: false,
      // For a CCW polygon a right turn (negative cross) is a reflex corner.
      reflex: cross(d1, d2) < -1e-9,
    };
  };

  let lavs: LavVertex[][] = [Array.from({ length: n }, (_, i) => makeVertex(i))];

  const arcs: SkeletonArc[] = [];
  // Points making up each roof face, keyed by original edge index.
  const facePoints = new Map<number, SkeletonNode[]>();
  for (let i = 0; i < n; i++) facePoints.set(i, []);
  const addFacePoint = (edgeIdx: number, node: SkeletonNode) => {
    const list = facePoints.get(edgeIdx);
    if (!list) return;
    if (!list.some((p) => Math.abs(p.x - node.x) < 1e-6 && Math.abs(p.y - node.y) < 1e-6)) list.push(node);
  };

  const addArc = (from: LavVertex, to: SkeletonNode) => {
    const kind: ArcKind = from.t < TIME_EPS ? (from.reflex ? "valley" : "hip") : "ridge";
    if (len(sub({ x: from.node.x, y: from.node.y }, { x: to.x, y: to.y })) < 1e-6) return;
    arcs.push({ a: from.node, b: to, kind });
    addFacePoint(from.leftEdge, from.node);
    addFacePoint(from.leftEdge, to);
    addFacePoint(from.rightEdge, from.node);
    addFacePoint(from.rightEdge, to);
  };

  let warning: string | null = null;
  let guard = 0;
  const maxIterations = 50 * n + 200;

  while (guard++ < maxIterations) {
    // Finish any tiny LAVs.
    let progressed = false;
    for (let li = 0; li < lavs.length; li++) {
      const lav = lavs[li].filter((v) => !v.dead);
      lavs[li] = lav;
      if (lav.length === 0) continue;
      if (lav.length === 1) {
        lav[0].dead = true;
        lavs[li] = [];
        progressed = true;
        continue;
      }
      if (lav.length === 2) {
        // Two corners left: the outline has closed to a sliver, and the
        // skeleton simply runs from one corner to the other -- that segment
        // IS the ridge. Only use a computed meeting point when the pair is
        // genuinely still converging onto a point between them; otherwise
        // (anti-parallel corners, e.g. the two ends of a rectangle's ridge)
        // extrapolating produces a node way outside the building.
        const [p, q] = lav;
        const t = edgeEventTime(p, q);
        let meet: SkeletonNode | null = null;
        if (t !== null && t <= maxInwardT) {
          const p0 = originAtZero(p);
          meet = { x: p0.x + p.vel.x * t, y: p0.y + p.vel.y * t, t };
        }
        if (meet) {
          addArc(p, meet);
          addArc(q, meet);
        } else {
          // Draw from whichever corner appeared first, so an arc that
          // starts at an original footprint corner is still classified as a
          // hip/valley rather than a ridge.
          const [from, to] = p.t <= q.t ? [p, q] : [q, p];
          addArc(from, to.node);
        }
        p.dead = true;
        q.dead = true;
        lavs[li] = [];
        progressed = true;
        continue;
      }
    }
    lavs = lavs.filter((l) => l.length > 0);
    if (lavs.length === 0) break;
    if (progressed) continue;

    // Degenerate case: two adjacent corners already sit at the same point
    // (two splits landing together on a symmetric plan, for instance). The
    // edge between them has zero length, so it yields no future event and
    // the shrink would deadlock. Merge them in place and carry on.
    let mergedCoincident = false;
    for (let li = 0; li < lavs.length && !mergedCoincident; li++) {
      const lav = lavs[li];
      if (lav.length < 3) continue;
      for (let i = 0; i < lav.length; i++) {
        const a = lav[i];
        const b = lav[(i + 1) % lav.length];
        if (len(sub(a.pos, b.pos)) > 1e-6) continue;
        const n1 = inwardNormal(edges[a.leftEdge].a, edges[a.leftEdge].b);
        const n2 = inwardNormal(edges[b.rightEdge].a, edges[b.rightEdge].b);
        const d1 = norm(sub(edges[a.leftEdge].b, edges[a.leftEdge].a));
        const d2 = norm(sub(edges[b.rightEdge].b, edges[b.rightEdge].a));
        const merged: LavVertex = {
          pos: { ...a.pos },
          vel: cornerVelocity(n1, n2) ?? { x: 0, y: 0 },
          t: Math.max(a.t, b.t),
          leftEdge: a.leftEdge,
          rightEdge: b.rightEdge,
          node: a.node,
          dead: false,
          reflex: cross(d1, d2) < -1e-9,
        };
        a.dead = true;
        b.dead = true;
        const rebuilt = lav.filter((w) => !w.dead);
        rebuilt.splice(i % Math.max(1, rebuilt.length + 1), 0, merged);
        lavs[li] = rebuilt;
        mergedCoincident = true;
        break;
      }
    }
    if (mergedCoincident) continue;

    // --- Find the earliest event across every active outline.
    let best: {
      time: number;
      lavIndex: number;
      type: "edge" | "split";
      i: number;
      j?: number;
      point: Point2D;
      edgeIdx?: number;
    } | null = null;

    for (let li = 0; li < lavs.length; li++) {
      const lav = lavs[li];
      for (let i = 0; i < lav.length; i++) {
        const a = lav[i];
        const b = lav[(i + 1) % lav.length];
        const t = edgeEventTime(a, b);
        if (t !== null && t <= maxInwardT && (!best || t < best.time)) {
          const a0 = originAtZero(a);
          best = {
            time: t,
            lavIndex: li,
            type: "edge",
            i,
            point: { x: a0.x + a.vel.x * t, y: a0.y + a.vel.y * t },
          };
        }
      }
      // Split events: only reflex corners can cause them.
      for (let i = 0; i < lav.length; i++) {
        const v = lav[i];
        if (!v.reflex) continue;
        for (let e = 0; e < edges.length; e++) {
          if (e === v.leftEdge || e === v.rightEdge) continue;
          const hit = splitEventTime(v, edges[e].a, edges[e].b);
          if (!hit || hit.t > maxInwardT) continue;
          // Only meaningful if the edge is still represented in this outline.
          const stillActive = lav.some((w) => w.leftEdge === e || w.rightEdge === e);
          if (!stillActive) continue;
          if (!best || hit.t < best.time) {
            best = { time: hit.t, lavIndex: li, type: "split", i, point: hit.point, edgeIdx: e };
          }
        }
      }
    }

    if (!best) {
      warning =
        "The roof skeleton couldn't be resolved all the way to the ridge for this footprint; the upper part of the roof may be incomplete.";
      break;
    }

    const lav = lavs[best.lavIndex];
    const node: SkeletonNode = { x: best.point.x, y: best.point.y, t: best.time };

    if (best.type === "edge") {
      const a = lav[best.i];
      const b = lav[(best.i + 1) % lav.length];
      addArc(a, node);
      addArc(b, node);
      a.dead = true;
      b.dead = true;

      const prev = lav[(best.i - 1 + lav.length) % lav.length];
      const next = lav[(best.i + 2) % lav.length];
      if (prev === b || next === a) {
        lavs[best.lavIndex] = lav.filter((v) => !v.dead);
        continue;
      }

      const n1 = inwardNormal(edges[a.leftEdge].a, edges[a.leftEdge].b);
      const n2 = inwardNormal(edges[b.rightEdge].a, edges[b.rightEdge].b);
      const vel = cornerVelocity(n1, n2);
      const md1 = norm(sub(edges[a.leftEdge].b, edges[a.leftEdge].a));
      const md2 = norm(sub(edges[b.rightEdge].b, edges[b.rightEdge].a));
      const merged: LavVertex = {
        pos: { x: node.x, y: node.y },
        vel: vel ?? { x: 0, y: 0 },
        t: best.time,
        leftEdge: a.leftEdge,
        rightEdge: b.rightEdge,
        node,
        dead: false,
        // Derived from the surviving edges rather than assumed convex -- a
        // merged corner can still be reflex and go on to cause a split.
        reflex: cross(md1, md2) < -1e-9,
      };
      const rebuilt = lav.filter((v) => !v.dead);
      const insertAt = rebuilt.indexOf(next);
      if (insertAt < 0) rebuilt.push(merged);
      else rebuilt.splice(insertAt, 0, merged);
      lavs[best.lavIndex] = rebuilt;
    } else {
      // SPLIT: the reflex corner reaches an opposite edge, and the shrinking
      // outline separates into two independent outlines that continue on
      // their own. Getting this partition right is what produces a correct
      // valley on an L- or T-shaped building.
      //
      // The hit edge `e` sits between two corners in this outline: x (whose
      // outgoing edge is e) and y = x's successor (whose incoming edge is
      // e). The outline splits into:
      //   A: [new corner (v.leftEdge -> e)] + y ... v.prev
      //   B: [new corner (e -> v.rightEdge)] + v.next ... x
      // Each new corner sits at the hit point and carries one of v's
      // original edges plus the edge it just ran into.
      const L = lav.length;
      const vi = best.i;
      const v = lav[vi];
      const hitEdge = best.edgeIdx!;
      addArc(v, node);
      v.dead = true;

      const xi = lav.findIndex((w) => w.rightEdge === hitEdge);
      const yi = xi >= 0 ? (xi + 1) % L : -1;
      if (xi < 0 || lav[xi] === v || lav[yi] === v) {
        lavs[best.lavIndex] = lav.filter((w) => !w.dead);
        continue;
      }

      const chain = (from: number, to: number): LavVertex[] => {
        const out: LavVertex[] = [];
        let k = from;
        for (let steps = 0; steps < L; steps++) {
          if (lav[k] !== v && !lav[k].dead) out.push(lav[k]);
          if (k === to) break;
          k = (k + 1) % L;
        }
        return out;
      };

      const makeSplitCorner = (leftEdge: number, rightEdge: number): LavVertex => {
        const n1 = inwardNormal(edges[leftEdge].a, edges[leftEdge].b);
        const n2 = inwardNormal(edges[rightEdge].a, edges[rightEdge].b);
        const d1 = norm(sub(edges[leftEdge].b, edges[leftEdge].a));
        const d2 = norm(sub(edges[rightEdge].b, edges[rightEdge].a));
        return {
          pos: { x: node.x, y: node.y },
          vel: cornerVelocity(n1, n2) ?? { x: 0, y: 0 },
          t: best.time,
          leftEdge,
          rightEdge,
          node,
          dead: false,
          reflex: cross(d1, d2) < -1e-9,
        };
      };

      const chainA = chain(yi, (vi - 1 + L) % L);
      const chainB = chain((vi + 1) % L, xi);

      const lavA = chainA.length > 0 ? [makeSplitCorner(v.leftEdge, hitEdge), ...chainA] : [];
      const lavB = chainB.length > 0 ? [makeSplitCorner(hitEdge, v.rightEdge), ...chainB] : [];

      lavs[best.lavIndex] = lavA;
      if (lavB.length > 0) lavs.push(lavB);
    }
  }

  if (guard >= maxIterations) {
    warning =
      "The roof skeleton hit its iteration limit on this footprint, so the result may be incomplete. Simplifying the plan (fewer, longer walls) usually resolves it.";
  }

  // --- Turn each footprint edge into a planar roof face.
  const tanPitch = Math.tan((pitchDeg * Math.PI) / 180);
  const heightAt = (t: number) => eaveHeightMm + t * tanPitch;

  const vertices: number[] = [];
  const indices: number[] = [];
  const faces: RoofFaceLocal[] = [];
  let apexHeightMm = eaveHeightMm;
  let builtFaces = 0;

  for (let e = 0; e < n; e++) {
    const edge = edges[e];
    const dir = norm(sub(edge.b, edge.a));
    const collected = (facePoints.get(e) ?? []).filter(
      (p) => len(sub({ x: p.x, y: p.y }, edge.a)) > 1e-6 && len(sub({ x: p.x, y: p.y }, edge.b)) > 1e-6
    );

    // A straight-skeleton face is monotone along its own edge, so ordering
    // the skeleton points by their projection onto the edge direction
    // reconstructs the face outline without a general polygon sort.
    collected.sort((p, q) => dot(sub({ x: q.x, y: q.y }, edge.a), dir) - dot(sub({ x: p.x, y: p.y }, edge.a), dir));

    const outline: SkeletonNode[] = [
      { x: edge.a.x, y: edge.a.y, t: 0 },
      { x: edge.b.x, y: edge.b.y, t: 0 },
      ...collected,
    ];
    if (outline.length < 3) continue;

    const base = vertices.length / 3;
    for (const p of outline) {
      const h = heightAt(p.t);
      apexHeightMm = Math.max(apexHeightMm, h);
      // Engine convention: plan X -> world X, plan Y -> world Z, height -> Y.
      vertices.push(p.x, h, p.y);
    }
    // Fan triangulation. Straight-skeleton faces are monotone w.r.t. their
    // edge and in practice convex for building footprints, so a fan from
    // the first eave corner is sound here.
    for (let k = 1; k < outline.length - 1; k++) {
      indices.push(base, base + k, base + k + 1);
    }

    // Face-local (u, t) boundary for the fabrication layer.
    const edgeLengthMm = len(sub(edge.b, edge.a));
    const upper = collected
      .map((p) => ({ u: dot(sub({ x: p.x, y: p.y }, edge.a), dir), t: p.t }))
      .sort((a, b) => a.u - b.u);
    faces.push({
      edgeIndex: e,
      edgeLengthMm,
      upper: [{ u: 0, t: 0 }, ...upper, { u: edgeLengthMm, t: 0 }],
    });
    builtFaces++;
  }

  if (builtFaces === 0) return null;
  if (builtFaces < n && !warning) {
    warning = `Only ${builtFaces} of ${n} roof faces could be resolved for this footprint. Treat the 3D view as indicative.`;
  }

  let ridgeLengthMm = 0;
  let hipLengthMm = 0;
  let valleyLengthMm = 0;
  for (const arc of arcs) {
    const planLen = Math.hypot(arc.b.x - arc.a.x, arc.b.y - arc.a.y);
    const dh = Math.abs(heightAt(arc.b.t) - heightAt(arc.a.t));
    const trueLen = Math.hypot(planLen, dh);
    if (arc.kind === "ridge") ridgeLengthMm += trueLen;
    else if (arc.kind === "hip") hipLengthMm += trueLen;
    else valleyLengthMm += trueLen;
  }

  return {
    geometry: { vertices, indices },
    faces,
    arcs,
    faceCount: builtFaces,
    ridgeLengthMm,
    hipLengthMm,
    valleyLengthMm,
    surfaceAreaMm2: footprintAreaMm2 / Math.cos((pitchDeg * Math.PI) / 180),
    footprintAreaMm2,
    apexHeightMm,
    warning,
  };
}
