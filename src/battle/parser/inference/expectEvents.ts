import { BattleAgent } from "../../agent";
import { BattleParserContext } from "../BattleParser";
import { eventLoop, tryPeek } from "../helpers";
import { EventInference } from "./EventInference";

// TODO: how should errors and TResult order be handled?
/**
 * Evaluates a group of EventInferences in any order.
 * @template TEvent Game event type.
 * @template TState Battle state type.
 * @template TRState Readonly battle state type.
 * @template TAgent Battle agent type.
 * @template TArgs BattleParser's additional parameter types.
 * @template TResult BattleParser's result type.
 * @param ctx Parser context.
 * @param inferences EventInferences to consider, in order of descending
 * priority.
 * @returns The results of the successful EventInferences that were able to
 * consume an event, in the order that they were parsed.
 */
export async function expectEvents
<
    TEvent,
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>(
    ctx: BattleParserContext<TEvent, TState, TRState, TAgent>,
    inferences:
        EventInference<TEvent, TState, TRState, TAgent, TArgs, TResult>[]):
    Promise<TResult[]>
{
    const results: TResult[] = [];
    if (inferences.length <= 0) return results;

    await eventLoop(ctx, async _ctx =>
    {
        const preParse = await tryPeek(_ctx);
        if (!preParse) return;
        // test each EventInference (in order of priority) on the next event
        for (let i = 0; i < inferences.length; ++i)
        {
            const inf = inferences[i];
            const {result, accepted} = await inf.parse(_ctx);
            if (accepted)
            {
                const postParse = await tryPeek(_ctx);
                // EventInferences that accept must consume at least one event,
                //  otherwise the eventLoop() would stop prematurely
                if (preParse === postParse)
                {
                    // TODO: include unparsed event?
                    throw new Error("EventInference accepted an event but " +
                        "didn't parse it");
                }
                inferences.splice(i, 1);
                results.push(result);
                break;
            }
        }
    });

    // reject EventInferences that never got to accept an event
    for (const inf of inferences) inf.reject();

    return results;
}
