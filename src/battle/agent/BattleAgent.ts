import { Logger } from "../../Logger";
import { Choice } from "./Choice";

/**
 * Makes decisions in a battle. Can be reused for multiple battles of the same
 * format.
 * @template TState Battle state data type. Prefer making this immutable.
 * @template TInfo Optional decision info type to return.
 * @param state State data for decision making.
 * @param choices Available choices to choose from. This method will sort the
 * choices array in-place from most to least preferable.
 * @param logger Optional logger object.
 * @returns Optional data returned after making a decision.
 */
export type BattleAgent<TState, TInfo = void> =
    (state: TState, choices: Choice[], logger?: Logger) => Promise<TInfo>;
