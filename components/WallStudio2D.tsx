"use client";

import { useMemo, useRef, useState } from "react";
import type { WallSegment } from "@/lib/parametric-engine/types";
import { detectRooms, roomLabelPoint, formatRoomArea } from "@/lib/parametric-engine/core/detectRooms";

interface Point2D {
  x: number;
  y: number;
}

interface WallStudio2DProps {
  walls: WallSegment[];
  // Returns whether the wall was actually saved -- the studio needs this to
  // decide whether to chain to the next point (see handleBackgroundClick):
  // silently chaining after a failed save is what made a failed wall look
  // like it "disappeared" instead of showing an error.
  onCreateWall: (start: Point2D, end: Point2D) => Promise<boolean>;
  onUpdateWall: (id: string, patch: Partial<{ start: Point2D; end: Point2D; thicknessMm: number; heightMm: number }>) => void | Promise<void>;
  onDeleteWall: (id: string) => void | Promise<void>;
  /** How many windows are currently placed on each wall id -- used to warn
   *  before a delete silently unassigns them (the FK is ON DELETE SET NULL,
   *  so the windows survive but lose their placement). */
  windowCountByWallId?: Record<string, number>;
  heightPx?: number;
}

const GRID_STEP_MM = 250;
const SNAP_ENDPOINT_MM = 200; // how close a click/drag needs to be to an existing endpoint to join it
const PADDING_MM = 1500;
const DEFAULT_EXTENT_MM = 4000; // half-extent of the empty-canvas default viewBox

/** A floor plan image traced behind the walls. `widthMm` is what the
 *  image's full pixel width represents in real millimetres, derived from
 *  the calibration step (click two points on a known dimension, type that
 *  dimension) -- without it an imported image has no scale and tracing over
 *  it would produce walls of meaningless size. */
export interface BackgroundImage {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  widthMm: number;
  opacity: number;
}

/**
 * A minimal freeform wall-drawing tool -- draw new walls by clicking two
 * points (chained, like most CAD polyline tools: the end of one wall
 * becomes the start of the next until you hit Escape or the Finish
 * button), drag any endpoint to move it, and any OTHER wall's endpoint
 * within SNAP_ENDPOINT_MM comes along for the ride -- that's what makes
 * corners "joined" the way OpenPlan3D's wall properties panel describes,
 * without needing a separate shared-vertex data model: it's just wall
 * segments whose endpoints happen to coincide.
 */
export function WallStudio2D({ walls, onCreateWall, onUpdateWall, onDeleteWall, windowCountByWallId = {}, heightPx = 420 }: WallStudio2DProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<"draw" | "select">(walls.length === 0 ? "draw" : "select");
  const [pendingStart, setPendingStart] = useState<Point2D | null>(null);
  const [cursor, setCursor] = useState<Point2D | null>(null);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ targets: { wallId: string; corner: "start" | "end" }[]; live: Point2D } | null>(null);
  const [editDraft, setEditDraft] = useState<{ thicknessMm: string; heightMm: string } | null>(null);
  // Shown right on the canvas, separate from any page-level error banner --
  // a banner at the top of a long page is easy to miss while your eyes are
  // on the drawing surface, which is exactly what made a failed save look
  // like the wall silently vanished.
  const [drawError, setDrawError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Set when a delete would orphan windows -- the delete only goes through
  // on a second, explicit confirm (see the properties panel below).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // --- Floor plan tracing ---------------------------------------------
  // An uploaded plan image is held in component state as a data URL only:
  // it's a tracing aid, not project data, so it deliberately isn't
  // persisted to Supabase (that would need a storage bucket + its own RLS
  // policy). Reloading the page clears it; the walls traced from it are
  // what actually get saved.
  const [bgImage, setBgImage] = useState<BackgroundImage | null>(null);
  // Two-click scale calibration: without this an image has no real-world
  // size and any wall traced over it would be arbitrary.
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<Point2D[]>([]);
  const [knownDistanceMm, setKnownDistanceMm] = useState("5000");

  // Closed loops in the current wall network, with floor areas.
  const rooms = useMemo(() => detectRooms(walls), [walls]);

  const bounds = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const w of walls) {
      xs.push(w.start.x, w.end.x);
      ys.push(w.start.y, w.end.y);
    }
    // Include the traced image, or it'd sit outside the view whenever there
    // are no walls yet -- which is exactly when you need to see it.
    if (bgImage) {
      xs.push(0, bgImage.widthMm);
      ys.push(0, (bgImage.widthMm * bgImage.naturalHeight) / bgImage.naturalWidth);
    }
    if (xs.length === 0) {
      return { minX: -DEFAULT_EXTENT_MM, maxX: DEFAULT_EXTENT_MM, minY: -DEFAULT_EXTENT_MM, maxY: DEFAULT_EXTENT_MM };
    }
    return {
      minX: Math.min(...xs) - PADDING_MM,
      maxX: Math.max(...xs) + PADDING_MM,
      minY: Math.min(...ys) - PADDING_MM,
      maxY: Math.max(...ys) + PADDING_MM,
    };
  }, [walls, bgImage]);

  const viewBox = `${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`;

  function toSvgPoint(evt: React.MouseEvent): Point2D | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function snap(point: Point2D, excludeWallId?: string): Point2D {
    // Snap to any other wall's endpoint first (joins corners); otherwise
    // fall back to the grid, so freehand points still land on round numbers.
    let best: Point2D | null = null;
    let bestDist = SNAP_ENDPOINT_MM;
    for (const w of walls) {
      if (w.id === excludeWallId) continue;
      for (const candidate of [w.start, w.end]) {
        const d = Math.hypot(candidate.x - point.x, candidate.y - point.y);
        if (d < bestDist) {
          bestDist = d;
          best = candidate;
        }
      }
    }
    if (best) return best;
    return { x: Math.round(point.x / GRID_STEP_MM) * GRID_STEP_MM, y: Math.round(point.y / GRID_STEP_MM) * GRID_STEP_MM };
  }

  function handleImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onload = () => {
        // Start with a guess: assume the image spans roughly 10m. The
        // calibration step below replaces this with a real measurement --
        // this is just so the image is visible and clickable in the
        // meantime rather than being zero-sized.
        setBgImage({ src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, widthMm: 10000, opacity: 0.5 });
        setCalibrating(true);
        setCalibrationPoints([]);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  /** Rescales the image so the two clicked points end up exactly
   *  `knownDistanceMm` apart in world units. */
  function applyCalibration() {
    if (!bgImage || calibrationPoints.length !== 2) return;
    const known = Number(knownDistanceMm);
    if (!Number.isFinite(known) || known <= 0) return;
    const measured = Math.hypot(
      calibrationPoints[1].x - calibrationPoints[0].x,
      calibrationPoints[1].y - calibrationPoints[0].y
    );
    if (measured <= 0) return;
    setBgImage({ ...bgImage, widthMm: bgImage.widthMm * (known / measured) });
    setCalibrating(false);
    setCalibrationPoints([]);
  }

  async function handleBackgroundClick(evt: React.MouseEvent) {
    const point = toSvgPoint(evt);
    if (!point) return;
    // Calibration takes over clicks entirely while active -- the two
    // points are raw (unsnapped) since they're measuring the image, not
    // placing geometry on the grid.
    if (calibrating) {
      setCalibrationPoints((prev) => (prev.length >= 2 ? [point] : [...prev, point]));
      return;
    }
    if (mode !== "draw") {
      setSelectedWallId(null);
      return;
    }
    const snapped = snap(point);
    if (!pendingStart) {
      setDrawError(null);
      setPendingStart(snapped);
      return;
    }
    if (snapped.x === pendingStart.x && snapped.y === pendingStart.y) return; // zero-length, ignore
    if (creating) return; // ignore rapid double-clicks while a save is in flight
    setCreating(true);
    setDrawError(null);
    const start = pendingStart;
    try {
      const ok = await onCreateWall(start, snapped);
      if (ok) {
        setPendingStart(snapped); // chain: next wall starts where this one ended
      } else {
        // Don't chain past a failed save -- leave pendingStart where it was
        // so the attempted wall is still visible as a dashed preview and
        // the person can see exactly what didn't save, instead of the
        // start point silently jumping forward.
        setDrawError("That wall didn't save. Check the error above and try again.");
      }
    } catch {
      setDrawError("That wall didn't save. Check the error above and try again.");
    } finally {
      setCreating(false);
    }
  }

  function handleMouseMove(evt: React.MouseEvent) {
    const point = toSvgPoint(evt);
    if (!point) return;
    if (drag) {
      const snapped = snap(point);
      setDrag({ ...drag, live: snapped });
      return;
    }
    if (mode === "draw" && pendingStart) setCursor(snap(point));
  }

  function startDrag(wallId: string, corner: "start" | "end", evt: React.MouseEvent) {
    evt.stopPropagation();
    if (mode !== "select") return;
    const wall = walls.find((w) => w.id === wallId);
    if (!wall) return;
    const originalPoint = corner === "start" ? wall.start : wall.end;
    // Every OTHER wall endpoint that currently coincides with this one moves together.
    const targets: { wallId: string; corner: "start" | "end" }[] = [{ wallId, corner }];
    for (const w of walls) {
      if (w.id === wallId) continue;
      if (Math.hypot(w.start.x - originalPoint.x, w.start.y - originalPoint.y) < 1) targets.push({ wallId: w.id, corner: "start" });
      if (Math.hypot(w.end.x - originalPoint.x, w.end.y - originalPoint.y) < 1) targets.push({ wallId: w.id, corner: "end" });
    }
    setDrag({ targets, live: originalPoint });
  }

  function endDrag() {
    if (!drag) return;
    for (const t of drag.targets) {
      onUpdateWall(t.wallId, t.corner === "start" ? { start: drag.live } : { end: drag.live });
    }
    setDrag(null);
  }

  function selectWall(wall: WallSegment, evt: React.MouseEvent) {
    evt.stopPropagation();
    if (mode !== "select") return;
    setSelectedWallId(wall.id);
    setEditDraft({ thicknessMm: String(wall.thicknessMm), heightMm: String(wall.heightMm) });
  }

  function effectivePoint(wall: WallSegment, corner: "start" | "end"): Point2D {
    if (drag) {
      const hit = drag.targets.find((t) => t.wallId === wall.id && t.corner === corner);
      if (hit) return drag.live;
    }
    return corner === "start" ? wall.start : wall.end;
  }

  const selectedWall = walls.find((w) => w.id === selectedWallId) ?? null;

  function saveEditDraft() {
    if (!selectedWall || !editDraft) return;
    const thicknessMm = Number(editDraft.thicknessMm);
    const heightMm = Number(editDraft.heightMm);
    if (Number.isNaN(thicknessMm) || Number.isNaN(heightMm) || thicknessMm <= 0 || heightMm <= 0) return;
    onUpdateWall(selectedWall.id, { thicknessMm, heightMm });
  }

  // Grid lines across the current viewBox, spaced GRID_STEP_MM apart.
  const gridLines = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const startX = Math.floor(bounds.minX / GRID_STEP_MM) * GRID_STEP_MM;
    for (let x = startX; x <= bounds.maxX; x += GRID_STEP_MM) {
      lines.push({ x1: x, y1: bounds.minY, x2: x, y2: bounds.maxY });
    }
    const startY = Math.floor(bounds.minY / GRID_STEP_MM) * GRID_STEP_MM;
    for (let y = startY; y <= bounds.maxY; y += GRID_STEP_MM) {
      lines.push({ x1: bounds.minX, y1: y, x2: bounds.maxX, y2: y });
    }
    return lines;
  }, [bounds]);

  const strokeScale = (bounds.maxX - bounds.minX) / 900; // keeps stroke widths visually consistent regardless of viewBox size

  return (
    <div>
      <div className="view-toggle" style={{ marginBottom: 8 }}>
        <button
          className={mode === "draw" ? "active" : ""}
          onClick={() => {
            setMode("draw");
            setSelectedWallId(null);
          }}
        >
          Draw wall
        </button>
        <button
          className={mode === "select" ? "active" : ""}
          onClick={() => {
            setMode("select");
            setPendingStart(null);
          }}
        >
          Select / edit
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <label className="btn" style={{ fontSize: 12, padding: "4px 10px", cursor: "pointer", marginBottom: 0 }}>
          {bgImage ? "Replace floor plan" : "Import floor plan"}
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageFile(file);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
        </label>
        {bgImage && (
          <>
            <button className="btn" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => { setCalibrating(true); setCalibrationPoints([]); }}>
              Set scale
            </button>
            <label className="helptext" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 0 }}>
              Opacity
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={bgImage.opacity}
                onChange={(e) => setBgImage({ ...bgImage, opacity: Number(e.target.value) })}
              />
            </label>
            <button className="btn" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => { setBgImage(null); setCalibrating(false); setCalibrationPoints([]); }}>
              Remove
            </button>
          </>
        )}
      </div>

      {calibrating && (
        <div className="card card-pad" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Set the plan's scale</div>
          <p className="helptext" style={{ marginBottom: 8 }}>
            Click two points on the image a known distance apart (a dimensioned wall works best), then enter that real
            distance. Until this is set, anything traced over the image won't be the right size.
            {` ${calibrationPoints.length}/2 points placed.`}
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Real distance (mm)</label>
              <input type="number" className="mono-input" value={knownDistanceMm} onChange={(e) => setKnownDistanceMm(e.target.value)} />
            </div>
            <button className="btn primary" disabled={calibrationPoints.length !== 2} onClick={applyCalibration}>
              Apply scale
            </button>
            <button className="btn" onClick={() => { setCalibrating(false); setCalibrationPoints([]); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {mode === "draw" && (
        <div className="helptext" style={{ marginBottom: 8 }}>
          {creating
            ? "Saving..."
            : pendingStart
              ? "Click to place the wall's end point (snaps to the grid or nearby corners). Press Escape or Finish to stop."
              : "Click to start a wall."}
          {pendingStart && !creating && (
            <button className="btn" style={{ marginLeft: 10, fontSize: 12, padding: "3px 9px" }} onClick={() => setPendingStart(null)}>
              Finish
            </button>
          )}
          {drawError && (
            <div style={{ color: "var(--red, #b91c1c)", marginTop: 6 }}>{drawError}</div>
          )}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={viewBox}
        style={{ width: "100%", height: heightPx, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, cursor: mode === "draw" ? "crosshair" : "default" }}
        onClick={handleBackgroundClick}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onKeyDown={(e) => {
          if (e.key === "Escape") setPendingStart(null);
        }}
        tabIndex={0}
      >
        {gridLines.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="var(--line)" strokeWidth={strokeScale * 0.6} />
        ))}

        {bgImage && (
          <image
            href={bgImage.src}
            x={0}
            y={0}
            width={bgImage.widthMm}
            height={(bgImage.widthMm * bgImage.naturalHeight) / bgImage.naturalWidth}
            opacity={bgImage.opacity}
            preserveAspectRatio="xMinYMin meet"
            pointerEvents="none"
          />
        )}

        {calibrationPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={strokeScale * 5} fill="var(--red)" pointerEvents="none" />
        ))}
        {calibrationPoints.length === 2 && (
          <line
            x1={calibrationPoints[0].x}
            y1={calibrationPoints[0].y}
            x2={calibrationPoints[1].x}
            y2={calibrationPoints[1].y}
            stroke="var(--red)"
            strokeWidth={strokeScale * 2}
            pointerEvents="none"
          />
        )}

        {rooms.map((room, i) => {
          const label = roomLabelPoint(room);
          return (
            <g key={room.wallIds.join("-")} pointerEvents="none">
              <polygon points={room.outline.map((p) => `${p.x},${p.y}`).join(" ")} fill="var(--teal)" opacity={0.08} />
              <text x={label.x} y={label.y} textAnchor="middle" fill="var(--muted)" fontSize={strokeScale * 14} fontWeight={600}>
                Room {i + 1} ({formatRoomArea(room.areaMm2)})
              </text>
            </g>
          );
        })}

        {walls.map((wall) => {
          const start = effectivePoint(wall, "start");
          const end = effectivePoint(wall, "end");
          const isSelected = wall.id === selectedWallId;
          return (
            <g key={wall.id}>
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={isSelected ? "var(--teal)" : "var(--ink)"}
                strokeWidth={Math.max(wall.thicknessMm * 0.6, strokeScale * 3)}
                strokeLinecap="square"
                onClick={(e) => selectWall(wall, e)}
                style={{ cursor: mode === "select" ? "pointer" : "default" }}
              />
              {mode === "select" && (
                <>
                  <circle cx={start.x} cy={start.y} r={strokeScale * 6} fill="var(--panel)" stroke="var(--ink)" strokeWidth={strokeScale} onMouseDown={(e) => startDrag(wall.id, "start", e)} style={{ cursor: "grab" }} />
                  <circle cx={end.x} cy={end.y} r={strokeScale * 6} fill="var(--panel)" stroke="var(--ink)" strokeWidth={strokeScale} onMouseDown={(e) => startDrag(wall.id, "end", e)} style={{ cursor: "grab" }} />
                </>
              )}
            </g>
          );
        })}

        {mode === "draw" && pendingStart && (
          <>
            <circle cx={pendingStart.x} cy={pendingStart.y} r={strokeScale * 5} fill="var(--teal)" />
            {cursor && <line x1={pendingStart.x} y1={pendingStart.y} x2={cursor.x} y2={cursor.y} stroke="var(--teal)" strokeWidth={strokeScale * 2} strokeDasharray={`${strokeScale * 8} ${strokeScale * 6}`} />}
          </>
        )}
      </svg>

      {selectedWall && editDraft && (
        <div className="card card-pad" style={{ marginTop: 10 }}>
          <div className="helptext" style={{ fontWeight: 600, marginBottom: 8, color: "var(--ink)" }}>
            Wall properties
          </div>
          <div className="helptext" style={{ marginBottom: 8 }}>
            Length: {Math.round(Math.hypot(selectedWall.end.x - selectedWall.start.x, selectedWall.end.y - selectedWall.start.y))}mm
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Thickness (mm)</label>
              <input type="number" className="mono-input" value={editDraft.thicknessMm} onChange={(e) => setEditDraft({ ...editDraft, thicknessMm: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Height (mm)</label>
              <input type="number" className="mono-input" value={editDraft.heightMm} onChange={(e) => setEditDraft({ ...editDraft, heightMm: e.target.value })} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" onClick={saveEditDraft}>
              Save
            </button>
            {(() => {
              const attached = windowCountByWallId[selectedWall.id] ?? 0;
              const armed = pendingDeleteId === selectedWall.id;
              if (attached > 0 && !armed) {
                return (
                  <button className="btn" onClick={() => setPendingDeleteId(selectedWall.id)}>
                    Delete wall
                  </button>
                );
              }
              return (
                <button
                  className="btn"
                  style={armed ? { color: "var(--red)", borderColor: "var(--red)" } : undefined}
                  onClick={() => {
                    onDeleteWall(selectedWall.id);
                    setSelectedWallId(null);
                    setPendingDeleteId(null);
                  }}
                >
                  {armed ? "Confirm delete" : "Delete wall"}
                </button>
              );
            })()}
            {pendingDeleteId === selectedWall.id && (
              <button className="btn" onClick={() => setPendingDeleteId(null)}>
                Cancel
              </button>
            )}
          </div>
          {pendingDeleteId === selectedWall.id && (
            <p className="helptext" style={{ color: "var(--red)", marginTop: 8, marginBottom: 0 }}>
              {windowCountByWallId[selectedWall.id]} window
              {(windowCountByWallId[selectedWall.id] ?? 0) === 1 ? " is" : "s are"} placed on this wall. Deleting it keeps
              {(windowCountByWallId[selectedWall.id] ?? 0) === 1 ? " that window" : " those windows"} but unassigns
              {(windowCountByWallId[selectedWall.id] ?? 0) === 1 ? " it" : " them"} — you'll need to pick a new wall for
              {(windowCountByWallId[selectedWall.id] ?? 0) === 1 ? " it" : " each"} afterwards.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
