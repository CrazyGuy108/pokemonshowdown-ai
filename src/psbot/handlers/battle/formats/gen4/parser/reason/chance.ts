import { inference } from "../../../../parser";

/**
 * SubReason that communicates that the parent effect is dependent on random
 * factors outside what can be predicted or deduced.
 */
export const chance = new inference.SubReason();
