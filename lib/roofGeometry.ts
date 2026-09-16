export type RoofType = "gable" | "hip" | "shed" | "gambrel";

export interface RoofDimensions {
  roofType: RoofType;
  spanM: number; // width of the building, eave to eave
  ridgeLengthM: number; // length of the ridge (building depth for a gable)
  pitchDeg: number; // roof pitch in degrees from horizontal
}

export interface RoofCrossSection {
  /** Half-span from the centerline to the eave, in meters */
  halfSpan: number;
  /** Vertical rise from eave height to ridge, in meters */
  rise: number;
  /** Sloped rafter length from eave to ridge, in meters */
  rafterLength: number;
  /** Roof surface area, both slopes, in square meters (gable/hip only) */
  areaM2: number;
}

const clampPitch = (deg: number) => Math.min(Math.max(deg, 1), 89);

/**
 * Core trig shared by the 2D and 3D renderers. Keep this the single source
 * of truth for roof math - the SVG drawing and the Three.js mesh both call
 * this instead of each computing rise/rafter length independently.
 */
export function computeCrossSection(dims: RoofDimensions): RoofCrossSection {
  const pitchRad = (clampPitch(dims.pitchDeg) * Math.PI) / 180;
  const halfSpan = dims.spanM / 2;
  const rise = halfSpan * Math.tan(pitchRad);
  const rafterLength = halfSpan / Math.cos(pitchRad);

  let areaM2: number;
  if (dims.roofType === "shed") {
    // single slope spanning the full width
    const fullRafter = dims.spanM / Math.cos(pitchRad);
    areaM2 = fullRafter * dims.ridgeLengthM;
  } else {
    // two slopes (gable/gambrel approximated as gable, hip adds end faces below)
    areaM2 = 2 * rafterLength * dims.ridgeLengthM;
    if (dims.roofType === "hip") {
      // add two triangular hip ends, base = span, height = rafterLength
      areaM2 += dims.spanM * rafterLength;
    }
  }

  return { halfSpan, rise, rafterLength, areaM2: Math.round(areaM2 * 10) / 10 };
}

/**
 * 2D cross-section points for the SVG elevation, in a 0..1 normalized box
 * so the component can scale to whatever viewBox it's drawing into.
 */
export function crossSectionPoints2D(dims: RoofDimensions) {
  const { rise } = computeCrossSection(dims);
  const halfSpan = dims.spanM / 2;
  // eave-left, ridge, eave-right, normalized against span/rise for display
  return {
    eaveLeft: { x: 0, y: rise },
    ridge: { x: halfSpan, y: 0 },
    eaveRight: { x: dims.spanM, y: rise },
    spanM: dims.spanM,
    riseM: rise,
  };
}
