/**
 * Verify the parametric engine's calculations independent of Next.js,
 * Supabase, or Upstash - just the pure math. Run with:
 *
 *   npx tsx scripts/verify-engine.ts
 *
 * This doesn't just print numbers to eyeball (easy to skim past a wrong
 * value that "looks about right") - it independently recomputes each
 * roof's key trig relationships from scratch and asserts they match the
 * engine's own output, so a broken formula fails loudly instead of quietly
 * shipping a wrong cut list.
 */
import { createRoof } from "../lib/parametric-engine/core/createRoof";
import { createWindow } from "../lib/parametric-engine/core/createOpening";
import type { RoofParams, WindowParams } from "../lib/parametric-engine/types";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

let failures = 0;
let checks = 0;

function assertClose(label: string, actual: number, expected: number, tolerance = 0.01) {
  checks++;
  const diff = Math.abs(actual - expected);
  const pass = diff <= tolerance;
  const tag = pass ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
  console.log(`  [${tag}] ${label.padEnd(55)} got ${actual.toFixed(3).padStart(12)}  expected ${expected.toFixed(3).padStart(12)}  diff ${diff.toFixed(4)}`);
  if (!pass) failures++;
}

function section(title: string) {
  console.log(`\n${BOLD}=== ${title} ===${RESET}`);
}

function printTable(title: string, rows: Record<string, number | string>) {
  console.log(`  ${DIM}${title}${RESET}`);
  const keyWidth = Math.max(...Object.keys(rows).map((k) => k.length));
  for (const [key, value] of Object.entries(rows)) {
    const formatted = typeof value === "number" ? value.toFixed(3) : value;
    console.log(`    ${key.padEnd(keyWidth)}  ${formatted}`);
  }
}

function printBOM(bom: { material: string; quantity: number; unit: string }[]) {
  console.log(`  ${DIM}bill of materials${RESET}`);
  const width = Math.max(...bom.map((b) => b.material.length));
  for (const item of bom) {
    console.log(`    ${item.material.padEnd(width)}  ${String(item.quantity).padStart(8)} ${item.unit}`);
  }
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

// ----------------------------------------------------------------------------
// Gable
// ----------------------------------------------------------------------------
{
  const params: RoofParams = { type: "gable", span: 9600, ridgeLength: 12200, pitch: 30, eaveHeight: 2400, overhang: 500, thickness: 18 };
  section(`Gable — span=${params.span}mm ridge=${params.ridgeLength}mm pitch=${params.pitch}°`);

  const roof = createRoof(params);
  const { calculations, bom } = roof.generateAll();
  printTable("calculations (mm / rad)", calculations);
  printBOM(bom);

  const pitchRad = degToRad(params.pitch);
  const halfTotalSpan = (params.span + params.overhang * 2) / 2;
  const expectedRise = halfTotalSpan * Math.tan(pitchRad);
  const expectedRafterLength = halfTotalSpan / Math.cos(pitchRad);

  console.log(`  ${DIM}checks${RESET}`);
  assertClose("totalRise", calculations.totalRise, expectedRise);
  assertClose("rafterLength", calculations.rafterLength, expectedRafterLength);
  assertClose(
    "Pythagorean: rafterLength² = halfTotalSpan² + totalRise²",
    calculations.rafterLength ** 2,
    halfTotalSpan ** 2 + calculations.totalRise ** 2,
    0.5
  );
}

// ----------------------------------------------------------------------------
// Hip
// ----------------------------------------------------------------------------
{
  const params: RoofParams = { type: "hip", width: 9600, length: 14000, pitch: 25, eaveHeight: 2400, overhang: 500, thickness: 18 };
  section(`Hip — width=${params.width}mm length=${params.length}mm pitch=${params.pitch}°`);

  const roof = createRoof(params);
  const { calculations, bom } = roof.generateAll();
  printTable("calculations (mm / rad)", calculations);
  printBOM(bom);

  const pitchRad = degToRad(params.pitch);
  const halfWidth = params.width / 2;
  const expectedRise = halfWidth * Math.tan(pitchRad);
  const hipRun = Math.sqrt(2) * (halfWidth + params.overhang);
  const expectedHipRafterLength = Math.sqrt(hipRun ** 2 + expectedRise ** 2);

  console.log(`  ${DIM}checks${RESET}`);
  assertClose("rise", calculations.rise, expectedRise);
  assertClose("hipRafterLength", calculations.hipRafterLength, expectedHipRafterLength);
  assertClose(
    "Pythagorean: hipRafterLength² = hipRun² + rise²",
    calculations.hipRafterLength ** 2,
    hipRun ** 2 + calculations.rise ** 2,
    0.5
  );
}

// ----------------------------------------------------------------------------
// Shed
// ----------------------------------------------------------------------------
{
  const params: RoofParams = { type: "shed", width: 8000, length: 12000, pitch: 15, eaveHeight: 2400, overhang: 500, thickness: 18 };
  section(`Shed — width=${params.width}mm length=${params.length}mm pitch=${params.pitch}°`);

  const roof = createRoof(params);
  const { calculations, bom } = roof.generateAll();
  printTable("calculations (mm / rad)", calculations);
  printBOM(bom);

  const pitchRad = degToRad(params.pitch);
  const run = params.width + params.overhang;
  const expectedRise = run * Math.tan(pitchRad);
  const expectedRafterLength = run / Math.cos(pitchRad);

  console.log(`  ${DIM}checks${RESET}`);
  assertClose("rise", calculations.rise, expectedRise);
  assertClose("rafterLength", calculations.rafterLength, expectedRafterLength);
  assertClose(
    "Pythagorean: rafterLength² = run² + rise²",
    calculations.rafterLength ** 2,
    run ** 2 + calculations.rise ** 2,
    0.5
  );
}

// ----------------------------------------------------------------------------
// Window (new in engine v2) - basic sanity, not a full trig cross-check
// since a window's geometry is a simple rectangle, not a sloped roof.
// ----------------------------------------------------------------------------
{
  const params: WindowParams = { type: "casement", width: 1200, height: 1200, frameWidth: 60, glassThickness: 4, panels: 1 };
  section(`Window — casement, width=${params.width}mm height=${params.height}mm`);

  const win = createWindow(params);
  const { calculations, bom } = win.generateAll();
  printTable("calculations (mm)", calculations);
  printBOM(bom);

  console.log(`  ${DIM}checks${RESET}`);
  // The glazed opening must be smaller than the overall frame envelope -
  // the frame itself has to take up some of the opening, it can't be zero.
  checks++;
  const frameArea = params.width * params.height;
  const openingArea = calculations.openingWidth * calculations.openingHeight;
  if (openingArea > 0 && openingArea < frameArea) {
    console.log(`  [${GREEN}PASS${RESET}] opening area (${openingArea.toFixed(0)}mm²) is less than frame area (${frameArea}mm²)`);
  } else {
    console.log(`  [${RED}FAIL${RESET}] expected 0 < openingWidth*openingHeight < frame area - check ParametricWindow.calculate()`);
    failures++;
  }
}

// ----------------------------------------------------------------------------
// Known input-validation edge cases (should throw, not silently clamp)
// ----------------------------------------------------------------------------
section("Validation — rejects non-physical inputs");
const badInputs: RoofParams[] = [
  { type: "gable", span: -1, ridgeLength: 12200, pitch: 30, eaveHeight: 2400, overhang: 500, thickness: 18 },
  { type: "gable", span: 9600, ridgeLength: 12200, pitch: 90, eaveHeight: 2400, overhang: 500, thickness: 18 },
];
for (const params of badInputs) {
  checks++;
  try {
    createRoof(params);
    console.log(`  [${RED}FAIL${RESET}] Expected an error for ${JSON.stringify(params)} but none was thrown`);
    failures++;
  } catch (err) {
    console.log(`  [${GREEN}PASS${RESET}] Correctly rejected: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(
  `\n${BOLD}${failures === 0 ? `${GREEN}${checks}/${checks} checks passed.` : `${RED}${failures}/${checks} checks FAILED.`}${RESET}\n`
);
process.exit(failures === 0 ? 0 : 1);
