import { BattleAgent } from "../../agent";
import { FormatType } from "../../formats";
import { BattleParser } from "../BattleParser";

/**
 * Function type for tentatively parsing battle events.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 * @param ctx General args.
 * @param accept Callback for when the parser commits to parsing, just before
 * consuming the first event from the {@link EventIterator} stream. If it isn't
 * called when consuming events, it can be used to erase/glob events that should
 * be ignored.
 * @param args Additional args.
 * @returns A custom result value to be handled by the caller.
 */
export type UnorderedParser
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
> =
    BattleParser<T, TAgent, [accept: AcceptCallback, ...args: TArgs], TResult>;

/** Callback to accept an {@link UnorderedParser} pathway. */
export type AcceptCallback = () => void;
