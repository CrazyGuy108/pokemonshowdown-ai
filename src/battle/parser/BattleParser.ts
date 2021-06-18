/** @file Defines the core BattleParser function type. */
import { Logger } from "../../Logger";
import { BattleAgent, Choice } from "../agent";
import { EventIterator } from "./iterators";

/**
 * Function type for parsing battle events.
 * @template TEvent Game event type.
 * @template TState Battle state type.
 * @template TRState Readonly battle state type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 * @param ctx General args.
 * @param accept Callback for when the parser commits to parsing, just before
 * consuming the first event from the {@link EventIterator} stream.
 * @param args Additional args.
 * @returns A custom result value to be handled by the caller.
 */
export type BattleParser
<
    TEvent,
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
> =
    (ctx: BattleParserContext<TEvent, TState, TRState, TAgent>,
        accept: (() => void) | null, ...args: TArgs) => Promise<TResult>;

/**
 * Context container needed to call a BattleParser.
 * @template TEvent Game event type.
 * @template TState Battle state type.
 * @template TRState Readonly battle state type.
 * @template TAgent Battle agent type.
 */
export interface BattleParserContext
<
    TEvent,
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>
>
{
    /** Function that makes the decisions for this battle. */
    readonly agent: TAgent;
    /** Iterator for getting the next event.  */
    readonly iter: EventIterator<TEvent>;
    /** Logger object. */
    readonly logger: Logger;
    /** Function for sending the BattleAgent's Choice to the game. */
    readonly sender: ChoiceSender;
    /** Battle state tracker. */
    readonly state: TState;
}

/** Function type for sending a Choice to the game. */
export type ChoiceSender = (choice: Choice) => Promise<SenderResult>;

// tslint:disable: no-trailing-whitespace (force newline in doc)
/**
 * Result after sending a Choice to the game.  
 * `<falsy>` - Choice was accepted.  
 * `true` - Choice was rejected for an unknown reason.  
 * `"disabled"` - Choice was rejected because the chosen move is disabled by
 * some effect.  
 * `"trapped"` - Choice was rejected because the client's pokemon is trapped by
 * some effect.
 */
// tslint:enable: no-trailing-whitespace
export type SenderResult = void | undefined | null | boolean | "disabled" |
    "trapped";
