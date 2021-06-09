import { BattleAgent } from "../../../../battle/agent";
import { BattleIterator, BattleParser, BattleParserContext, startBattleParser,
    StartBattleParserArgs } from "../../../../battle/parser";
import { Event } from "../../../parser";
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
    gen4:
    {
        state: formats.gen4.state.BattleState;
        rstate: formats.gen4.state.ReadonlyBattleState
    };
}

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

/**
 * BattleParser with template arg replaced with format type.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 */
export type Parser
<
    T extends FormatType = FormatType,
    TAgent extends Agent<T> = Agent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown,
> =
    BattleParser<Event, State<T>, ReadonlyState<T>, TAgent, TArgs, TResult>;

/**
 * BattleParserContext with template arg replaced with format type.
 * @template T Format type.
 * @template TAgent Battle agent type.
 */
export type ParserContext
<
    T extends FormatType = FormatType,
    TAgent extends Agent<T> = Agent<T>
> =
    BattleParserContext<Event, State<T>, ReadonlyState<T>, TAgent>;

/**
 * BattleAgent with template arg replaced with format type.
 * @template T Format type.
 * @template TInfo Optional decision info type to return.
 */
export type Agent<T extends FormatType = FormatType, TInfo = any> =
    BattleAgent<ReadonlyState<T>, TInfo>;

/**
 * StartBattleParserArgs with template arg replaced with format type.
 * @template T Format type.
 * @template TAgent Battle agent type.
 */
export type StartParserArgs
<
    T extends FormatType = FormatType,
    TAgent extends Agent<T> = Agent<T>
> =
    StartBattleParserArgs<State<T>, ReadonlyState<T>, TAgent>;

/**
 * `startBattleParser()` with template arg replaced with format type.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 */
export function startParser
<
    T extends FormatType = FormatType,
    TAgent extends Agent<T> = Agent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>(
    cfg: StartParserArgs<T, TAgent>, parser: Parser<T, TAgent, TArgs, TResult>,
    ...args: TArgs): {iter: BattleIterator<Event>, finish: Promise<TResult>}
{
    return startBattleParser(cfg, parser, ...args);
}
