import type { ItemFeasibilitySelection } from "./item-feasibility.js";

export type ControlledGrabSelection =
  | ItemFeasibilitySelection
  | {
      readonly application: "sonarr";
      readonly instanceId?: string;
      readonly kind: "season";
      readonly itemId: number;
      readonly seasonNumber: number;
    };
