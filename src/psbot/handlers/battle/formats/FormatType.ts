import * as formats from "./formats";

/** Names of all the supported formats. */
export type FormatType = keyof typeof formats;

/** Maps format name to battle state class. */
export const state =
    Object.fromEntries(
        (Object.keys(formats) as FormatType[])
            .map(type => [type, formats[type].state.BattleState])) as
    {readonly [T in FormatType]: typeof formats[T]["state"]["BattleState"]};

/** BattleState type maps. */
interface StateMap
{
    gen4: {state: formats.gen4.state.BattleState; rstate: formats.gen4.state.ReadonlyBattleState};
}

/** Maps format name to battle state type. */
export type State<T extends FormatType> = StateMap[T]["state"];

/** Maps format name to readonly battle state type. */
export type ReadonlyState<T extends FormatType = FormatType> =
    StateMap[T]["rstate"];
