import type { RoofParams } from "../types";
import { GableRoof } from "./GableRoof";
import { HipRoof } from "./HipRoof";
import { ShedRoof } from "./ShedRoof";
import { ParametricRoof } from "./ParametricRoof";

export function createRoof(params: RoofParams): ParametricRoof {
  switch (params.type) {
    case "gable":
      return new GableRoof(params);
    case "hip":
      return new HipRoof(params);
    case "shed":
      return new ShedRoof(params);
    default: {
      const _exhaustive: never = params;
      throw new Error(`Unknown roof type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
