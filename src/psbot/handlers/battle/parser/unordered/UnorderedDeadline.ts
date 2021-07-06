import { BattleAgent } from "../../agent";
import { FormatType } from "../../formats";
import { UnorderedParser } from "./UnorderedParser";

// TODO: make this a class?
/**
 * BattleParser wrapper that can be put on a deadline.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TResult Result type.
 */
export interface UnorderedDeadline
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TResult = unknown
>
{
    /** Parser function to call. */
    parse: UnorderedParser<T, TAgent, unknown[], TResult>;
    /**
     * Method to call when the parser never accepts an event by some deadline.
     */
    reject?: RejectCallback;
}

/** Callback to reject an {@link UnorderedDeadline} pathway. */
export type RejectCallback = () => void;

/**
 * Creates an UnorderedDeadline obj.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs BattleParser's additional parameter types.
 * @template TResult BattleParser's result type.
 * @param parser Parser function to wrap.
 * @param reject Callback if the parser never accepts an event.
 */
export function createUnorderedDeadline
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>(
    parser: UnorderedParser<T, TAgent, TArgs, TResult>,
    reject?: RejectCallback, ...args: TArgs):
    UnorderedDeadline<T, TAgent, TResult>
{
    return {parse: (ctx, accept) => parser(ctx, accept, ...args), reject};
}
