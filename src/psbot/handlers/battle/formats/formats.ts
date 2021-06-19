/** @file Lists all the supported formats. */
import { BattleAgent } from "../agent";
import { BattleParser } from "../parser";
// TODO: lazy load formats?
import * as gen4 from "./gen4";

/** Names of all the supported formats. */
export type FormatType = "gen4";

/** Maps format name to main BattleParser function. */
export const parser:
    {readonly [T in FormatType]: BattleParser<T, BattleAgent<T>, [], void>} =
    {gen4: gen4.parser};

/** Maps format name to battle state constructor. */
export const state: {readonly [T in FormatType]: StateConstructor<T>} =
    {gen4: gen4.state.BattleState};

/** Battle state type maps. */
interface StateMap
{
    gen4:
    {
        stateCtor: typeof gen4.state.BattleState;
        state: gen4.state.BattleState;
        rstate: gen4.state.ReadonlyBattleState
    };
}

/**
 * Maps format name to battle state ctor type.
 * @template T Format type.
 */
export type StateConstructor<T extends FormatType> = StateMap[T]["stateCtor"];

/**
 * Maps format name to battle state type.
 * @template T Format type.
 */
export type State<T extends FormatType> = StateMap[T]["state"];

/**
 * Maps format name to readonly battle state type.
 * @template T Format type.
 */
export type ReadonlyState<T extends FormatType = FormatType> =
    StateMap[T]["rstate"];
