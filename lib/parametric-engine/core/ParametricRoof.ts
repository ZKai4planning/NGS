import type { RoofParams, RoofCalculations } from "../types";
import { ParametricComponent } from "./ParametricComponent";

/**
 * Roof-specific base class. Layers roof validation (pitch, thickness) on top
 * of the generic ParametricComponent. GableRoof/HipRoof/ShedRoof extend this
 * exactly as before -- unchanged by the ParametricComponent generalization.
 */
export abstract class ParametricRoof<P extends RoofParams = RoofParams> extends ParametricComponent<P> {
  protected validate(params: P): void {
    if (params.pitch <= 0 || params.pitch >= 90) {
      throw new Error(`Invalid pitch: ${params.pitch}. Must be between 0 and 90 degrees.`);
    }
    if (params.thickness <= 0) {
      throw new Error(`Invalid thickness: ${params.thickness}`);
    }
  }

  abstract calculate(): RoofCalculations;
}
