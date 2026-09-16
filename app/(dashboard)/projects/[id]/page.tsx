"use client";

import { use, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { createRoof } from "@/lib/parametric-engine/core/createRoof";
import { createWindow, createDoor } from "@/lib/parametric-engine/core/createOpening";
import { createWallWithWindow } from "@/lib/parametric-engine/core/createWallWithWindow";
import { getRoofFootprint } from "@/lib/parametric-engine/core/roofFootprint";
import { getBuildingWalls } from "@/lib/parametric-engine/core/buildingEnvelope";
import { wallSegmentToFrame } from "@/lib/parametric-engine/core/wallSegment";
import { buildPlaceholderRoofGeometry } from "@/lib/parametric-engine/core/placeholderRoof";
import { fitRoofToFootprint } from "@/lib/parametric-engine/core/fitRoofToFootprint";
import { buildPolygonRoof } from "@/lib/parametric-engine/core/straightSkeletonRoof";
import { generateSkeletonRoofFabrication } from "@/lib/parametric-engine/core/skeletonRoofFabrication";
import { detectRooms } from "@/lib/parametric-engine/core/detectRooms";
import { assembleWalledScene, getElevationDrawing, findOverlappingPairs } from "@/lib/parametric-engine/core/assembleBuilding";
import { WallStudio2D } from "@/components/WallStudio2D";
import { exportAssemblyDrawingToDXF, type DrawingOutlineDXF, type DrawingDimDXF } from "@/lib/parametric-engine/fabrication/drawing-export";
import { Cad2DDrawing } from "@/components/Cad2DDrawing";
import type {
  RoofParams,
  RoofType,
  WindowParams,
  WindowType,
  WindowPlacement,
  DoorParams,
  DoorPlacement,
  OpeningPlacement,
  Elevation,
  Part,
  LinearOptimizationResult,
  NestingResult,
  BOMLineItem,
} from "@/lib/parametric-engine/types";
import { generateRoof, runNesting, generatePolygonRoof } from "@/lib/parametric-engine-client";
import { exportCombinedNestingToDXF } from "@/lib/combined-dxf-export";
import { DeleteProjectButton } from "@/components/DeleteProjectButton";
import { EngineDebugPanel } from "@/components/EngineDebugPanel";
import { useRouter } from "next/navigation";

// Three.js touches window/canvas - keep it out of the server bundle.
const RoofViewer = dynamic(() => import("@/components/RoofViewer").then((m) => m.RoofViewer), { ssr: false });
const NestingLayoutSVG = dynamic(() => import("@/components/NestingLayoutSVG").then((m) => m.NestingLayoutSVG), { ssr: false });

const DEFAULT_PARAMS: Record<RoofType, RoofParams> = {
  gable: { type: "gable", span: 9600, ridgeLength: 12200, pitch: 30, eaveHeight: 2400, overhang: 500, thickness: 18 },
  hip: { type: "hip", width: 9600, length: 14000, pitch: 25, eaveHeight: 2400, overhang: 500, thickness: 18 },
  shed: { type: "shed", width: 8000, length: 12000, pitch: 15, eaveHeight: 2400, overhang: 500, thickness: 18 },
};

// Sensible defaults for a residential re-roof; swap for real supplier data later.
// Includes long lengths up to 13.4m to cover ridge beams -- a ridge is one
// continuous part spanning the full ridge length (see GableRoof.ts), and a
// typical LVL/glulam ridge beam genuinely is ordered that long as a single
// piece, unlike rafters/purlins which are always much shorter. Anything
// longer than 13400mm still has no fit here -- the engine correctly refuses
// to invent a splice joint it doesn't model, so a ridge beyond this range
// needs either a longer stock entry added below or a real scarf/splice
// design decision made by the person spec'ing the job, not silently assumed.
const TOOL = { kerf: 3, minSpacing: 5 };
const SHEET_STOCK = { width: 2440, height: 1220 };
const LINEAR_STOCK = [
  { length: 3600 },
  { length: 4800 },
  { length: 6000 },
  { length: 6600 },
  { length: 9000 },
  { length: 10800 },
  { length: 13400 },
];

type JobType = "roof" | "window" | "roof_and_window";

// DB row shape from project_elements (kind='window'), including the fields
// added in supabase/migrations/20260913_add_window_engine_fields.sql and
// 20260914_add_window_position_fields.sql.
interface WindowElementRow {
  id: string;
  label: string | null;
  frame_width_m: number;
  frame_height_m: number;
  window_style: "casement" | "sliding" | "picture" | "bay" | "awning";
  elevation: string;
  frame_sightline_mm: number | null;
  glass_thickness_mm: number | null;
  panels: number | null;
  offset_mm: number | null;
  sill_height_mm: number | null;
  wall_id: string | null;
}

// Standard sill height applied when a window's sill_height_mm is null --
// see the migration comment for why there's no fixed offset_mm default
// (it depends on wall width, which varies per project).
const DEFAULT_SILL_HEIGHT_MM = 900;

function isElevation(value: string): value is Elevation {
  return value === "north" || value === "south" || value === "east" || value === "west";
}

// DB row shape from the `walls` table (see
// supabase/migrations/20260914_add_walls_table.sql).
interface WallRow {
  id: string;
  start_x_mm: number;
  start_y_mm: number;
  end_x_mm: number;
  end_y_mm: number;
  thickness_mm: number;
  height_mm: number;
}

function wallRowToSegment(row: WallRow) {
  return {
    id: row.id,
    start: { x: row.start_x_mm, y: row.start_y_mm },
    end: { x: row.end_x_mm, y: row.end_y_mm },
    thicknessMm: row.thickness_mm,
    heightMm: row.height_mm,
  };
}

// The engine only models fixed/casement/sliding geometry today (see
// ParametricWindow.ts) -- picture and bay windows are approximated as
// fixed, and awning as casement, until the engine grows dedicated geometry
// for them. This only affects the 3D preview/BOM math, not what's stored.
function toEngineWindowType(style: WindowElementRow["window_style"]): WindowType {
  if (style === "sliding") return "sliding";
  if (style === "casement" || style === "awning") return "casement";
  return "fixed";
}

function windowRowToParams(row: WindowElementRow): WindowParams {
  return {
    type: toEngineWindowType(row.window_style),
    width: row.frame_width_m * 1000,
    height: row.frame_height_m * 1000,
    frameWidth: row.frame_sightline_mm ?? 60,
    glassThickness: row.glass_thickness_mm ?? 4,
    panels: row.panels ?? 1,
  };
}

// DB row shape for a door (kind='door'), added in
// supabase/migrations/20260915_add_doors.sql. Shares frame_width_m,
// frame_height_m, frame_sightline_mm, elevation, offset_mm and wall_id with
// windows -- same physical concepts, same columns -- but sill_height_mm is
// always 0 (doors run to the floor) and isn't exposed as editable.
interface DoorElementRow {
  id: string;
  label: string | null;
  frame_width_m: number;
  frame_height_m: number;
  door_type: "single" | "double" | "sliding";
  elevation: string;
  frame_sightline_mm: number | null;
  leaf_thickness_mm: number | null;
  frame_depth_mm: number | null;
  offset_mm: number | null;
  wall_id: string | null;
}

function doorRowToParams(row: DoorElementRow): DoorParams {
  return {
    type: row.door_type,
    width: row.frame_width_m * 1000,
    height: row.frame_height_m * 1000,
    frameWidth: row.frame_sightline_mm ?? 45,
    frameDepth: row.frame_depth_mm ?? undefined,
    leafThickness: row.leaf_thickness_mm ?? 40,
  };
}

// Combines any number of BOM line lists into one, summing quantities for
// lines that share both material name and unit, and keeping the rest as
// separate lines (e.g. "Frame timber" from a window is never silently
// merged into "Timber (rafters + ridge)" from the roof just because both
// happen to be metres of timber -- they're different materials).
function combineBOM(lists: BOMLineItem[][]): BOMLineItem[] {
  const merged = new Map<string, BOMLineItem>();
  for (const list of lists) {
    for (const item of list) {
      const key = `${item.material}__${item.unit}`;
      const existing = merged.get(key);
      if (existing) {
        existing.quantity = Math.round((existing.quantity + item.quantity) * 100) / 100;
      } else {
        merged.set(key, { ...item });
      }
    }
  }
  return Array.from(merged.values());
}

export default function ProjectWorkspace({ params }: { params: Promise<{ id: string }> }) {
  // Next.js 15: params is a Promise even in Client Component pages -
  // React's use() unwraps it synchronously during render.
  const { id: projectId } = use(params);
  const router = useRouter();

  const [jobType, setJobType] = useState<JobType>("roof");
  const [roofParams, setRoofParams] = useState<RoofParams>(DEFAULT_PARAMS.gable);
  const [view, setView] = useState<"3d" | "drawing" | "fabrication" | "building" | "elevations" | "studio">("3d");
  // Per-window 3D/2D toggle, keyed by window row id -- defaults to "3d" for
  // any window not yet present in the map.
  const [windowViews, setWindowViews] = useState<Record<string, "3d" | "drawing">>({});
  const [doorViews, setDoorViews] = useState<Record<string, "3d" | "drawing">>({});
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [isNewProject, setIsNewProject] = useState(false);

  const [roofConfigId, setRoofConfigId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nestingRunning, setNestingRunning] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nestingResult, setNestingResult] = useState<NestingResult | null>(null);
  const [linearResult, setLinearResult] = useState<LinearOptimizationResult | null>(null);
  const [scheduled, setScheduled] = useState(false);

  // Council/planning approval via AI4Planning - independent of nesting/CAD
  // export. A project doesn't have to go through this at all; it's an
  // extra optional stage that becomes available once dimensions are
  // approved, not a hard gate before scheduling.
  const [councilSubmission, setCouncilSubmission] = useState<{
    status: "submitted" | "approved" | "rejected" | "withdrawn";
    decision_notes: string | null;
    submitted_at: string;
  } | null>(null);
  const [submittingToCouncil, setSubmittingToCouncil] = useState(false);

  // Windows: a project can have several, unlike the single roof config.
  const [windows, setWindows] = useState<WindowElementRow[]>([]);
  const [doors, setDoors] = useState<DoorElementRow[]>([]);
  const [loadingWindows, setLoadingWindows] = useState(true);
  const [addingWindow, setAddingWindow] = useState(false);
  const [newWindow, setNewWindow] = useState({
    elevation: "south",
    wallId: "",
    windowStyle: "casement" as WindowElementRow["window_style"],
    frameWidthM: 1.2,
    frameHeightM: 1.2,
    // Empty string = "auto" (centered offset / standard sill height) --
    // see DEFAULT_SILL_HEIGHT_MM and the position migration's comment.
    offsetMm: "",
    sillHeightMm: "",
  });
  // Draft position edits per window OR door row id (both use the same
  // offsetMm/sillHeightMm shape, so one map covers both) -- typing in one
  // opening's fields doesn't touch the others and isn't saved until "Save
  // position" is clicked. Doors just never populate sillHeightMm (see
  // positionDraftFor).
  const [positionDrafts, setPositionDrafts] = useState<Record<string, { offsetMm: string; sillHeightMm: string }>>({});
  const [savingPosition, setSavingPosition] = useState<string | null>(null);

  const [addingDoor, setAddingDoor] = useState(false);
  const [newDoor, setNewDoor] = useState({
    elevation: "south",
    wallId: "",
    doorType: "single" as DoorElementRow["door_type"],
    frameWidthM: 0.9,
    frameHeightM: 2.04,
    offsetMm: "",
  });

  // Freeform, user-drawn walls (see supabase/migrations/20260914_add_walls_table.sql).
  // As soon as a project has any of these, they take over from the
  // roof-derived rectangular box for the Building view and window
  // placement -- see `hasFreeformWalls` below.
  const [wallRows, setWallRows] = useState<WallRow[]>([]);
  const [loadingWalls, setLoadingWalls] = useState(true);

  // Load the project row first so we know whether this job is a roof,
  // a window, or both -- this previously didn't exist at all, which is
  // why the workspace always rendered the roof-only UI regardless of what
  // was actually booked in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) throw new Error("Failed to load project");
        const { project } = await res.json();
        if (!cancelled) setJobType(project.job_type as JobType);
        // A roof_and_window job is the one case where the assembled
        // building view is actually meaningful (see the "building" view's
        // gating below) -- default to it there instead of the per-roof 3D
        // preview, since that's the view that answers "what does the
        // actual building look like."
        if (!cancelled && project.job_type === "roof_and_window") setView("building");
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Failed to load project");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load whatever was actually saved for THIS project before rendering
  // anything meaningful. Without this, every project - brand new or
  // already approved and exported - looked identical, showing the same
  // hardcoded defaults regardless of what's really in the database. A
  // project with no saved config yet is the one case where defaults are
  // accurate, not misleading.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/roof-config`);
        if (!res.ok) throw new Error("Failed to load existing roof config");
        const { roofConfig } = await res.json();
        if (!cancelled && roofConfig) {
          setRoofParams(roofConfig.params);
          setRoofConfigId(roofConfig.id);
        } else if (!cancelled) {
          // No saved config exists - the form is about to show hardcoded
          // starting numbers (9600mm span, etc.) that look exactly like
          // real data. Flag that explicitly rather than let a brand-new
          // project look identical to an already-configured one.
          setIsNewProject(true);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Failed to load existing roof config");
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load any windows AND doors already saved against this project -- the
  // GET endpoint returns both kinds now (see elements/route.ts), split here
  // by `kind` so `windows`/`doors` state each only ever holds its own rows,
  // exactly as before this split existed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/elements`);
        if (!res.ok) throw new Error("Failed to load windows");
        const { elements } = await res.json();
        if (!cancelled) {
          setWindows((elements ?? []).filter((e: { kind: string }) => e.kind === "window"));
          setDoors((elements ?? []).filter((e: { kind: string }) => e.kind === "door"));
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Failed to load windows");
      } finally {
        if (!cancelled) setLoadingWindows(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load any freeform walls already drawn for this project.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/walls`);
        if (!res.ok) throw new Error("Failed to load walls");
        const { walls } = await res.json();
        if (!cancelled) setWallRows(walls ?? []);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Failed to load walls");
      } finally {
        if (!cancelled) setLoadingWalls(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load any existing council submission for this project, so the status
  // shown doesn't reset to nothing on every page revisit.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/council-submission`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setCouncilSubmission(d.submission ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const showRoof = jobType === "roof" || jobType === "roof_and_window";
  const showWindows = jobType === "window" || jobType === "roof_and_window";

  // Instant client-side preview - no network round trip. The same engine
  // class runs identically in the browser and on the server.
  const roof = useMemo(() => {
    if (!showRoof) return null;
    try {
      return createRoof(roofParams);
    } catch {
      return null;
    }
  }, [roofParams, showRoof]);

  const roofPreview = useMemo(() => roof?.generateAll() ?? null, [roof]);
  const allParts: Part[] = roofPreview?.parts.parts ?? [];

  const boundingSize =
    roofParams.type === "gable" ? roofParams.span + roofParams.overhang * 2 : roofParams.width + roofParams.overhang * 2;

  // Each saved window gets its own live engine preview, same as the roof.
  // `wall` wraps that same window geometry in a visual stud-wall panel
  // (see createWallWithWindow) purely so the 3D view shows the window
  // mounted in context instead of floating alone -- it plays no part in
  // the BOM/parts/fabrication, which still come from `preview` (the window
  // alone), unchanged.
  const windowPreviews = useMemo(() => {
    return windows.map((row) => {
      let preview: ReturnType<ReturnType<typeof createWindow>["generateAll"]> | null = null;
      let wall: ReturnType<typeof createWallWithWindow> | null = null;
      try {
        const params = windowRowToParams(row);
        const win = createWindow(params);
        preview = win.generateAll();
        // Independent try/catch: the wall wrapper is a visualization nicety
        // (see createWallWithWindow) -- if it ever fails, the window preview
        // itself should still render rather than disappearing along with it.
        try {
          wall = createWallWithWindow(params);
        } catch {
          wall = null;
        }
      } catch {
        preview = null;
        wall = null;
      }
      return { row, preview, wall };
    });
  }, [windows]);

  // Same idea as windowPreviews, for doors -- no generic wall-swatch
  // wrapper (createWallWithWindow has no door equivalent), just the door's
  // own generateAll() for its BOM/dimensions card.
  const doorPreviews = useMemo(() => {
    return doors.map((row) => {
      let preview: ReturnType<ReturnType<typeof createDoor>["generateAll"]> | null = null;
      try {
        preview = createDoor(doorRowToParams(row)).generateAll();
      } catch {
        preview = null;
      }
      return { row, preview };
    });
  }, [doors]);

  const roofFootprint = useMemo(() => (showRoof ? getRoofFootprint(roofParams) : null), [roofParams, showRoof]);

  // Walls implied by the current roof footprint -- undefined/empty when
  // there's no roof to derive a building envelope from (jobType "window").
  const buildingWalls = useMemo(() => (showRoof ? getBuildingWalls(roofParams) : []), [roofParams, showRoof]);

  // Freeform walls the architect has actually drawn (Wall Studio) --
  // wallRowToSegment + wallSegmentToFrame is the exact same conversion the
  // roof-box's 4 corners go through (see buildingEnvelope.ts), just fed
  // arbitrary user-drawn segments instead of a rectangle's corners.
  const freeformWalls = useMemo(() => wallRows.map((row) => wallSegmentToFrame(wallRowToSegment(row))), [wallRows]);

  // Once ANY freeform wall exists, it replaces the roof-derived box for
  // window placement and the Building view -- a project is either "box
  // mode" (elevation-only windows on the 4 roof-derived walls) or "studio
  // mode" (windows on real drawn walls), not a mix, so there's one
  // unambiguous set of walls windows resolve against at a time.
  const hasFreeformWalls = freeformWalls.length > 0;
  const effectiveWalls = hasFreeformWalls ? freeformWalls : buildingWalls;

  // Resolves every saved window's null offset_mm/sill_height_mm into real
  // mm values (centered on its wall / DEFAULT_SILL_HEIGHT_MM) so the engine
  // never has to special-case "no position set yet" -- see the position
  // migration's comment for why those columns are nullable in the first
  // place. Windows whose params fail to construct, or whose wall reference
  // doesn't match a real wall (stale data, or a box-mode window sitting
  // around after freeform walls were drawn and it hasn't been reassigned
  // yet), are skipped rather than crashing the whole building view.
  const windowPlacements: WindowPlacement[] = useMemo(() => {
    if (effectiveWalls.length === 0) return [];
    return windows.flatMap((row): WindowPlacement[] => {
      const wallKey = hasFreeformWalls ? row.wall_id : isElevation(row.elevation) ? row.elevation : null;
      if (!wallKey) return [];
      const wall = effectiveWalls.find((w) => w.id === wallKey);
      if (!wall) return [];
      let params: WindowParams;
      try {
        params = windowRowToParams(row);
      } catch {
        return [];
      }
      const offsetMm = row.offset_mm ?? Math.max(0, (wall.width - params.width) / 2);
      const sillHeightMm = row.sill_height_mm ?? DEFAULT_SILL_HEIGHT_MM;
      return [{ id: row.id, elevation: wall.id, offsetMm, sillHeightMm, window: params }];
    });
  }, [windows, effectiveWalls, hasFreeformWalls]);

  // Same resolution as windowPlacements, for doors -- sillHeightMm is
  // always 0 (see DoorElementRow's doc), never resolved from a stored
  // value, since a door doesn't have one to store.
  const doorPlacements: DoorPlacement[] = useMemo(() => {
    if (effectiveWalls.length === 0) return [];
    return doors.flatMap((row): DoorPlacement[] => {
      const wallKey = hasFreeformWalls ? row.wall_id : isElevation(row.elevation) ? row.elevation : null;
      if (!wallKey) return [];
      const wall = effectiveWalls.find((w) => w.id === wallKey);
      if (!wall) return [];
      let params: DoorParams;
      try {
        params = doorRowToParams(row);
      } catch {
        return [];
      }
      const offsetMm = row.offset_mm ?? Math.max(0, (wall.width - params.width) / 2);
      return [{ id: row.id, elevation: wall.id, offsetMm, sillHeightMm: 0, door: params }];
    });
  }, [doors, effectiveWalls, hasFreeformWalls]);

  // Everything that gets cut into a wall -- windows and doors together --
  // for the Building view, elevation drawings and overlap checking, all of
  // which are written against OpeningPlacement rather than WindowPlacement
  // specifically (see assembleBuilding.ts).
  const openingPlacements: OpeningPlacement[] = useMemo(() => [...windowPlacements, ...doorPlacements], [windowPlacements, doorPlacements]);

  // The actual building: roof/placeholder-roof + every wall + every window
  // cut into its real wall at its real position (see assembleBuilding.ts).
  // Box mode uses the real pitched roof mesh; studio mode uses a flat
  // placeholder slab (see placeholderRoof.ts for why a pitched roof can't
  // just be generated over an arbitrary drawn footprint).
  // In studio mode the roof is auto-fitted to the drawn footprint's
  // bounding rectangle, reusing the same parametric roof engine (and so the
  // same rafter/BOM maths) as box mode -- but only when it's a faithful
  // fit. For a non-rectangular plan `fitRoofToFootprint` says so, and we
  // fall back to the flat placeholder slab rather than showing a confident
  // pitched roof that doesn't match the building (see placeholderRoof.ts /
  // fitRoofToFootprint.ts for why an arbitrary polygon can't just be
  // gable-roofed).
  const [useFittedRoof, setUseFittedRoof] = useState(true);

  const roofFit = useMemo(() => {
    if (!hasFreeformWalls) return null;
    return fitRoofToFootprint(wallRows.map(wallRowToSegment), { type: roofParams.type, pitch: roofParams.pitch, overhang: roofParams.overhang, thickness: roofParams.thickness });
  }, [hasFreeformWalls, wallRows, roofParams.type, roofParams.pitch, roofParams.overhang, roofParams.thickness]);

  const fittedRoofPreview = useMemo(() => {
    if (!roofFit || !useFittedRoof) return null;
    try {
      return createRoof(roofFit.params).generateAll();
    } catch {
      return null;
    }
  }, [roofFit, useFittedRoof]);

  // A REAL roof over the drawn plan, whatever its shape: the straight
  // skeleton gives true hips, ridges and valleys over an L, T, cross or
  // any non-90-degree footprint -- the cases the rectangular fit above can
  // only approximate and warn about. One roof is generated per enclosed
  // room and the results are merged, so a plan with two separate enclosed
  // areas gets a correct roof over each rather than one rectangle
  // spanning both.
  const polygonRoof = useMemo(() => {
    if (!hasFreeformWalls) return null;
    const segments = wallRows.map(wallRowToSegment);
    const rooms = detectRooms(segments);
    if (rooms.length === 0) return null;

    const eaveHeightMm = Math.max(...segments.map((w) => w.heightMm));
    const vertices: number[] = [];
    const indices: number[] = [];
    let ridgeLengthMm = 0;
    let hipLengthMm = 0;
    let valleyLengthMm = 0;
    let surfaceAreaMm2 = 0;
    let apexHeightMm = 0;
    const warnings: string[] = [];
    // Real fabrication output for this shape -- rafters, hips, valleys and
    // sheathing derived from the skeleton faces rather than from the
    // rectangular roof engine (which can't describe this roof).
    const bomTotals = new Map<string, { unit: string; description: string; quantity: number }>();
    const rafterTally = new Map<number, number>();
    const memberTally: { role: string; lengthMm: number; quantity: number }[] = [];

    for (const room of rooms) {
      const roof = buildPolygonRoof(room.outline, {
        pitchDeg: roofParams.pitch,
        eaveHeightMm,
        overhangMm: roofParams.overhang,
      });
      if (!roof) continue;
      const base = vertices.length / 3;
      vertices.push(...roof.geometry.vertices);
      for (const idx of roof.geometry.indices) indices.push(idx + base);
      ridgeLengthMm += roof.ridgeLengthMm;
      hipLengthMm += roof.hipLengthMm;
      valleyLengthMm += roof.valleyLengthMm;
      surfaceAreaMm2 += roof.surfaceAreaMm2;
      apexHeightMm = Math.max(apexHeightMm, roof.apexHeightMm);
      if (roof.warning) warnings.push(roof.warning);

      const fab = generateSkeletonRoofFabrication(roof, {
        pitchDeg: roofParams.pitch,
        sheathingThicknessMm: roofParams.thickness,
      });
      for (const line of fab.bom) {
        const existing = bomTotals.get(line.material);
        bomTotals.set(line.material, {
          unit: line.unit,
          description: line.description,
          quantity: Math.round(((existing?.quantity ?? 0) + line.quantity) * 100) / 100,
        });
      }
      for (const entry of fab.rafterSchedule) {
        rafterTally.set(entry.lengthMm, (rafterTally.get(entry.lengthMm) ?? 0) + entry.quantity);
      }
      for (const m of fab.structure.members) {
        if (m.role === "rafter") continue; // already covered by the rafter schedule
        memberTally.push({ role: m.role, lengthMm: m.length, quantity: m.quantity });
      }
    }

    if (vertices.length === 0) return null;
    return {
      geometry: { vertices, indices },
      roomCount: rooms.length,
      ridgeLengthMm,
      hipLengthMm,
      valleyLengthMm,
      surfaceAreaMm2,
      apexHeightMm,
      warning: warnings.length > 0 ? warnings[0] : null,
      bom: [...bomTotals.entries()].map(([material, v]) => ({ material, ...v })),
      rafterSchedule: [...rafterTally.entries()]
        .map(([lengthMm, quantity]) => ({ lengthMm, quantity }))
        .sort((a, b) => b.lengthMm - a.lengthMm),
      members: memberTally.sort((a, b) => b.lengthMm - a.lengthMm),
    };
  }, [hasFreeformWalls, wallRows, roofParams.pitch, roofParams.overhang, roofParams.thickness]);

  const buildingScene = useMemo(() => {
    if (effectiveWalls.length === 0) return null;
    try {
      // Preference order for a freeform plan: the true straight-skeleton
      // roof over the drawn footprint; then the rectangular fit (only
      // meaningful when the plan really is a rectangle); then the flat
      // placeholder slab so there's still something overhead.
      const roofGeometry = hasFreeformWalls
        ? (polygonRoof?.geometry ?? fittedRoofPreview?.geometry ?? buildPlaceholderRoofGeometry(freeformWalls))
        : roofPreview?.geometry ?? null;
      return assembleWalledScene(effectiveWalls, roofGeometry, openingPlacements);
    } catch {
      return null;
    }
  }, [effectiveWalls, hasFreeformWalls, freeformWalls, roofPreview, fittedRoofPreview, polygonRoof, openingPlacements]);

  const buildingBoundingSize = useMemo(() => {
    if (effectiveWalls.length === 0) return boundingSize;
    const maxWallWidth = Math.max(...effectiveWalls.map((w) => w.width));
    const maxWallHeight = Math.max(...effectiveWalls.map((w) => w.height));
    return Math.max(maxWallWidth, maxWallHeight) * 1.3;
  }, [effectiveWalls, boundingSize]);

  // How many openings (windows + doors) sit on each freeform wall -- fed to
  // the studio so deleting a wall warns before orphaning them.
  const windowCountByWallId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const w of windows) {
      if (w.wall_id) counts[w.wall_id] = (counts[w.wall_id] ?? 0) + 1;
    }
    for (const d of doors) {
      if (d.wall_id) counts[d.wall_id] = (counts[d.wall_id] ?? 0) + 1;
    }
    return counts;
  }, [windows, doors]);

  // Real per-elevation/per-wall 2D drawings: wall outline + every window/door
  // opening at its true offset/sill on that wall, not just one isolated
  // window.
  const elevationDrawings = useMemo(() => effectiveWalls.map((wall) => getElevationDrawing(wall, openingPlacements)), [effectiveWalls, openingPlacements]);


  // Checks a prospective placement (new window being added, or an existing
  // one being repositioned) against every other window already on that
  // wall. Rejects rather than warns -- see the flagged trade-off: a
  // silent/soft warning is easy to miss and the partition math downstream
  // has no real behavior for overlapping openings, so catching it here
  // before it's ever saved is simpler than teaching the engine to render
  // (or the fabrication layer to cut) something that doesn't correspond to
  // a buildable wall. `excludeId` lets repositioning an existing window
  // check against every *other* window without flagging itself.
  // Checks a prospective placement (new window/door being added, or an
  // existing one being repositioned) against every OTHER opening already
  // on that wall -- windows and doors share one overlap check, since a
  // door and a window overlapping is exactly as unbuildable as two windows
  // overlapping. Rejects rather than warns -- see the flagged trade-off: a
  // silent/soft warning is easy to miss and the partition math downstream
  // has no real behavior for overlapping openings, so catching it here
  // before it's ever saved is simpler than teaching the engine to render
  // (or the fabrication layer to cut) something that doesn't correspond to
  // a buildable wall. `excludeId` lets repositioning an existing opening
  // check against every *other* opening without flagging itself.
  function findPlacementConflict(
    candidate: { elevation: string; offsetMm: number; sillHeightMm: number; widthMm: number; heightMm: number },
    excludeId?: string
  ): { label: string | null; elevation: string } | null {
    const others = openingPlacements.filter((p) => p.id !== excludeId);
    const probe: WindowPlacement = {
      id: "__candidate__",
      elevation: candidate.elevation,
      offsetMm: candidate.offsetMm,
      sillHeightMm: candidate.sillHeightMm,
      window: { type: "fixed", width: candidate.widthMm, height: candidate.heightMm, frameWidth: 1, glassThickness: 1 },
    };
    const overlaps = findOverlappingPairs([...others, probe]).filter((o) => o.aId === "__candidate__" || o.bId === "__candidate__");
    if (overlaps.length === 0) return null;
    const conflictingId = overlaps[0].aId === "__candidate__" ? overlaps[0].bId : overlaps[0].aId;
    const conflictingWindow = windows.find((w) => w.id === conflictingId);
    if (conflictingWindow) return conflictingWindow;
    const conflictingDoor = doors.find((d) => d.id === conflictingId);
    if (conflictingDoor) return conflictingDoor;
    return null;
  }

  // The number the "how are we selecting the bill of materials" question
  // is really about: this is EVERY material on the project combined --
  // roof (if any) plus every window (if any) -- not just whichever one
  // happens to be on screen. Nothing is "selected" by the user; it's
  // always the full, current set of components on this project.
  const combinedBOM = useMemo(() => {
    const lists: BOMLineItem[][] = [];
    if (roofPreview) lists.push(roofPreview.bom);
    for (const { preview } of windowPreviews) {
      if (preview) lists.push(preview.bom);
    }
    return combineBOM(lists);
  }, [roofPreview, windowPreviews]);

  function updateParam(key: string, value: number) {
    setRoofParams((prev) => ({ ...prev, [key]: value } as RoofParams));
    setRoofConfigId(null);
    setNestingResult(null);
    setLinearResult(null);
  }

  function switchType(type: RoofType) {
    // Preserve the fields every roof type shares (pitch, eave height,
    // overhang, thickness) - only the type-specific dimensions (span/ridge
    // vs width/length) reset to that type's defaults. Losing pitch/overhang
    // every time you compare roof types is exactly the "changing to
    // default" annoyance this fixes.
    setRoofParams((prev) => ({
      ...DEFAULT_PARAMS[type],
      pitch: prev.pitch,
      eaveHeight: prev.eaveHeight,
      overhang: prev.overhang,
      thickness: prev.thickness,
    }));
    setRoofConfigId(null);
    setNestingResult(null);
    setLinearResult(null);
  }

  async function handleApprove() {
    setSaving(true);
    setError(null);
    try {
      if (hasFreeformWalls) {
        // Freeform plan: send the actual drawn walls so fabrication comes
        // from the real straight-skeleton roof (see /api/roofs/generate-polygon)
        // instead of the rectangular engine, which can't describe this shape.
        const res = await generatePolygonRoof(projectId, wallRows.map(wallRowToSegment), {
          pitchDeg: roofParams.pitch,
          overhangMm: roofParams.overhang,
          thicknessMm: roofParams.thickness,
        });
        setRoofConfigId(res.roofConfigId);
        setIsNewProject(false);
        if (res.warnings.length > 0) setError(res.warnings[0]);
      } else {
        const res = await generateRoof(projectId, roofParams);
        setRoofConfigId(res.roofConfigId);
        setIsNewProject(false);
      }
    } catch (err: any) {
      setError(err.message ?? "Failed to save roof config");
    } finally {
      setSaving(false);
    }
  }

  async function handleExportCAD() {
    if (!roofConfigId) return;
    setNestingRunning(true);
    setError(null);
    try {
      const res = await runNesting(roofConfigId, TOOL, SHEET_STOCK, LINEAR_STOCK);
      setNestingResult(res.nesting ?? null);
      setLinearResult(res.linear ?? null);
      setView("fabrication");
    } catch (err: any) {
      const message: string = err.message ?? "Failed to run nesting";
      // Translate the engine's precise-but-terse error into something that
      // points at the actual fix, since "no stock or remnant is long
      // enough" doesn't tell you WHICH input to change.
      if (message.includes("no stock or remnant is long enough")) {
        setError(
          `${message} This is almost always the ridge length exceeding every configured stock length. Either shorten the ridge, or add a longer stock option to LINEAR_STOCK in this page's source.`
        );
      } else {
        setError(message);
      }
    } finally {
      setNestingRunning(false);
    }
  }

  function handleDownloadCombinedDXF() {
    if (!nestingResult) return;
    const dxf = exportCombinedNestingToDXF(nestingResult.sheets, allParts, TOOL);
    downloadDXF(dxf, `${projectId}-all-sheets.dxf`);
  }

  // Roof plan-view outline + width/depth dimension lines, shared by the
  // in-app 2D drawing and its DXF export so the two never drift apart.
  function roofDrawingGeometry() {
    if (!roofFootprint) return null;
    const xs = roofFootprint.outline.map((p) => p.x);
    const ys = roofFootprint.outline.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const outlines: DrawingOutlineDXF[] = [{ points: roofFootprint.outline, layer: "ROOF_OUTLINE" }];
    if (roofFootprint.ridgeLine) {
      outlines.push({ points: [roofFootprint.ridgeLine.start, roofFootprint.ridgeLine.end], layer: "RIDGE", closed: false });
    }
    const dims: DrawingDimDXF[] = [
      { start: { x: minX, y: minY }, end: { x: maxX, y: minY }, label: "Width" },
      { start: { x: minX, y: minY }, end: { x: minX, y: maxY }, label: "Depth" },
    ];
    return { outlines, dims, minX, maxX, minY, maxY };
  }

  function handleDownloadRoofDrawingDXF() {
    const geo = roofDrawingGeometry();
    if (!geo) return;
    const dxf = exportAssemblyDrawingToDXF(`${roofParams.type} roof plan`, geo.outlines, geo.dims);
    downloadDXF(dxf, `${projectId}-roof-plan.dxf`);
  }

  function handleDownloadWindowDrawingDXF(row: WindowElementRow) {
    const params = windowRowToParams(row);
    const halfW = params.width / 2;
    const halfH = params.height / 2;
    const outlines: DrawingOutlineDXF[] = [
      {
        layer: "WINDOW_FRAME",
        points: [
          { x: -halfW, y: -halfH },
          { x: halfW, y: -halfH },
          { x: halfW, y: halfH },
          { x: -halfW, y: halfH },
        ],
      },
    ];
    const dims: DrawingDimDXF[] = [
      { start: { x: -halfW, y: -halfH }, end: { x: halfW, y: -halfH }, label: "Width" },
      { start: { x: -halfW, y: -halfH }, end: { x: -halfW, y: halfH }, label: "Height" },
    ];
    const dxf = exportAssemblyDrawingToDXF(`${row.label ?? row.elevation} window elevation`, outlines, dims);
    downloadDXF(dxf, `${projectId}-window-${row.id}-elevation.dxf`);
  }

  function handleDownloadDoorDrawingDXF(row: DoorElementRow) {
    const params = doorRowToParams(row);
    const halfW = params.width / 2;
    const halfH = params.height / 2;
    const outlines: DrawingOutlineDXF[] = [
      {
        layer: "DOOR_FRAME",
        points: [
          { x: -halfW, y: -halfH },
          { x: halfW, y: -halfH },
          { x: halfW, y: halfH },
          { x: -halfW, y: halfH },
        ],
      },
    ];
    const dims: DrawingDimDXF[] = [
      { start: { x: -halfW, y: -halfH }, end: { x: halfW, y: -halfH }, label: "Width" },
      { start: { x: -halfW, y: -halfH }, end: { x: -halfW, y: halfH }, label: "Height" },
    ];
    const dxf = exportAssemblyDrawingToDXF(`${row.label ?? row.elevation} door elevation`, outlines, dims);
    downloadDXF(dxf, `${projectId}-door-${row.id}-elevation.dxf`);
  }

  // Downloadable alongside the roof plan / window elevation DXFs above,
  // using the same drawing-export.ts pattern -- but built from the real
  // wall + window-opening geometry (getElevationDrawing) instead of a
  // single isolated window.
  function handleDownloadElevationDXF(drawing: ReturnType<typeof getElevationDrawing>) {
    const outlines: DrawingOutlineDXF[] = [
      { points: drawing.outline, layer: "WALL_OUTLINE" },
      ...drawing.windowOutlines.map((w) => ({ points: w.outline, layer: w.kind === "door" ? "DOOR_OPENING" : "WINDOW_OPENING" })),
    ];
    const dims: DrawingDimDXF[] = [
      { start: { x: 0, y: 0 }, end: { x: drawing.wall.width, y: 0 }, label: "Width" },
      { start: { x: 0, y: 0 }, end: { x: 0, y: drawing.wall.height }, label: "Height" },
    ];
    const dxf = exportAssemblyDrawingToDXF(`${drawing.wall.id} elevation`, outlines, dims);
    downloadDXF(dxf, `${projectId}-${drawing.wall.id}-elevation.dxf`);
  }

  function positionDraftFor(row: WindowElementRow) {
    return (
      positionDrafts[row.id] ?? {
        offsetMm: row.offset_mm != null ? String(row.offset_mm) : "",
        sillHeightMm: row.sill_height_mm != null ? String(row.sill_height_mm) : "",
      }
    );
  }

  async function handleSavePosition(row: WindowElementRow) {
    const draft = positionDraftFor(row);
    const offsetMm = draft.offsetMm.trim() === "" ? null : Number(draft.offsetMm);
    const sillHeightMm = draft.sillHeightMm.trim() === "" ? null : Number(draft.sillHeightMm);
    if ((offsetMm !== null && Number.isNaN(offsetMm)) || (sillHeightMm !== null && Number.isNaN(sillHeightMm))) {
      setError("Offset and sill height must be numbers, or left blank for auto.");
      return;
    }
    const wallKey = hasFreeformWalls ? row.wall_id : isElevation(row.elevation) ? row.elevation : null;
    if (wallKey) {
      const wall = effectiveWalls.find((w) => w.id === wallKey);
      const widthMm = row.frame_width_m * 1000;
      const heightMm = row.frame_height_m * 1000;
      const resolvedOffset = offsetMm ?? (wall ? Math.max(0, (wall.width - widthMm) / 2) : 0);
      const resolvedSill = sillHeightMm ?? DEFAULT_SILL_HEIGHT_MM;
      const conflict = findPlacementConflict(
        { elevation: wallKey, offsetMm: resolvedOffset, sillHeightMm: resolvedSill, widthMm, heightMm },
        row.id
      );
      if (conflict) {
        setError(
          `This position would overlap ${conflict.label ?? conflict.elevation}. Adjust the offset/sill height (or that window's) so they don't overlap.`
        );
        return;
      }
    }
    setSavingPosition(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/elements/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offsetMm, sillHeightMm }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save window position");
      const { element } = await res.json();
      setWindows((prev) => prev.map((w) => (w.id === row.id ? element : w)));
      setPositionDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
    } catch (err: any) {
      setError(err.message ?? "Failed to save window position");
    } finally {
      setSavingPosition(null);
    }
  }

  // Same shape as positionDraftFor, for a door -- sillHeightMm is never
  // populated from the row (doors don't have one to restore), so the field
  // simply never renders for doors in the UI below.
  function doorPositionDraftFor(row: DoorElementRow) {
    return positionDrafts[row.id] ?? { offsetMm: row.offset_mm != null ? String(row.offset_mm) : "", sillHeightMm: "" };
  }

  async function handleSaveDoorPosition(row: DoorElementRow) {
    const draft = doorPositionDraftFor(row);
    const offsetMm = draft.offsetMm.trim() === "" ? null : Number(draft.offsetMm);
    if (offsetMm !== null && Number.isNaN(offsetMm)) {
      setError("Offset must be a number, or left blank for auto.");
      return;
    }
    const wallKey = hasFreeformWalls ? row.wall_id : isElevation(row.elevation) ? row.elevation : null;
    if (wallKey) {
      const wall = effectiveWalls.find((w) => w.id === wallKey);
      const widthMm = row.frame_width_m * 1000;
      const heightMm = row.frame_height_m * 1000;
      const resolvedOffset = offsetMm ?? (wall ? Math.max(0, (wall.width - widthMm) / 2) : 0);
      const conflict = findPlacementConflict({ elevation: wallKey, offsetMm: resolvedOffset, sillHeightMm: 0, widthMm, heightMm }, row.id);
      if (conflict) {
        setError(`This position would overlap ${conflict.label ?? conflict.elevation}. Adjust the offset (or that opening's) so they don't overlap.`);
        return;
      }
    }
    setSavingPosition(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/elements/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offsetMm }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save door position");
      const { element } = await res.json();
      setDoors((prev) => prev.map((d) => (d.id === row.id ? element : d)));
      setPositionDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
    } catch (err: any) {
      setError(err.message ?? "Failed to save door position");
    } finally {
      setSavingPosition(null);
    }
  }

  function downloadDXF(dxf: string, filename: string) {
    const blob = new Blob([dxf], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSubmitToCouncil() {
    setSubmittingToCouncil(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai4planning/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit for council approval");
      setCouncilSubmission({ status: "submitted", decision_notes: null, submitted_at: new Date().toISOString() });
    } catch (err: any) {
      setError(err.message ?? "Failed to submit for council approval");
    } finally {
      setSubmittingToCouncil(false);
    }
  }

  async function handleMarkScheduled() {
    setScheduling(true);
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "scheduled" }),
      });
      setScheduled(true);
    } finally {
      setScheduling(false);
    }
  }

  async function handleCreateWall(start: { x: number; y: number }, end: { x: number; y: number }): Promise<boolean> {
    try {
      const res = await fetch(`/api/projects/${projectId}/walls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startX: start.x, startY: start.y, endX: end.x, endY: end.y }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create wall");
      const { wall } = await res.json();
      setWallRows((prev) => [...prev, wall]);
      return true;
    } catch (err: any) {
      setError(err.message ?? "Failed to create wall");
      return false;
    }
  }

  async function handleUpdateWall(
    id: string,
    patch: Partial<{ start: { x: number; y: number }; end: { x: number; y: number }; thicknessMm: number; heightMm: number }>
  ) {
    try {
      const body: Record<string, number> = {};
      if (patch.start) {
        body.startX = patch.start.x;
        body.startY = patch.start.y;
      }
      if (patch.end) {
        body.endX = patch.end.x;
        body.endY = patch.end.y;
      }
      if (patch.thicknessMm !== undefined) body.thicknessMm = patch.thicknessMm;
      if (patch.heightMm !== undefined) body.heightMm = patch.heightMm;

      const res = await fetch(`/api/projects/${projectId}/walls/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to update wall");
      const { wall } = await res.json();
      setWallRows((prev) => prev.map((w) => (w.id === id ? wall : w)));
    } catch (err: any) {
      setError(err.message ?? "Failed to update wall");
    }
  }

  async function handleDeleteWall(id: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}/walls/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to delete wall");
      setWallRows((prev) => prev.filter((w) => w.id !== id));
      // Any window that was on this wall has its wall_id nulled server-side
      // (ON DELETE SET NULL) -- reflect that locally too so the position
      // panel shows "Unassigned" immediately instead of a stale wall id.
      setWindows((prev) => prev.map((w) => (w.wall_id === id ? { ...w, wall_id: null } : w)));
    } catch (err: any) {
      setError(err.message ?? "Failed to delete wall");
    }
  }

  async function handleAddWindow() {
    setAddingWindow(true);
    setError(null);
    try {
      const offsetMm = newWindow.offsetMm.trim() === "" ? null : Number(newWindow.offsetMm);
      const sillHeightMm = newWindow.sillHeightMm.trim() === "" ? null : Number(newWindow.sillHeightMm);
      if ((offsetMm !== null && Number.isNaN(offsetMm)) || (sillHeightMm !== null && Number.isNaN(sillHeightMm))) {
        throw new Error("Offset and sill height must be numbers, or left blank for auto.");
      }
      if (hasFreeformWalls && !newWindow.wallId) {
        throw new Error("Pick a wall to place the window on.");
      }
      const targetWallKey = hasFreeformWalls ? newWindow.wallId : newWindow.elevation;
      if (targetWallKey) {
        const wall = effectiveWalls.find((w) => w.id === targetWallKey);
        const widthMm = newWindow.frameWidthM * 1000;
        const heightMm = newWindow.frameHeightM * 1000;
        const resolvedOffset = offsetMm ?? (wall ? Math.max(0, (wall.width - widthMm) / 2) : 0);
        const resolvedSill = sillHeightMm ?? DEFAULT_SILL_HEIGHT_MM;
        const conflict = findPlacementConflict({
          elevation: targetWallKey,
          offsetMm: resolvedOffset,
          sillHeightMm: resolvedSill,
          widthMm,
          heightMm,
        });
        if (conflict) {
          throw new Error(
            `This window would overlap ${conflict.label ?? conflict.elevation}. Adjust the offset/sill height (or that window's) so they don't overlap.`
          );
        }
      }
      const res = await fetch(`/api/projects/${projectId}/elements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "window",
          elevation: hasFreeformWalls ? `wall-${targetWallKey.slice(0, 8)}` : newWindow.elevation,
          wallId: hasFreeformWalls ? newWindow.wallId : null,
          windowStyle: newWindow.windowStyle,
          frameWidthM: newWindow.frameWidthM,
          frameHeightM: newWindow.frameHeightM,
          offsetMm,
          sillHeightMm,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add window");
      const { element } = await res.json();
      setWindows((prev) => [...prev, element]);
    } catch (err: any) {
      setError(err.message ?? "Failed to add window");
    } finally {
      setAddingWindow(false);
    }
  }

  async function handleDeleteWindow(id: string) {
    const prev = windows;
    setWindows((w) => w.filter((row) => row.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/projects/${projectId}/elements/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to delete window");
    } catch (err: any) {
      setWindows(prev); // roll back
      setError(err.message ?? "Failed to delete window");
    }
  }

  async function handleAddDoor() {
    setAddingDoor(true);
    setError(null);
    try {
      const offsetMm = newDoor.offsetMm.trim() === "" ? null : Number(newDoor.offsetMm);
      if (offsetMm !== null && Number.isNaN(offsetMm)) {
        throw new Error("Offset must be a number, or left blank for auto.");
      }
      if (hasFreeformWalls && !newDoor.wallId) {
        throw new Error("Pick a wall to place the door on.");
      }
      const targetWallKey = hasFreeformWalls ? newDoor.wallId : newDoor.elevation;
      if (targetWallKey) {
        const wall = effectiveWalls.find((w) => w.id === targetWallKey);
        const widthMm = newDoor.frameWidthM * 1000;
        const heightMm = newDoor.frameHeightM * 1000;
        const resolvedOffset = offsetMm ?? (wall ? Math.max(0, (wall.width - widthMm) / 2) : 0);
        const conflict = findPlacementConflict({ elevation: targetWallKey, offsetMm: resolvedOffset, sillHeightMm: 0, widthMm, heightMm });
        if (conflict) {
          throw new Error(
            `This door would overlap ${conflict.label ?? conflict.elevation}. Adjust the offset (or that opening's) so they don't overlap.`
          );
        }
      }
      const res = await fetch(`/api/projects/${projectId}/elements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "door",
          elevation: hasFreeformWalls ? `wall-${targetWallKey.slice(0, 8)}` : newDoor.elevation,
          wallId: hasFreeformWalls ? newDoor.wallId : null,
          doorType: newDoor.doorType,
          frameWidthM: newDoor.frameWidthM,
          frameHeightM: newDoor.frameHeightM,
          offsetMm,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add door");
      const { element } = await res.json();
      setDoors((prev) => [...prev, element]);
    } catch (err: any) {
      setError(err.message ?? "Failed to add door");
    } finally {
      setAddingDoor(false);
    }
  }

  async function handleDeleteDoor(id: string) {
    const prev = doors;
    setDoors((d) => d.filter((row) => row.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/projects/${projectId}/elements/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to delete door");
    } catch (err: any) {
      setDoors(prev); // roll back
      setError(err.message ?? "Failed to delete door");
    }
  }

  const title = jobType === "window" ? "Window design" : jobType === "roof_and_window" ? "Roof & window design" : "Rooftop design";

  return loadingExisting || loadingWindows ? (
    <div className="card card-pad">
      <p className="helptext">Loading this project's saved dimensions…</p>
    </div>
  ) : (
    <div className="card card-pad">
      <div className="row-between" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18 }}>{title}</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {showRoof && (
            <div className="view-toggle">
              {(["gable", "hip", "shed"] as RoofType[]).map((t) => (
                <button key={t} className={roofParams.type === t ? "active" : ""} onClick={() => switchType(t)}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          )}
          <DeleteProjectButton projectId={projectId} projectTitle="this project" afterDelete={() => router.push("/projects")} />
        </div>
      </div>

      {isNewProject && showRoof && (
        <div
          style={{
            background: "var(--amber-dim)",
            color: "#7A5A1A",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          <strong>New project — nothing saved yet.</strong> The numbers below are starting defaults, not real
          measurements. Adjust them to match this job, then click <em>Approve dimensions</em>.
        </div>
      )}

      {error && (
        <div
          style={{
            background: "var(--red-dim)",
            color: "#7A2D20",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          <strong>Something went wrong:</strong> {error}
        </div>
      )}

      {/* Roof and window are two independent, always-visible sections
          stacked vertically rather than tabs that hide one while the
          other is shown -- a roof_and_window job needs both on screen
          at once, not a toggle that swaps between them. */}

      {showRoof && (
        <section style={{ marginBottom: showWindows ? 28 : 0 }}>
          {showWindows && (
            <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 10 }}>
              Roof
            </h2>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20 }}>
            {/* Left: params + BOM */}
            <div>
              <ParamFields params={roofParams} onChange={updateParam} />

              {roofPreview && (
                <div className="card" style={{ marginTop: 16, padding: 14 }}>
                  <div className="helptext" style={{ fontWeight: 600, marginBottom: 6, color: "var(--ink)" }}>
                    Roof bill of materials
                  </div>
                  {roofPreview.bom.map((item) => (
                    <div key={item.material} className="field-row" style={{ fontSize: 12.5, padding: "3px 0" }}>
                      <span className="helptext">{item.material}</span>
                      <span className="mono">
                        {item.quantity} {item.unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: 3D preview or fabrication output */}
            <div>
              <div className="view-toggle" style={{ marginBottom: 10 }}>
                {showWindows && (
                  <button className={view === "building" ? "active" : ""} onClick={() => setView("building")}>
                    Building
                  </button>
                )}
                {showWindows && (
                  <button className={view === "studio" ? "active" : ""} onClick={() => setView("studio")}>
                    Wall studio
                  </button>
                )}
                <button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")}>
                  Roof only
                </button>
                <button className={view === "drawing" ? "active" : ""} onClick={() => setView("drawing")}>
                  2D drawing
                </button>
                {showWindows && (
                  <button className={view === "elevations" ? "active" : ""} onClick={() => setView("elevations")}>
                    Elevations
                  </button>
                )}
                {/* Always clickable -- when nothing's been exported yet this
                    just shows the "run Export CAD" placeholder below rather
                    than being unreachable. */}
                <button className={view === "fabrication" ? "active" : ""} onClick={() => setView("fabrication")}>
                  Fabrication output
                </button>
              </div>

              {view === "studio" && showWindows && (
                <div>
                  <p className="helptext" style={{ marginBottom: 10 }}>
                    Draw the building's walls freeform, at any angle. As soon as one wall exists here, it replaces the
                    roof-derived rectangular box for window placement and the Building view below -- windows get
                    reassigned to a real wall from their card in the list on the left.
                  </p>
                  {loadingWalls ? (
                    <p className="helptext">Loading walls...</p>
                  ) : (
                    <>
                      {polygonRoof ? (
                        <div className="card card-pad" style={{ marginBottom: 10 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Roof over this plan</div>
                          <p className="helptext" style={{ marginBottom: 8 }}>
                            A real roof has been generated directly from the footprint
                            {polygonRoof.roomCount > 1 ? ` (one over each of the ${polygonRoof.roomCount} enclosed areas)` : ""} — hips,
                            ridges and valleys follow the actual wall layout, including non-rectangular shapes.
                          </p>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "2px 16px" }}>
                            {[
                              ["Ridge", polygonRoof.ridgeLengthMm],
                              ["Hips", polygonRoof.hipLengthMm],
                              ["Valleys", polygonRoof.valleyLengthMm],
                            ].map(([label, value]) => (
                              <div key={String(label)} className="field-row" style={{ fontSize: 12.5, padding: "3px 0" }}>
                                <span className="helptext">{label}</span>
                                <span className="mono">{((value as number) / 1000).toFixed(2)} m</span>
                              </div>
                            ))}
                            <div className="field-row" style={{ fontSize: 12.5, padding: "3px 0" }}>
                              <span className="helptext">Roof surface</span>
                              <span className="mono">{(polygonRoof.surfaceAreaMm2 / 1_000_000).toFixed(1)} m²</span>
                            </div>
                          </div>
                          {polygonRoof.warning && (
                            <p className="helptext" style={{ color: "var(--red)", marginTop: 8, marginBottom: 0 }}>
                              {polygonRoof.warning}
                            </p>
                          )}

                          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Bill of materials</div>
                            {polygonRoof.bom.map((line) => (
                              <div key={line.material} className="field-row" style={{ fontSize: 12.5, padding: "3px 0" }}>
                                <span className="helptext">{line.material}</span>
                                <span className="mono">
                                  {line.quantity} {line.unit}
                                </span>
                              </div>
                            ))}
                          </div>

                          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>Cutting schedule</div>
                            <p className="helptext" style={{ fontSize: 11.5, marginBottom: 6 }}>
                              Rafters on a hipped face are jack rafters, so several distinct lengths is expected, not an error.
                            </p>
                            {polygonRoof.members.map((m, i) => (
                              <div key={`${m.role}-${i}`} className="field-row" style={{ fontSize: 12.5, padding: "3px 0" }}>
                                <span className="helptext">
                                  {m.role === "hipRafter" ? "Hip rafter" : m.role === "valleyRafter" ? "Valley rafter" : "Ridge"}
                                </span>
                                <span className="mono">
                                  {m.lengthMm} mm × {m.quantity}
                                </span>
                              </div>
                            ))}
                            {polygonRoof.rafterSchedule.map((entry) => (
                              <div key={entry.lengthMm} className="field-row" style={{ fontSize: 12.5, padding: "3px 0" }}>
                                <span className="helptext">Rafter</span>
                                <span className="mono">
                                  {entry.lengthMm} mm × {entry.quantity}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        roofFit && (
                          <div className="card card-pad" style={{ marginBottom: 10 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Roof over this plan</div>
                            {roofFit.warning ? (
                              <p className="helptext" style={{ color: "var(--red)", marginBottom: 8 }}>
                                {roofFit.warning}
                              </p>
                            ) : (
                              <p className="helptext" style={{ marginBottom: 8 }}>
                                This footprint is rectangular, so a real {roofFit.params.type} roof fits it exactly — rafters and
                                material estimates apply as normal.
                              </p>
                            )}
                            <label className="helptext" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 0 }}>
                              <input type="checkbox" checked={useFittedRoof} onChange={(e) => setUseFittedRoof(e.target.checked)} />
                              Show the fitted {roofFit.params.type} roof in the Building view
                              {roofFit.warning ? " anyway (otherwise a flat placeholder slab is shown)" : ""}
                            </label>
                          </div>
                        )
                      )}
                      <WallStudio2D
                        walls={wallRows.map(wallRowToSegment)}
                        onCreateWall={handleCreateWall}
                        onUpdateWall={handleUpdateWall}
                        onDeleteWall={handleDeleteWall}
                        windowCountByWallId={windowCountByWallId}
                      />
                    </>
                  )}
                </div>
              )}

              {view === "building" && showWindows && (
                <div className="canvas-frame">
                  {buildingScene ? (
                    <RoofViewer geometry={buildingScene.geometry} dimensions={buildingScene.dimensions} boundingSize={buildingBoundingSize} />
                  ) : (
                    <div className="card card-pad">
                      <p className="helptext">
                        {hasFreeformWalls
                          ? "Add at least one window below to see the assembled building."
                          : "Draw walls in the Wall Studio, or add a window below, to see the assembled building."}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {view === "elevations" && showWindows && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {elevationDrawings.map((drawing) => (
                    <div key={drawing.wall.id}>
                      <div className="helptext" style={{ fontWeight: 600, marginBottom: 6, color: "var(--ink)", textTransform: "capitalize" }}>
                        {drawing.wall.id} elevation
                      </div>
                      <Cad2DDrawing
                        heightPx={220}
                        flipY
                        outlines={[
                          { points: drawing.outline },
                          ...drawing.windowOutlines.map((w) => ({ points: w.outline, dashed: w.kind !== "door" })),
                        ]}
                        dims={[
                          { start: { x: 0, y: 0 }, end: { x: drawing.wall.width, y: 0 }, label: "Width", offset: -drawing.wall.height * 0.12 },
                          { start: { x: 0, y: 0 }, end: { x: 0, y: drawing.wall.height }, label: "Height", offset: -drawing.wall.width * 0.12 },
                        ]}
                      />
                      <button
                        onClick={() => handleDownloadElevationDXF(drawing)}
                        className="btn"
                        style={{ marginTop: 8, fontSize: 12.5, padding: "5px 12px" }}
                      >
                        Download elevation DXF
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {roofPreview && (
                <EngineDebugPanel
                  calculations={roofPreview.calculations}
                  bom={roofPreview.bom}
                  members={roofPreview.structure.members}
                  label={`roof · ${roofParams.type}`}
                />
              )}

              {view === "3d" && roofPreview && (
                <div className="canvas-frame">
                  <RoofViewer geometry={roofPreview.geometry} dimensions={roofPreview.dimensions} boundingSize={boundingSize} />
                </div>
              )}

              {view === "drawing" && roofFootprint && (
                <div>
                  <Cad2DDrawing
                    outlines={[
                      { points: roofFootprint.outline },
                      ...(roofFootprint.ridgeLine
                        ? [{ points: [roofFootprint.ridgeLine.start, roofFootprint.ridgeLine.end], closed: false, dashed: true }]
                        : []),
                    ]}
                    dims={(() => {
                      const geo = roofDrawingGeometry();
                      if (!geo) return [];
                      return [
                        { start: { x: geo.minX, y: geo.minY }, end: { x: geo.maxX, y: geo.minY }, label: "Width", offset: -(geo.maxY - geo.minY) * 0.12 },
                        { start: { x: geo.minX, y: geo.minY }, end: { x: geo.minX, y: geo.maxY }, label: "Depth", offset: -(geo.maxX - geo.minX) * 0.12 },
                      ];
                    })()}
                  />
                  <button onClick={handleDownloadRoofDrawingDXF} className="btn" style={{ marginTop: 10, fontSize: 12.5, padding: "5px 12px" }}>
                    Download drawing DXF
                  </button>
                </div>
              )}

              {view === "fabrication" && (
                <div>
                  {linearResult && (
                    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
                      <strong style={{ fontSize: 13.5 }}>Linear cutting plan</strong>
                      <div className="helptext mono" style={{ marginTop: 4 }}>
                        {linearResult.totalStockUnits} stock lengths · {(linearResult.overallUtilization * 100).toFixed(1)}% utilization ·{" "}
                        {(linearResult.totalWasteLength / 1000).toFixed(2)}m waste
                      </div>
                    </div>
                  )}

                  {nestingResult && (
                    <div>
                      <div className="row-between" style={{ marginBottom: 8 }}>
                        <div className="helptext">
                          <strong style={{ color: "var(--ink)" }}>Sheet nesting</strong> — {nestingResult.sheets.length} sheets,{" "}
                          {(nestingResult.overallUtilization * 100).toFixed(1)}% utilization
                          {nestingResult.unplacedPartIds.length > 0 && (
                            <span style={{ color: "var(--red)" }}> · {nestingResult.unplacedPartIds.length} unplaced</span>
                          )}
                        </div>
                        <button onClick={handleDownloadCombinedDXF} className="btn" style={{ fontSize: 12.5, padding: "5px 12px" }}>
                          Download combined DXF (all sheets)
                        </button>
                      </div>
                      {nestingResult.sheets.map((sheet) => (
                        <NestingLayoutSVG key={sheet.sheetIndex} sheet={sheet} parts={allParts} tool={TOOL} />
                      ))}
                    </div>
                  )}

                  {!nestingResult && !linearResult && (
                    <div className="card card-pad">
                      <p className="helptext">Run "Approve & export CAD" to see cut sheets and DXF downloads here.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="row-between" style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            <div className="helptext">
              {roofConfigId ? (
                "Dimensions approved — ready to export CAD."
              ) : (
                <span>
                  <strong style={{ color: "var(--amber)" }}>Not yet approved</strong> — adjust dimensions, then click{" "}
                  <em>Approve dimensions</em> before Export CAD unlocks.
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleApprove} disabled={saving} className="btn primary">
                {saving ? "Saving..." : "Approve dimensions"}
              </button>
              <button onClick={handleExportCAD} disabled={!roofConfigId || nestingRunning} className="btn teal">
                {nestingRunning ? "Exporting..." : "Export CAD"}
              </button>
              <button onClick={handleMarkScheduled} disabled={!nestingResult || scheduling || scheduled} className="btn">
                {scheduled ? "Scheduled ✓" : scheduling ? "Marking..." : "Mark install scheduled"}
              </button>
            </div>
          </div>
        </section>
      )}

      {showWindows && (
        <section>
          <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 10 }}>
            Windows
          </h2>

          {windowPreviews.map(({ row, preview, wall }) => {
            const windowView = windowViews[row.id] ?? "3d";
            const halfW = (row.frame_width_m * 1000) / 2;
            const halfH = (row.frame_height_m * 1000) / 2;

            if (!preview) {
              return (
                <div key={row.id} className="card" style={{ marginBottom: 16, padding: 16 }}>
                  <div className="row-between">
                    <strong style={{ fontSize: 13.5 }}>
                      {row.label ?? row.elevation} — {row.window_style} · {row.frame_width_m}m × {row.frame_height_m}m
                    </strong>
                    <button onClick={() => handleDeleteWindow(row.id)} className="btn" style={{ fontSize: 11.5, padding: "4px 10px" }}>
                      Remove
                    </button>
                  </div>
                  <p className="helptext" style={{ marginTop: 10 }}>
                    Could not preview this window — check its dimensions.
                  </p>
                </div>
              );
            }

            const openingWidth = (preview.calculations.openingWidth as number | undefined) ?? row.frame_width_m * 1000 * 0.8;
            const openingHeight = (preview.calculations.openingHeight as number | undefined) ?? row.frame_height_m * 1000 * 0.8;

            return (
              <div key={row.id} className="card" style={{ marginBottom: 16, padding: 16 }}>
                <div className="row-between" style={{ marginBottom: 10 }}>
                  <strong style={{ fontSize: 13.5 }}>
                    {row.label ?? row.elevation} — {row.window_style} · {row.frame_width_m}m × {row.frame_height_m}m
                  </strong>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div className="view-toggle">
                      <button className={windowView === "3d" ? "active" : ""} onClick={() => setWindowViews((v) => ({ ...v, [row.id]: "3d" }))}>
                        3D
                      </button>
                      <button className={windowView === "drawing" ? "active" : ""} onClick={() => setWindowViews((v) => ({ ...v, [row.id]: "drawing" }))}>
                        2D drawing
                      </button>
                    </div>
                    <button onClick={() => handleDeleteWindow(row.id)} className="btn" style={{ fontSize: 11.5, padding: "4px 10px" }}>
                      Remove
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 16 }}>
                    <div>
                      {windowView === "3d" ? (
                        <div className="canvas-frame" style={{ height: 260 }}>
                          {wall ? (
                            <RoofViewer geometry={wall.geometry} dimensions={wall.dimensions} boundingSize={Math.max(wall.wallWidth, wall.wallHeight) * 1.15} />
                          ) : (
                            <RoofViewer geometry={preview.geometry} dimensions={preview.dimensions} boundingSize={Math.max(row.frame_width_m, row.frame_height_m) * 1000 * 1.6} />
                          )}
                        </div>
                      ) : (
                        <div>
                          <Cad2DDrawing
                            heightPx={260}
                            flipY
                            outlines={[
                              {
                                points: [
                                  { x: -halfW, y: -halfH },
                                  { x: halfW, y: -halfH },
                                  { x: halfW, y: halfH },
                                  { x: -halfW, y: halfH },
                                ],
                              },
                              {
                                points: [
                                  { x: -openingWidth / 2, y: -openingHeight / 2 },
                                  { x: openingWidth / 2, y: -openingHeight / 2 },
                                  { x: openingWidth / 2, y: openingHeight / 2 },
                                  { x: -openingWidth / 2, y: openingHeight / 2 },
                                ],
                                dashed: true,
                              },
                            ]}
                            dims={[
                              { start: { x: -halfW, y: -halfH }, end: { x: halfW, y: -halfH }, label: "Width", offset: -halfH * 0.35 },
                              { start: { x: -halfW, y: -halfH }, end: { x: -halfW, y: halfH }, label: "Height", offset: -halfW * 0.35 },
                            ]}
                          />
                          <button
                            onClick={() => handleDownloadWindowDrawingDXF(row)}
                            className="btn"
                            style={{ marginTop: 10, fontSize: 12.5, padding: "5px 12px" }}
                          >
                            Download drawing DXF
                          </button>
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="helptext" style={{ fontWeight: 600, marginBottom: 6, color: "var(--ink)" }}>
                        Bill of materials
                      </div>
                      {preview.bom.map((item) => (
                        <div key={item.material} className="field-row" style={{ fontSize: 12.5, padding: "3px 0" }}>
                          <span className="helptext">{item.material}</span>
                          <span className="mono">
                            {item.quantity} {item.unit}
                          </span>
                        </div>
                      ))}

                      {effectiveWalls.length > 0 && (() => {
                        const wallKey = hasFreeformWalls ? row.wall_id : isElevation(row.elevation) ? row.elevation : null;
                        const wall = wallKey ? effectiveWalls.find((w) => w.id === wallKey) : null;
                        const draft = positionDraftFor(row);
                        return (
                          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                            <div className="helptext" style={{ fontWeight: 600, marginBottom: 6, color: "var(--ink)" }}>
                              Position on wall
                            </div>
                            {hasFreeformWalls && (
                              <div className="field" style={{ marginBottom: 6 }}>
                                <label>Wall</label>
                                <select
                                  value={row.wall_id ?? ""}
                                  onChange={(e) => {
                                    const wallId = e.target.value || null;
                                    fetch(`/api/projects/${projectId}/elements/${row.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ wallId }),
                                    })
                                      .then((r) => r.json())
                                      .then(({ element }) => element && setWindows((prev) => prev.map((w) => (w.id === row.id ? element : w))));
                                  }}
                                >
                                  <option value="">Unassigned</option>
                                  {freeformWalls.map((w, i) => (
                                    <option key={w.id} value={w.id}>
                                      Wall {i + 1} ({Math.round(w.width)}mm)
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {wall && (
                              <div className="helptext" style={{ fontSize: 11.5, marginBottom: 6 }}>
                                This wall is {Math.round(wall.width)}mm wide.
                              </div>
                            )}
                            <div className="field" style={{ marginBottom: 6 }}>
                              <label>Offset from left (mm)</label>
                              <input
                                type="number"
                                className="mono-input"
                                placeholder="auto (centered)"
                                value={draft.offsetMm}
                                onChange={(e) =>
                                  setPositionDrafts((prev) => ({ ...prev, [row.id]: { ...draft, offsetMm: e.target.value } }))
                                }
                              />
                            </div>
                            <div className="field" style={{ marginBottom: 6 }}>
                              <label>Sill height (mm)</label>
                              <input
                                type="number"
                                className="mono-input"
                                placeholder={`auto (${DEFAULT_SILL_HEIGHT_MM}mm)`}
                                value={draft.sillHeightMm}
                                onChange={(e) =>
                                  setPositionDrafts((prev) => ({ ...prev, [row.id]: { ...draft, sillHeightMm: e.target.value } }))
                                }
                              />
                            </div>
                            <button
                              onClick={() => handleSavePosition(row)}
                              disabled={savingPosition === row.id}
                              className="btn"
                              style={{ fontSize: 12, padding: "4px 10px" }}
                            >
                              {savingPosition === row.id ? "Saving..." : "Save position"}
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                </div>
              </div>
            );
          })}

          <div className="card card-pad" style={{ marginBottom: 8 }}>
            <div className="helptext" style={{ fontWeight: 600, marginBottom: 10, color: "var(--ink)" }}>
              Add a window
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
              {hasFreeformWalls ? (
                <div className="field">
                  <label>Wall</label>
                  <select value={newWindow.wallId} onChange={(e) => setNewWindow({ ...newWindow, wallId: e.target.value })}>
                    <option value="">Select a wall...</option>
                    {freeformWalls.map((w, i) => (
                      <option key={w.id} value={w.id}>
                        Wall {i + 1} ({Math.round(w.width)}mm)
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="field">
                  <label>Elevation</label>
                  <select value={newWindow.elevation} onChange={(e) => setNewWindow({ ...newWindow, elevation: e.target.value })}>
                    {["north", "south", "east", "west"].map((el) => (
                      <option key={el} value={el}>
                        {el[0].toUpperCase() + el.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label>Style</label>
                <select
                  value={newWindow.windowStyle}
                  onChange={(e) => setNewWindow({ ...newWindow, windowStyle: e.target.value as WindowElementRow["window_style"] })}
                >
                  {(["casement", "sliding", "picture", "bay", "awning"] as const).map((s) => (
                    <option key={s} value={s}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Width (m)</label>
                <input
                  type="number"
                  className="mono-input"
                  step={0.1}
                  min={0.2}
                  value={newWindow.frameWidthM}
                  onChange={(e) => setNewWindow({ ...newWindow, frameWidthM: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label>Height (m)</label>
                <input
                  type="number"
                  className="mono-input"
                  step={0.1}
                  min={0.2}
                  value={newWindow.frameHeightM}
                  onChange={(e) => setNewWindow({ ...newWindow, frameHeightM: Number(e.target.value) })}
                />
              </div>
              {(showRoof || hasFreeformWalls) && (
                <>
                  <div className="field">
                    <label>Offset from left (mm)</label>
                    <input
                      type="number"
                      className="mono-input"
                      placeholder="auto (centered)"
                      value={newWindow.offsetMm}
                      onChange={(e) => setNewWindow({ ...newWindow, offsetMm: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Sill height (mm)</label>
                    <input
                      type="number"
                      className="mono-input"
                      placeholder={`auto (${DEFAULT_SILL_HEIGHT_MM}mm)`}
                      value={newWindow.sillHeightMm}
                      onChange={(e) => setNewWindow({ ...newWindow, sillHeightMm: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>
            <button onClick={handleAddWindow} disabled={addingWindow} className="btn primary">
              {addingWindow ? "Adding..." : "Add window"}
            </button>
          </div>
        </section>
      )}

      {showWindows && (
        <section>
          <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 10 }}>
            Doors
          </h2>

          {doorPreviews.map(({ row, preview }) => {
            const doorView = doorViews[row.id] ?? "3d";
            const halfW = (row.frame_width_m * 1000) / 2;
            const halfH = (row.frame_height_m * 1000) / 2;

            if (!preview) {
              return (
                <div key={row.id} className="card" style={{ marginBottom: 16, padding: 16 }}>
                  <div className="row-between">
                    <strong style={{ fontSize: 13.5 }}>
                      {row.label ?? row.elevation} — {row.door_type} · {row.frame_width_m}m × {row.frame_height_m}m
                    </strong>
                    <button onClick={() => handleDeleteDoor(row.id)} className="btn" style={{ fontSize: 11.5, padding: "4px 10px" }}>
                      Remove
                    </button>
                  </div>
                  <p className="helptext" style={{ marginTop: 10 }}>
                    Could not preview this door — check its dimensions.
                  </p>
                </div>
              );
            }

            return (
              <div key={row.id} className="card" style={{ marginBottom: 16, padding: 16 }}>
                <div className="row-between" style={{ marginBottom: 10 }}>
                  <strong style={{ fontSize: 13.5 }}>
                    {row.label ?? row.elevation} — {row.door_type} · {row.frame_width_m}m × {row.frame_height_m}m
                  </strong>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div className="view-toggle">
                      <button className={doorView === "3d" ? "active" : ""} onClick={() => setDoorViews((v) => ({ ...v, [row.id]: "3d" }))}>
                        3D
                      </button>
                      <button className={doorView === "drawing" ? "active" : ""} onClick={() => setDoorViews((v) => ({ ...v, [row.id]: "drawing" }))}>
                        2D drawing
                      </button>
                    </div>
                    <button onClick={() => handleDeleteDoor(row.id)} className="btn" style={{ fontSize: 11.5, padding: "4px 10px" }}>
                      Remove
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 16 }}>
                    <div>
                      {doorView === "3d" ? (
                        <div className="canvas-frame" style={{ height: 260 }}>
                          <RoofViewer geometry={preview.geometry} dimensions={preview.dimensions} boundingSize={Math.max(row.frame_width_m, row.frame_height_m) * 1000 * 1.6} />
                        </div>
                      ) : (
                        <div>
                          <Cad2DDrawing
                            heightPx={260}
                            flipY
                            outlines={[
                              {
                                points: [
                                  { x: -halfW, y: -halfH },
                                  { x: halfW, y: -halfH },
                                  { x: halfW, y: halfH },
                                  { x: -halfW, y: halfH },
                                ],
                              },
                            ]}
                            dims={[
                              { start: { x: -halfW, y: -halfH }, end: { x: halfW, y: -halfH }, label: "Width", offset: -halfH * 0.35 },
                              { start: { x: -halfW, y: -halfH }, end: { x: -halfW, y: halfH }, label: "Height", offset: -halfW * 0.35 },
                            ]}
                          />
                          <button
                            onClick={() => handleDownloadDoorDrawingDXF(row)}
                            className="btn"
                            style={{ marginTop: 10, fontSize: 12.5, padding: "5px 12px" }}
                          >
                            Download drawing DXF
                          </button>
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="helptext" style={{ fontWeight: 600, marginBottom: 6, color: "var(--ink)" }}>
                        Bill of materials
                      </div>
                      {preview.bom.map((item) => (
                        <div key={item.material} className="field-row" style={{ fontSize: 12.5, padding: "3px 0" }}>
                          <span className="helptext">{item.material}</span>
                          <span className="mono">
                            {item.quantity} {item.unit}
                          </span>
                        </div>
                      ))}

                      {effectiveWalls.length > 0 && (() => {
                        const wallKey = hasFreeformWalls ? row.wall_id : isElevation(row.elevation) ? row.elevation : null;
                        const wall = wallKey ? effectiveWalls.find((w) => w.id === wallKey) : null;
                        const draft = doorPositionDraftFor(row);
                        return (
                          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                            <div className="helptext" style={{ fontWeight: 600, marginBottom: 6, color: "var(--ink)" }}>
                              Position on wall
                            </div>
                            {hasFreeformWalls && (
                              <div className="field" style={{ marginBottom: 6 }}>
                                <label>Wall</label>
                                <select
                                  value={row.wall_id ?? ""}
                                  onChange={(e) => {
                                    const wallId = e.target.value || null;
                                    fetch(`/api/projects/${projectId}/elements/${row.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ wallId }),
                                    })
                                      .then((r) => r.json())
                                      .then(({ element }) => element && setDoors((prev) => prev.map((d) => (d.id === row.id ? element : d))));
                                  }}
                                >
                                  <option value="">Unassigned</option>
                                  {freeformWalls.map((w, i) => (
                                    <option key={w.id} value={w.id}>
                                      Wall {i + 1} ({Math.round(w.width)}mm)
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {wall && (
                              <div className="helptext" style={{ fontSize: 11.5, marginBottom: 6 }}>
                                This wall is {Math.round(wall.width)}mm wide.
                              </div>
                            )}
                            <div className="field" style={{ marginBottom: 6 }}>
                              <label>Offset from left (mm)</label>
                              <input
                                type="number"
                                className="mono-input"
                                placeholder="auto (centered)"
                                value={draft.offsetMm}
                                onChange={(e) =>
                                  setPositionDrafts((prev) => ({ ...prev, [row.id]: { ...draft, offsetMm: e.target.value } }))
                                }
                              />
                            </div>
                            <p className="helptext" style={{ fontSize: 11, marginBottom: 6 }}>
                              Doors always sit at floor level -- no sill height to set.
                            </p>
                            <button
                              onClick={() => handleSaveDoorPosition(row)}
                              disabled={savingPosition === row.id}
                              className="btn"
                              style={{ fontSize: 12, padding: "4px 10px" }}
                            >
                              {savingPosition === row.id ? "Saving..." : "Save position"}
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                </div>
              </div>
            );
          })}

          <div className="card card-pad" style={{ marginBottom: 8 }}>
            <div className="helptext" style={{ fontWeight: 600, marginBottom: 10, color: "var(--ink)" }}>
              Add a door
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
              {hasFreeformWalls ? (
                <div className="field">
                  <label>Wall</label>
                  <select value={newDoor.wallId} onChange={(e) => setNewDoor({ ...newDoor, wallId: e.target.value })}>
                    <option value="">Select a wall...</option>
                    {freeformWalls.map((w, i) => (
                      <option key={w.id} value={w.id}>
                        Wall {i + 1} ({Math.round(w.width)}mm)
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="field">
                  <label>Elevation</label>
                  <select value={newDoor.elevation} onChange={(e) => setNewDoor({ ...newDoor, elevation: e.target.value })}>
                    {["north", "south", "east", "west"].map((el) => (
                      <option key={el} value={el}>
                        {el[0].toUpperCase() + el.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label>Type</label>
                <select value={newDoor.doorType} onChange={(e) => setNewDoor({ ...newDoor, doorType: e.target.value as DoorElementRow["door_type"] })}>
                  {(["single", "double", "sliding"] as const).map((s) => (
                    <option key={s} value={s}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Width (m)</label>
                <input
                  type="number"
                  className="mono-input"
                  step={0.1}
                  min={0.6}
                  value={newDoor.frameWidthM}
                  onChange={(e) => setNewDoor({ ...newDoor, frameWidthM: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label>Height (m)</label>
                <input
                  type="number"
                  className="mono-input"
                  step={0.1}
                  min={1.8}
                  value={newDoor.frameHeightM}
                  onChange={(e) => setNewDoor({ ...newDoor, frameHeightM: Number(e.target.value) })}
                />
              </div>
              {(showRoof || hasFreeformWalls) && (
                <div className="field">
                  <label>Offset from left (mm)</label>
                  <input
                    type="number"
                    className="mono-input"
                    placeholder="auto (centered)"
                    value={newDoor.offsetMm}
                    onChange={(e) => setNewDoor({ ...newDoor, offsetMm: e.target.value })}
                  />
                </div>
              )}
            </div>
            <button onClick={handleAddDoor} disabled={addingDoor} className="btn primary">
              {addingDoor ? "Adding..." : "Add door"}
            </button>
          </div>
        </section>
      )}

      {/* Council/planning approval via AI4Planning - shown once the roof
          has been approved at least once, since submitting with nothing
          saved yet wouldn't have anything meaningful to send. Entirely
          optional: not every job needs planning permission, so this never
          blocks Export CAD or Mark install scheduled above. */}
      {roofConfigId && (
        <div className="card card-pad" style={{ marginTop: 24 }}>
          <div className="row-between" style={{ marginBottom: councilSubmission ? 10 : 0 }}>
            <div>
              <h2 style={{ fontSize: 14, marginBottom: 4 }}>Council / planning approval</h2>
              <p className="helptext">Optional — submit to AI4Planning if this job needs planning permission.</p>
            </div>
            <button onClick={handleSubmitToCouncil} disabled={submittingToCouncil} className="btn primary">
              {submittingToCouncil
                ? "Submitting…"
                : councilSubmission
                  ? "Resubmit"
                  : "Submit for council approval"}
            </button>
          </div>

          {councilSubmission && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 12.5,
                background:
                  councilSubmission.status === "approved"
                    ? "var(--teal-dim)"
                    : councilSubmission.status === "rejected"
                      ? "var(--red-dim)"
                      : "var(--amber-dim)",
                color:
                  councilSubmission.status === "approved"
                    ? "#0B4E4F"
                    : councilSubmission.status === "rejected"
                      ? "#7A2D20"
                      : "#7A5A1A",
              }}
            >
              <strong style={{ textTransform: "capitalize" }}>{councilSubmission.status}</strong>
              {councilSubmission.decision_notes && ` — ${councilSubmission.decision_notes}`}
              <span className="helptext" style={{ marginLeft: 8 }}>
                {new Date(councilSubmission.submitted_at).toLocaleDateString()}
              </span>
            </div>
          )}

          <p className="helptext" style={{ marginTop: 10 }}>
            Not connected yet? Configure this in{" "}
            <a href="/settings/integrations/ai4planning" style={{ color: "var(--teal)" }}>
              Settings → Integrations → AI4Planning
            </a>
            .
          </p>
        </div>
      )}

      {/* Combined project BOM -- every material across roof + all windows,
          merged by material+unit. This is always the FULL current set of
          components on the project; nothing is manually "selected" into
          it. */}
      {(roofPreview || windowPreviews.length > 0) && combinedBOM.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 14, marginBottom: 10 }}>Project bill of materials</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {combinedBOM.map((item) => (
                <tr key={`${item.material}-${item.unit}`} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 0", color: "var(--muted)" }}>{item.material}</td>
                  <td style={{ padding: "6px 0", textAlign: "right" }} className="mono">
                    {item.quantity} {item.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ParamFields({ params, onChange }: { params: RoofParams; onChange: (key: string, value: number) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {params.type === "gable" && (
        <>
          <NumField label="Span (mm)" value={params.span} onChange={(v) => onChange("span", v)} min={1000} />
          <NumField label="Ridge length (mm)" value={params.ridgeLength} onChange={(v) => onChange("ridgeLength", v)} min={1000} />
        </>
      )}
      {(params.type === "hip" || params.type === "shed") && (
        <>
          <NumField label="Width (mm)" value={params.width} onChange={(v) => onChange("width", v)} min={1000} />
          <NumField label="Length (mm)" value={params.length} onChange={(v) => onChange("length", v)} min={1000} />
        </>
      )}
      <NumField label="Pitch (°)" value={params.pitch} onChange={(v) => onChange("pitch", v)} step={1} min={5} max={75} />
      <NumField label="Eave height (mm)" value={params.eaveHeight} onChange={(v) => onChange("eaveHeight", v)} min={1800} />
      <NumField label="Overhang (mm)" value={params.overhang} onChange={(v) => onChange("overhang", v)} step={50} min={0} />
      <NumField label="Sheathing thickness (mm)" value={params.thickness} onChange={(v) => onChange("thickness", v)} step={1} min={6} />
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 100,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        className="mono-input"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        onBlur={(e) => {
          // Clamp only once typing is finished - clamping on every
          // keystroke would make it impossible to type "1200" when min is
          // 1000 (each partial digit would snap back to 1000 mid-type).
          const raw = Number(e.target.value);
          if (Number.isNaN(raw)) return;
          let v = raw;
          if (min !== undefined) v = Math.max(min, v);
          if (max !== undefined) v = Math.min(max, v);
          if (v !== raw) onChange(v);
        }}
      />
    </div>
  );
}
