import { BattleAgent } from "../../agent";
import { FormatType } from "../../formats";
import { BattleParserContext } from "../BattleParser";
import { tryPeek } from "../helpers";
import { UnorderedDeadline } from "./UnorderedDeadline";

/**
 * Evaluates a group of BattleParsers in any order.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult BattleParser's result type.
 * @param ctx Parser context.
 * @param parsers BattleParsers to consider, wrapped to include a deadline
 * callback, in order of descending priority.
 * @param args Additional args to supply to each parser.
 * @returns The results of the successful BattleParsers that were able to
 * consume an event, in the order that they were parsed.
 */
export async function expectUnordered
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>(
    ctx: BattleParserContext<T, TAgent>,
    parsers: UnorderedDeadline<T, TAgent, TResult>[], ...args: TArgs):
    Promise<TResult[]>
{
    const results: TResult[] = [];
    if (parsers.length <= 0) return results;

    // keep looping as long as parsers are being consumed and we still have
    //  events to parse
    let done = false;
    let consumed = true;
    while (!done || consumed)
    {
        // make sure we have events to parse
        const preParse = await tryPeek(ctx);
        if (!preParse) break;

        done = true;
        consumed = false;
        for (let i = 0; i < parsers.length; ++i)
        {
            const parser = parsers[i];
            let accepted = false;
            const result = await parser.parse(ctx, () => accepted = true,
                ...args);
            // consume parser that accepted
            if (accepted)
            {
                done = false;
                parsers.splice(i, 1);
                results.push(result);
                break;
            }
        }

        // at the end, make sure we actually parsed any events
        // TODO: what if the parser consumed a halt and now we're stuck waiting?
        const postParse = await tryPeek(ctx);
        if (preParse !== postParse) consumed = true;
    }

    // reject parsers that never got to accept an event
    for (let i = 0; i < parsers.length; ++i)
    {
        parsers[i].reject?.();
        parsers.splice(i--, 1);
    }

    return results;
}
