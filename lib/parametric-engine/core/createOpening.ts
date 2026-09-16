import type { WindowParams, DoorParams } from "../types";
import { ParametricWindow } from "./ParametricWindow";
import { ParametricDoor } from "./ParametricDoor";

export function createWindow(params: WindowParams): ParametricWindow {
  return new ParametricWindow(params);
}

export function createDoor(params: DoorParams): ParametricDoor {
  return new ParametricDoor(params);
}
