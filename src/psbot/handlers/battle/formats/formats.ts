/** @file Lists all the supported formats. */
import { BattleAgent } from "../../../../battle/agent";
import { BattleIterator, BattleParser, BattleParserContext, startBattleParser,
    StartBattleParserArgs } from "../../../../battle/parser";
import { Event } from "../../../parser";
// TODO: lazy load formats?
import * as gen4 from "./gen4";

/** Names of all the supported formats. */
export type FormatType = "gen4";

/** Maps format name to main BattleParser function. */
export const parser:
    {readonly [T in FormatType]: Parser<T, Agent<T>, [], void>} =
    {gen4: gen4.parser};

/** BattleState type maps. */
interface StateMap
{
    gen4:
    {
        rstate: gen4.state.ReadonlyBattleState
        state: gen4.state.BattleState;
        stateCtor: typeof gen4.state.BattleState;
    };
}

/**
 * Maps format name to readonly battle state type.
 * @template T Format type.
 */
export type ReadonlyState<T extends FormatType = FormatType> =
    StateMap[T]["rstate"];

/**
 * Maps format name to battle state type.
 * @template T Format type.
 */
export type State<T extends FormatType> = StateMap[T]["state"];

/** Maps format name to battle state class. */
export const state: {readonly [T in FormatType]: StateMap[T]["stateCtor"]} =
    {gen4: gen4.state.BattleState};

/**
 * BattleParser with template arg replaced with format type.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 * @see {@link BattleParser}
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
 * @see {@link BattleParserContext}
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
 * @see {@link BattleAgent}
 */
export type Agent<T extends FormatType = FormatType, TInfo = any> =
    BattleAgent<ReadonlyState<T>, TInfo>;

/**
 * StartBattleParserArgs with template arg replaced with format type.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @see {@link StartBattleParserArgs}
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
 * @see {@link startBattleParser}
 */
export function startParser
<
    T extends FormatType = FormatType,
    TAgent extends Agent<T> = Agent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>(
    // tslint:disable-next-line: no-shadowed-variable
    cfg: StartParserArgs<T, TAgent>, parser: Parser<T, TAgent, TArgs, TResult>,
    ...args: TArgs): {iter: BattleIterator<Event>, finish: Promise<TResult>}
{
    return startBattleParser(cfg, parser, ...args);
}
