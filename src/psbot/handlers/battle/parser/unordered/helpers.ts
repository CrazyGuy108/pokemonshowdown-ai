import { BattleAgent } from "../../agent";
import { FormatType } from "../../formats";
import { BattleParserContext } from "../BattleParser";
import { tryPeek } from "../helpers";
import { UnorderedDeadline } from "./UnorderedDeadline";
import { UnorderedParser } from "./UnorderedParser";

/**
 * Evaluates a group of UnorderedDeadline parsers in any order.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult BattleParser's result type.
 * @param ctx Parser context.
 * @param parsers BattleParsers to consider, wrapped to include a deadline
 * callback, in order of descending priority.
 * @param filter Optional parser that runs before each expected parser, usually
 * to consume events that should be ignored. If it accepts, all of the pending
 * parsers are immediately rejected and this function returns.
 * @param args Additional args to supply to each parser.
 * @returns The results of the successful BattleParsers that were able to
 * consume an event, in the order that they were parsed.
 */
export async function all
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>(
    ctx: BattleParserContext<T, TAgent>,
    parsers: UnorderedDeadline<T, TAgent, TResult>[],
    filter?: UnorderedParser<T, TAgent, []>, ...args: TArgs): Promise<TResult[]>
{
    const results: TResult[] = [];
    if (parsers.length <= 0) return results;

    // keep looping as long as parsers are accepting and we still have events to
    //  parse
    let done = false;
    let consumed = true;
    // note: even if done=true (i.e. no parsers accepted), we should still
    //  continue if one of the parsers (excluding the filter) consumed an event,
    //  since that could unblock them
    while (parsers.length > 0 && (!done || consumed))
    {
        // make sure we still have events to parse
        if (!await tryPeek(ctx)) break;

        done = true;
        consumed = false;
        let filterDone = false;
        for (let i = 0; i < parsers.length; ++i)
        {
            // we call the filter before testing each parser since the parser
            //  could still consume events but not accept, leaving events that
            //  might need to be filtered again before testing the next parser
            if (filter)
            {
                await filter(ctx, () => filterDone = true);
                // if the filter called its accept cb, break out of the loop and
                //  immediately reject pending parsers
                if (filterDone) break;
            }

            const preParse = await tryPeek(ctx);
            if (!preParse) break;

            const parser = parsers[i];
            let accepted = false;
            const result = await parser.parse(ctx, () => accepted = true,
                ...args);

            // consume parser that accepted
            if (accepted)
            {
                // reset done so that we can test the next pending parser
                done = false;
                parsers.splice(i, 1);
                results.push(result);
                break;
            }
            // at the end, make sure we actually parsed any events
            // we only really need to check this if done=true since that would
            //  cancel the outer while loop
            if (done)
            {
                const postParse = await tryPeek(ctx);
                if (preParse !== postParse) consumed = true;
            }
        }

        if (filterDone) break;
    }

    // reject parsers that never got to accept an event
    for (let i = 0; i < parsers.length; ++i)
    {
        parsers[i].reject?.();
        parsers.splice(i--, 1);
    }

    return results;
}

/**
 * Expects one of the UnorderedDeadline parsers to parse, rejecting the others.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult BattleParser's result type.
 * @param ctx Parser context.
 * @param parsers BattleParsers to consider, wrapped to include a deadline
 * callback, in order of descending priority.
 * @param args Additional args to supply to each parser.
 * @returns Whether one of the parsers accepted an event, paired with the
 * parser's result if true.
 */
export async function oneOf
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>(
    ctx: BattleParserContext<T, TAgent>,
    parsers: UnorderedDeadline<T, TAgent, TResult>[], ...args: TArgs):
    Promise<[false] | [true, TResult]>
{
    for (const parser of parsers)
    {
        let accepted = false;
        const result = await parser.parse(ctx, () => accepted = true, ...args);
        if (accepted)
        {
            for (const parser2 of parsers)
            {
                if (parser !== parser2) parser2.reject?.();
            }
            return [true, result];
        }
    }
    return [false];
}
