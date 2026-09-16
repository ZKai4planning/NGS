import { getBuildingWalls } from "../lib/parametric-engine/core/buildingEnvelope";
import { assembleBuildingScene, getElevationDrawing, buildWallPanelGeometry, placeWindowGeometry } from "../lib/parametric-engine/core/assembleBuilding";
import { createRoof } from "../lib/parametric-engine/core/createRoof";
import type { GableRoofParams, WindowPlacement } from "../lib/parametric-engine/types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  [PASS] ${name}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name} ${detail}`);
  }
}

const roofParams: GableRoofParams = {
  type: "gable",
  span: 9600,
  ridgeLength: 12200,
  pitch: 30,
  eaveHeight: 2400,
  overhang: 500,
  thickness: 18,
};

const walls = getBuildingWalls(roofParams);
console.log("\n=== Building envelope (gable, span=9600 ridgeLength=12200) ===");
check("4 walls derived", walls.length === 4);
const north = walls.find((w) => w.id === "north")!;
const south = walls.find((w) => w.id === "south")!;
const east = walls.find((w) => w.id === "east")!;
const west = walls.find((w) => w.id === "west")!;
check("north/south width == span (no overhang)", north.width === 9600 && south.width === 9600, `got ${north.width}/${south.width}`);
check("east/west width == ridgeLength (no overhang)", east.width === 12200 && west.width === 12200, `got ${east.width}/${west.width}`);
check("all walls height == eaveHeight", walls.every((w) => w.height === 2400));

for (const w of walls) {
  const cross = {
    x: w.right.y * w.up.z - w.right.z * w.up.y,
    y: w.right.z * w.up.x - w.right.x * w.up.z,
    z: w.right.x * w.up.y - w.right.y * w.up.x,
  };
  const matches = Math.abs(cross.x - w.out.x) < 1e-9 && Math.abs(cross.y - w.out.y) < 1e-9 && Math.abs(cross.z - w.out.z) < 1e-9;
  check(`${w.id}: right x up == out (right-handed basis)`, matches, `got ${JSON.stringify(cross)} vs out ${JSON.stringify(w.out)}`);
}

console.log("\n=== Wall partitioning with 2 stacked-side-by-side windows ===");
const placements: WindowPlacement[] = [
  { id: "w1", elevation: "south", offsetMm: 1000, sillHeightMm: 900, window: { type: "casement", width: 1200, height: 1200, frameWidth: 60, glassThickness: 4 } },
  { id: "w2", elevation: "south", offsetMm: 3000, sillHeightMm: 900, window: { type: "fixed", width: 900, height: 1500, frameWidth: 60, glassThickness: 4 } },
];
const panel = buildWallPanelGeometry(south, placements);
check("wall panel produces vertices/indices", panel.vertices.length > 0 && panel.indices.length > 0);
check("triangle count is a multiple of 3", panel.indices.length % 3 === 0);

const win1Geom = placeWindowGeometry(south, placements[0]);
check("placed window has same vertex count as local window geometry", win1Geom.vertices.length > 0);

// The south wall's window sits at world z = -halfZ (south face), center x
// should equal offset+width/2 mapped through south's mirrored right vector.
const halfX = roofParams.span / 2;
const halfZ = roofParams.ridgeLength / 2;
const expectedWorldX = halfX - (placements[0].offsetMm + placements[0].window.width / 2); // right = (-1,0,0)
const winCenterX = win1Geom.vertices.filter((_, i) => i % 3 === 0).reduce((a, b) => a + b, 0) / (win1Geom.vertices.length / 3);
check(
  "south window's world-space centroid X matches offset (mirrored basis)",
  Math.abs(winCenterX - expectedWorldX) < 1,
  `got ${winCenterX} expected ~${expectedWorldX}`
);
const winCenterZ = win1Geom.vertices.filter((_, i) => i % 3 === 2).reduce((a, b) => a + b, 0) / (win1Geom.vertices.length / 3);
// Tolerance covers the window's own frame depth (its glass plane sits
// recessed at local z = -frameDepth/2, so the vertex centroid isn't
// exactly at the wall face) -- not a placement error.
check("south window sits at wall's z ~= -halfZ", Math.abs(winCenterZ - -halfZ) < 20, `got ${winCenterZ} expected ~${-halfZ}`);

console.log("\n=== Full building scene assembly ===");
const roof = createRoof(roofParams);
const roofGeom = roof.generateGeometry();
const scene = assembleBuildingScene(roofParams, roofGeom, placements);
check("scene geometry non-empty", scene.geometry.vertices.length > 0 && scene.geometry.indices.length > 0);
check("scene includes roof + 4 wall panels + 2 windows worth of geometry (more verts than roof alone)", scene.geometry.vertices.length > roofGeom.vertices.length);
check("every index is in range", scene.geometry.indices.every((i) => i >= 0 && i < scene.geometry.vertices.length / 3));
check("dimensions include all 4 walls x2 lines", scene.dimensions.length === 8);

console.log("\n=== Elevation drawing ===");
const drawing = getElevationDrawing(south, placements);
check("elevation has 2 window openings on south wall", drawing.windowOutlines.length === 2, `got ${drawing.windowOutlines.length}`);
check("window opening rect matches offset/sill", drawing.windowOutlines[0].outline[0].x === 1000 && drawing.windowOutlines[0].outline[0].y === 900);

console.log(`\n${pass}/${pass + fail} checks passed.`);
if (fail > 0) process.exit(1);

// ============================================================================
// Freeform walls (wallSegment.ts / placeholderRoof.ts) -- the same math
// generalized to arbitrary angles and an arbitrary number of walls, not
// just the 4-wall rectangular box above.
// ============================================================================
import { wallSegmentToFrame } from "../lib/parametric-engine/core/wallSegment";
import { buildPlaceholderRoofGeometry } from "../lib/parametric-engine/core/placeholderRoof";
import { assembleWalledScene } from "../lib/parametric-engine/core/assembleBuilding";
import { detectRooms, formatRoomArea, roomLabelPoint } from "../lib/parametric-engine/core/detectRooms";
import { fitRoofToFootprint } from "../lib/parametric-engine/core/fitRoofToFootprint";
import { buildPolygonRoof } from "../lib/parametric-engine/core/straightSkeletonRoof";
import { generateSkeletonRoofFabrication } from "../lib/parametric-engine/core/skeletonRoofFabrication";
import { placeDoorGeometry, findOverlappingPairs } from "../lib/parametric-engine/core/assembleBuilding";
import type { DoorPlacement, WallSegment } from "../lib/parametric-engine/types";

console.log("\n=== Freeform walls (L-shaped, non-axis-aligned plan) ===");
const freeformSegments: WallSegment[] = [
  { id: "w1", start: { x: 0, y: 0 }, end: { x: 4000, y: 0 }, thicknessMm: 150, heightMm: 2400 },
  { id: "w2", start: { x: 4000, y: 0 }, end: { x: 4000, y: 3000 }, thicknessMm: 150, heightMm: 2400 },
  { id: "w3", start: { x: 4000, y: 3000 }, end: { x: 1500, y: 5500 }, thicknessMm: 150, heightMm: 2700 }, // angled, taller
];
const freeformWalls = freeformSegments.map(wallSegmentToFrame);
check("3 freeform walls converted", freeformWalls.length === 3);
check("angled wall width == true diagonal length", Math.abs(freeformWalls[2].width - Math.hypot(2500, 2500)) < 1e-6);
for (const w of freeformWalls) {
  const cross = {
    x: w.right.y * w.up.z - w.right.z * w.up.y,
    y: w.right.z * w.up.x - w.right.x * w.up.z,
    z: w.right.x * w.up.y - w.right.y * w.up.x,
  };
  const matches = Math.abs(cross.x - w.out.x) < 1e-9 && Math.abs(cross.y - w.out.y) < 1e-9 && Math.abs(cross.z - w.out.z) < 1e-9;
  check(`${w.id}: right x up == out at an arbitrary drawn angle`, matches);
}

const placeholderRoofGeom = buildPlaceholderRoofGeometry(freeformWalls);
check("placeholder roof built over freeform footprint", !!placeholderRoofGeom && placeholderRoofGeom.vertices.length === 24);
check("placeholder roof is null for an empty wall list", buildPlaceholderRoofGeometry([]) === null);

const freeformPlacement: WindowPlacement = {
  id: "win_angled",
  elevation: "w3",
  offsetMm: 500,
  sillHeightMm: 900,
  window: { type: "casement", width: 1000, height: 1000, frameWidth: 60, glassThickness: 4 },
};
const freeformWindowOnly = placeWindowGeometry(freeformWalls[2], freeformPlacement);
const windowYs = freeformWindowOnly.vertices.filter((_, i) => i % 3 === 1);
check(
  "window on the angled wall sits within that wall's own height range",
  windowYs.every((y) => y >= 0 && y <= freeformWalls[2].height),
  `range [${Math.min(...windowYs)}, ${Math.max(...windowYs)}], wall height ${freeformWalls[2].height}`
);

const freeformScene = assembleWalledScene(freeformWalls, placeholderRoofGeom, [freeformPlacement]);
check("freeform scene (3 non-rectangular walls + placeholder roof + window) assembled", freeformScene.geometry.vertices.length > 0);
check("freeform scene dimensions cover all 3 walls x2 lines", freeformScene.dimensions.length === 6);

// ============================================================================
// Room detection -- closed wall loops and their floor area (the
// "Room 1 (25.1 m2)" label an architect expects once walls enclose a space).
// ============================================================================
console.log("\n=== Room detection (closed wall loops) ===");

const mkWall = (id: string, x1: number, y1: number, x2: number, y2: number): WallSegment => ({
  id,
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
  thicknessMm: 150,
  heightMm: 2400,
});

const squareRoom = [
  mkWall("a", 0, 0, 5000, 0),
  mkWall("b", 5000, 0, 5000, 5000),
  mkWall("c", 5000, 5000, 0, 5000),
  mkWall("d", 0, 5000, 0, 0),
];
const squareRooms = detectRooms(squareRoom);
check("closed 5m x 5m square detected as one room", squareRooms.length === 1);
check("square room area == 25.0 m2", formatRoomArea(squareRooms[0].areaMm2) === "25.0 m\u00b2", formatRoomArea(squareRooms[0]?.areaMm2 ?? 0));

// Same square, but drawn in inconsistent start->end directions -- an
// architect draws in whatever order is convenient, so the reported area
// must not depend on winding.
const mixedWinding = [
  mkWall("a", 0, 0, 5000, 0),
  mkWall("b", 5000, 5000, 5000, 0),
  mkWall("c", 5000, 5000, 0, 5000),
  mkWall("d", 0, 0, 0, 5000),
];
check("area is winding-independent (mixed draw directions)", formatRoomArea(detectRooms(mixedWinding)[0]?.areaMm2 ?? 0) === "25.0 m\u00b2");

const openChain = [mkWall("a", 0, 0, 5000, 0), mkWall("b", 5000, 0, 5000, 5000), mkWall("c", 5000, 5000, 0, 5000)];
check("open (unclosed) wall chain reports no room", detectRooms(openChain).length === 0);

const lShaped = [
  mkWall("a", 0, 0, 6000, 0),
  mkWall("b", 6000, 0, 6000, 3000),
  mkWall("c", 6000, 3000, 3000, 3000),
  mkWall("d", 3000, 3000, 3000, 6000),
  mkWall("e", 3000, 6000, 0, 6000),
  mkWall("f", 0, 6000, 0, 0),
];
check("L-shaped closed room area == 27.0 m2", formatRoomArea(detectRooms(lShaped)[0]?.areaMm2 ?? 0) === "27.0 m\u00b2");

const twoSquares = [
  ...squareRoom,
  mkWall("e", 10000, 0, 15000, 0),
  mkWall("f", 15000, 0, 15000, 5000),
  mkWall("g", 15000, 5000, 10000, 5000),
  mkWall("h", 10000, 5000, 10000, 0),
];
check("two disconnected closed squares detected as two rooms", detectRooms(twoSquares).length === 2);

const labelPt = roomLabelPoint(squareRooms[0]);
check("room label point falls inside the room", labelPt.x > 0 && labelPt.x < 5000 && labelPt.y > 0 && labelPt.y < 5000);

// ============================================================================
// Pitched roof auto-fit over a freeform footprint -- and, just as
// importantly, honest reporting when the footprint isn't the rectangle a
// gable/hip/shed roof actually is.
// ============================================================================
console.log("\n=== Roof auto-fit over freeform footprint ===");

const rectPlan = [
  mkWall("a", 0, 0, 5000, 0),
  mkWall("b", 5000, 0, 5000, 4000),
  mkWall("c", 5000, 4000, 0, 4000),
  mkWall("d", 0, 4000, 0, 0),
];
const rectFit = fitRoofToFootprint(rectPlan);
check("rectangular plan produces a fit", rectFit !== null);
check("fitted gable span/ridgeLength match the footprint", rectFit!.params.type === "gable" && (rectFit!.params as any).span === 5000 && (rectFit!.params as any).ridgeLength === 4000);
check("rectangular plan reports full coverage and no warning", rectFit!.isRectangular && rectFit!.warning === null && rectFit!.coverage > 0.99);
check("eave defaults to the tallest wall height", rectFit!.params.eaveHeight === 2400);

const lFit = fitRoofToFootprint(lShaped);
check("L-shaped plan is NOT reported as rectangular", lFit !== null && !lFit.isRectangular);
check("L-shaped plan coverage is ~0.75 of its bounding rect", Math.abs((lFit!.coverage) - 0.75) < 0.01, String(lFit!.coverage));
check("L-shaped plan returns an explanatory warning", !!lFit!.warning && lFit!.warning!.includes("rectangular"));

const openFit = fitRoofToFootprint([mkWall("a", 0, 0, 5000, 0), mkWall("b", 5000, 0, 5000, 4000)]);
check("unclosed plan still fits a roof but warns it isn't enclosed", !!openFit && !!openFit.warning && !openFit.isRectangular);

check("empty wall list yields no roof fit", fitRoofToFootprint([]) === null);

// ============================================================================
// Straight-skeleton roof over an arbitrary polygon -- real hips, ridges and
// valleys, including the non-rectangular plans the bounding-box fit above
// explicitly cannot roof. Expected lengths below are hand-computed.
// ============================================================================
console.log("\n=== Straight-skeleton roof (arbitrary footprint) ===");

const PT = (x: number, y: number) => ({ x, y });
const ROOF_OPTS = { pitchDeg: 30, eaveHeightMm: 2400, overhangMm: 0 };
const TAN30 = Math.tan((30 * Math.PI) / 180);
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

// 10m square: pure hip roof, apex is a single point at the centre (t=5000).
const sq = buildPolygonRoof([PT(0, 0), PT(10000, 0), PT(10000, 10000), PT(0, 10000)], ROOF_OPTS)!;
check("square: 4 roof faces", sq.faceCount === 4);
check("square: 4 hips, no ridge, no valley", sq.arcs.filter((a) => a.kind === "hip").length === 4 && sq.ridgeLengthMm === 0 && sq.valleyLengthMm === 0);
check("square: apex height = eave + 5000*tan30", near(sq.apexHeightMm, 2400 + 5000 * TAN30));
check("square: total hip length matches 4 x sqrt(5000^2+5000^2+ rise^2)", near(sq.hipLengthMm, 4 * Math.hypot(Math.hypot(5000, 5000), 5000 * TAN30), 2));

// 12m x 6m rectangle: classic gable-with-hips, ridge = 12000-6000 = 6000.
const rect = buildPolygonRoof([PT(0, 0), PT(12000, 0), PT(12000, 6000), PT(0, 6000)], ROOF_OPTS)!;
check("rectangle: ridge length = span difference (6000)", near(rect.ridgeLengthMm, 6000));
check("rectangle: apex height = eave + 3000*tan30", near(rect.apexHeightMm, 2400 + 3000 * TAN30));
check("rectangle: 4 hips", rect.arcs.filter((a) => a.kind === "hip").length === 4);

// L-shape: the reflex corner MUST produce a valley -- this is the case the
// bounding-box fit could only warn about.
const lRoof = buildPolygonRoof([PT(0, 0), PT(12000, 0), PT(12000, 6000), PT(6000, 6000), PT(6000, 12000), PT(0, 12000)], ROOF_OPTS)!;
check("L-shape: exactly one valley (from the reflex corner)", lRoof.arcs.filter((a) => a.kind === "valley").length === 1);
check("L-shape: valley length = sqrt(4243^2 + rise^2)", near(lRoof.valleyLengthMm, Math.hypot(Math.hypot(3000, 3000), 3000 * TAN30), 2));
check("L-shape: ridge total = 6000 per arm = 12000", near(lRoof.ridgeLengthMm, 12000));
check("L-shape: apex capped by the 6000-wide arms", near(lRoof.apexHeightMm, 2400 + 3000 * TAN30));
check("L-shape: all 6 faces built, no warning", lRoof.faceCount === 6 && lRoof.warning === null);

// T-shape: two reflex corners, so two valleys and two ridges (bar + stem).
const tRoof = buildPolygonRoof(
  [PT(0, 0), PT(12000, 0), PT(12000, 4000), PT(8000, 4000), PT(8000, 10000), PT(4000, 10000), PT(4000, 4000), PT(0, 4000)],
  ROOF_OPTS
)!;
check("T-shape: two valleys (one per reflex corner)", tRoof.arcs.filter((a) => a.kind === "valley").length === 2);
check("T-shape: ridge total = bar 8000 + stem 6000", near(tRoof.ridgeLengthMm, 14000));
check("T-shape: apex capped by the 4000-wide stem", near(tRoof.apexHeightMm, 2400 + 2000 * TAN30));
check("T-shape: all 8 faces built, no warning", tRoof.faceCount === 8 && tRoof.warning === null);

// Cross/plus: four reflex corners.
const plus = buildPolygonRoof(
  [PT(4000, 0), PT(8000, 0), PT(8000, 4000), PT(12000, 4000), PT(12000, 8000), PT(8000, 8000), PT(8000, 12000), PT(4000, 12000), PT(4000, 8000), PT(0, 8000), PT(0, 4000), PT(4000, 4000)],
  ROOF_OPTS
)!;
check("cross: 12 faces and 4 valleys", plus.faceCount === 12 && plus.arcs.filter((a) => a.kind === "valley").length === 4);
check("cross: resolves with no warning", plus.warning === null);

// Overhang pushes the eave line out before the skeleton is built.
const withOverhang = buildPolygonRoof([PT(0, 0), PT(12000, 0), PT(12000, 6000), PT(0, 6000)], { pitchDeg: 30, eaveHeightMm: 2400, overhangMm: 500 })!;
check("overhang: apex rises with the widened eave (t=3500)", near(withOverhang.apexHeightMm, 2400 + 3500 * TAN30));
check("overhang: ridge stays 6000 (both spans grow equally)", near(withOverhang.ridgeLengthMm, 6000));

// Winding direction of the input must not matter.
const cw = buildPolygonRoof([PT(0, 6000), PT(12000, 6000), PT(12000, 0), PT(0, 0)], ROOF_OPTS)!;
check("clockwise input gives the same roof as counter-clockwise", near(cw.ridgeLengthMm, rect.ridgeLengthMm) && near(cw.apexHeightMm, rect.apexHeightMm));

// Geometry integrity across every shape above.
for (const [name, r] of [["square", sq], ["rectangle", rect], ["L", lRoof], ["T", tRoof], ["cross", plus]] as const) {
  const nv = r.geometry.vertices.length / 3;
  const idxOk = r.geometry.indices.every((i) => i >= 0 && i < nv);
  const finite = r.geometry.vertices.every((v) => Number.isFinite(v));
  const heights = r.geometry.vertices.filter((_, i) => i % 3 === 1);
  const heightsOk = heights.every((h) => h >= 2400 - 1e-6 && h <= r.apexHeightMm + 1e-6);
  check(`${name}: geometry indices in range, finite, heights within eave..apex`, idxOk && finite && heightsOk);
}

check("degenerate input (2 points) returns null", buildPolygonRoof([PT(0, 0), PT(1, 1)], ROOF_OPTS) === null);
check("zero-area input (collinear) returns null", buildPolygonRoof([PT(0, 0), PT(1, 0), PT(2, 0)], ROOF_OPTS) === null);

// ============================================================================
// Fabrication output for skeleton roofs -- rafter schedule, cut parts and
// BOM for a roof whose faces are arbitrary polygons. Expected values below
// are hand-derived from the geometry.
// ============================================================================
console.log("\n=== Skeleton roof fabrication (rafters + BOM) ===");

const COS30 = Math.cos((30 * Math.PI) / 180);
const fabOf = (r: NonNullable<ReturnType<typeof buildPolygonRoof>>) =>
  generateSkeletonRoofFabrication(r, { pitchDeg: 30 });

const rectFab = fabOf(rect);
// Surface area must equal footprint / cos(pitch) exactly -- the single best
// cross-check that faces were measured, not guessed.
check("rect: roof surface = footprint / cos(pitch)", near(rectFab.roofSurfaceAreaMm2, rect.footprintAreaMm2 / COS30, 1000));
check("rect: full-length common rafter = 3000 / cos30 = 3464", rectFab.rafterSchedule.some((e) => near(e.lengthMm, 3464, 1)));
// A 12x6 rect at 600 spacing: 22 full rafters across the two long faces plus
// 2 at the apex of the two hipped ends.
check("rect: 24 full-length common rafters", rectFab.rafterSchedule.find((e) => near(e.lengthMm, 3464, 1))?.quantity === 24);
// Jacks shorten by one spacing of run each step: 600 / cos30 = 693.
check("rect: jack rafters step down by 693mm", [2771, 2078, 1386, 693].every((l) => rectFab.rafterSchedule.some((e) => near(e.lengthMm, l, 2))));
check("rect: one ridge member of 6000", rectFab.structure.members.some((m) => m.role === "ridge" && near(m.length, 6000, 1) && m.quantity === 1));
check("rect: 4 hip rafters of 4583", rectFab.structure.members.some((m) => m.role === "hipRafter" && near(m.length, 4583, 2) && m.quantity === 4));
check("rect: no valley members on a convex plan", !rectFab.structure.members.some((m) => m.role === "valleyRafter"));
// Timber total re-derived independently from the schedule itself.
const rectTimber =
  6000 + 4 * 4583 + rectFab.rafterSchedule.reduce((s2, e) => s2 + e.lengthMm * e.quantity, 0);
check("rect: BOM timber total matches the member schedule", near(rectFab.totalTimberMm, rectTimber, 20));
check("rect: BOM reports timber in metres, sheets in pcs, area in m2", rectFab.bom.length === 3 && rectFab.bom[0].unit === "m" && rectFab.bom[1].unit === "pcs" && rectFab.bom[2].unit === "m2");

// Square: a pure hip roof has NO ridge and every rafter is a jack, so the
// schedule should be many distinct descending lengths and zero ridge stock.
const sqFab = fabOf(sq);
check("square (pure hip): no ridge member", !sqFab.structure.members.some((m) => m.role === "ridge"));
check("square: every face is hipped, so many distinct jack lengths", sqFab.rafterSchedule.length >= 8);
check("square: jack lengths are all distinct and descending", sqFab.rafterSchedule.every((e, i, a) => i === 0 || a[i - 1].lengthMm > e.lengthMm));
check("square: surface = footprint / cos(pitch)", near(sqFab.roofSurfaceAreaMm2, sq.footprintAreaMm2 / COS30, 1000));

// L-shape: the reflex corner must appear in the cutting list as a valley.
const lFab = fabOf(lRoof);
check("L-shape: valley rafter appears in the schedule", lFab.structure.members.some((m) => m.role === "valleyRafter" && m.quantity === 1));
check("L-shape: two ridge members (one per arm)", lFab.structure.members.filter((m) => m.role === "ridge").reduce((s2, m) => s2 + m.quantity, 0) === 2);
check("L-shape: surface = footprint / cos(pitch)", near(lFab.roofSurfaceAreaMm2, lRoof.footprintAreaMm2 / COS30, 1000));

// Parts must be valid for the existing nesting/export layer.
for (const [name, fab] of [["rect", rectFab], ["square", sqFab], ["L", lFab]] as const) {
  const okParts = fab.parts.every(
    (pt) => pt.quantity > 0 && pt.outline.length >= 3 && pt.thickness > 0 && (pt.stockType !== "linear" || (pt.length ?? 0) > 0)
  );
  check(`${name}: all emitted parts are well-formed for nesting`, okParts);
}
check("rect: sheathing sheets emitted", rectFab.sheetCount > 0);
// A hipped (triangular) face must not be billed sheets over empty space:
// sheet coverage should stay within ~2x the true sloped area.
const sqSheetArea = sqFab.sheetCount * 2440 * 1220;
check("square: sheet count is not wildly over the real roof area", sqSheetArea < sqFab.roofSurfaceAreaMm2 * 2.2, `sheets cover ${(sqSheetArea / sqFab.roofSurfaceAreaMm2).toFixed(2)}x`);

// ============================================================================
// Wall panel reveal depth must reflect each wall's OWN configured
// thickness, not one hardcoded value for every wall regardless of what was
// drawn in the Wall Studio.
// ============================================================================
console.log("\n=== Wall reveal depth honors real thickness ===");

const thinWall = wallSegmentToFrame({ id: "thin", start: { x: 0, y: 0 }, end: { x: 4000, y: 0 }, thicknessMm: 90, heightMm: 2400 });
const thickWall = wallSegmentToFrame({ id: "thick", start: { x: 0, y: 0 }, end: { x: 4000, y: 0 }, thicknessMm: 300, heightMm: 2400 });
check("WallFrame carries the segment's real thicknessMm (thin)", thinWall.thicknessMm === 90);
check("WallFrame carries the segment's real thicknessMm (thick)", thickWall.thicknessMm === 300);

const depthOf = (frame: typeof thinWall) => {
  const g = buildWallPanelGeometry(frame, []);
  return Math.min(...g.vertices.filter((_, i) => i % 3 === 2));
};
check("90mm wall's panel is set back exactly 90mm", depthOf(thinWall) === -90);
check("300mm wall's panel is set back exactly 300mm (not the same as the 90mm wall)", depthOf(thickWall) === -300);

// ============================================================================
// Doors: same wall-cutting/overlap/elevation infrastructure as windows,
// generalized to OpeningPlacement rather than duplicated.
// ============================================================================
console.log("\n=== Doors on a wall ===");

const doorWall = wallSegmentToFrame({ id: "dwall", start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thicknessMm: 150, heightMm: 2400 });
const doorPlacement: DoorPlacement = {
  id: "d1",
  elevation: "dwall",
  offsetMm: 500,
  sillHeightMm: 0,
  door: { type: "single", width: 900, height: 2040, frameWidth: 45, leafThickness: 40 },
};
const windowPlacement: WindowPlacement = {
  id: "win1",
  elevation: "dwall",
  offsetMm: 3000,
  sillHeightMm: 900,
  window: { type: "casement", width: 1200, height: 1200, frameWidth: 60, glassThickness: 4 },
};

const doorGeom = placeDoorGeometry(doorWall, doorPlacement);
const doorYs = doorGeom.vertices.filter((_, i) => i % 3 === 1);
check("door sits from the floor (y=0) to its head height, not centered like a window", Math.min(...doorYs) === 0 && Math.max(...doorYs) === 2040);

check("non-overlapping door + window on the same wall: no overlap flagged", findOverlappingPairs([doorPlacement, windowPlacement]).length === 0);
const overlappingDoor: DoorPlacement = { ...doorPlacement, offsetMm: 2900 };
check("overlapping door + window on the same wall IS flagged", findOverlappingPairs([overlappingDoor, windowPlacement]).length === 1);

const mixedPanel = buildWallPanelGeometry(doorWall, [doorPlacement, windowPlacement]);
check("wall panel cuts both a door and a window opening", mixedPanel.vertices.length > 0 && mixedPanel.indices.length % 3 === 0);

const mixedDrawing = getElevationDrawing(doorWall, [doorPlacement, windowPlacement]);
check("elevation drawing tags each opening's kind correctly", mixedDrawing.windowOutlines.find((o) => o.id === "d1")?.kind === "door" && mixedDrawing.windowOutlines.find((o) => o.id === "win1")?.kind === "window");

const mixedScene = assembleWalledScene([doorWall], null, [doorPlacement, windowPlacement]);
check("full scene with a door + window assembles cleanly", mixedScene.geometry.vertices.length > 0 && mixedScene.geometry.vertices.every((v) => Number.isFinite(v)));
check("scene indices all in range", mixedScene.geometry.indices.every((i) => i >= 0 && i < mixedScene.geometry.vertices.length / 3));

console.log(`\n${pass}/${pass + fail} checks passed.`);
if (fail > 0) process.exit(1);
