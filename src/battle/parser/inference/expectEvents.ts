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
        for (let i = 0; i < inferences.length; ++i)
        {
            // see if the EventInference takes the event
            const inf = inferences[i];
            const {result, accepted} = await inf.parse(_ctx);

            // if it didn't, try a different EventInference
            const postParse = await tryPeek(_ctx);
            if (preParse === postParse)
            {
                if (accepted)
                {
                    throw new Error("BattleParser called accept callback but " +
                        "didn't parse anything");
                }
                continue;
            }

            // if it did, we can move on to the next event
            if (!accepted)
            {
                throw new Error("BattleParser parsed something but didn't " +
                    "call accept callback");
            }
            inferences.splice(i, 1);
            results.push(result);
            break;
        }
    });

    // reject EventInferences that never got to consume an event
    for (const inf of inferences) inf.reject();

    return results;
}
