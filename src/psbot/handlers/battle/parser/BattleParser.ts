/** @file Defines the core BattleParser function type. */
import { Logger } from "../../../../Logger";
import { BattleAgent, Choice } from "../agent";
import { FormatType, State } from "../formats";
import { EventIterator } from "./iterators";

/**
 * Function type for parsing battle events.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 * @param ctx General args.
 * @param args Additional args.
 * @returns A custom result value to be handled by the caller.
 */
export type BattleParser
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown,
> =
    (ctx: BattleParserContext<T, TAgent>, ...args: TArgs) => Promise<TResult>;

/**
 * Context container needed to call a BattleParser.
 * @template TEvent Game event type.
 * @template TState Battle state type.
 * @template TRState Readonly battle state type.
 * @template TAgent Battle agent type.
 */
export interface BattleParserContext
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>
>
{
    /** Function that makes the decisions for this battle. */
    readonly agent: TAgent;
    /** Iterator for getting the next event.  */
    readonly iter: EventIterator;
    /** Logger object. */
    readonly logger: Logger;
    /** Function for sending the BattleAgent's Choice to the game. */
    readonly sender: ChoiceSender;
    /** Battle state tracker. */
    readonly state: State<T>;
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
