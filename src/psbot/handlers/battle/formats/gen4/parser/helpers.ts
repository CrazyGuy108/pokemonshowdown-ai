import { consume, tryPeek } from "../../../../../../battle/parser";
import { EventInference, SubInference, SubReason } from
    "../../../../../../battle/parser/inference";
import { Event } from "../../../../../parser";
import { Agent, Parser } from "../../formats";
import { BattleState, ReadonlyBattleState } from "../state";

type EventInf
<
    TAgent extends Agent<"gen4"> = Agent<"gen4">,
    TArgs extends unknown[] = unknown[],
    TResult extends unknown = unknown
> =
    EventInference<Event, BattleState, ReadonlyBattleState, TAgent, TArgs,
        TResult>;

class IgnoredReason extends SubReason
{
    constructor(private readonly onIgnored?: () => void) { super(); }
    /** @override */
    public canHold() { return null; }
    /** @override */
    public assert() {}
    /** @override */
    public reject() { this.onIgnored?.(); }
    /** @override */
    protected delayImpl() { return () => {}; }
}

/**
 * Creates an EventInference that parses from a single SubInference case.
 * @template TAgent Battle agent type.
 * @template TArgs BattleParser's additional parameter types.
 * @template TResult BattleParser's result type.
 * @param parser Parser to call. Should call its `accept` callback once it has
 * verified the initial event and plans on consuming it.
 * @param onIgnored Function to call if the event never gets parsed.
 * @param parserArgs Additional args to supply to the parser.
 */
function singleCaseEventInference
<
    TAgent extends Agent<"gen4"> = Agent<"gen4">,
    TArgs extends unknown[] = unknown[],
    TResult extends unknown = unknown
>(
    parser:
        Parser<"gen4", TAgent, [accept: () => void, ...args: TArgs], TResult>,
    onIgnored?: () => void, ...parserArgs: TArgs):
    EventInf<TAgent, TArgs, TResult>
{
    const subInf = new SubInference(new Set([new IgnoredReason(onIgnored)]));

    return new EventInference(
        new Set([subInf]),
        async function singleCaseEventInfParser(ctx, accept, ...args: TArgs)
        {
            return await parser(ctx, () => accept(subInf), ...args);
        },
        ...parserArgs);
}


/** Predicate function type for {@link singleEventInference}. */
export type SingleEventInfPredicate<TEvent extends Event> =
    (event: Event) => event is TEvent;

/**
 * Creates an EventInference that parses after verifying a single Event, or that
 * returns null if the event could not be verified.
 * @template TEvent Specific event type for further parsing.
 * @template TAgent Battle agent type.
 * @template TArgs BattleParser's additional parameter types.
 * @template TResult BattleParser's result type.
 * @param pred Predicate to verify the initial event before accepting it.
 * @param parser Parser to call after accepting/consuming the initial event for
 * further parsing.
 * @param onIgnored Function to call if the event never gets parsed.
 * @param parserArgs Additional args to supply to the parser.
 */
export function singleEventInference
<
    TEvent extends Event,
    TAgent extends Agent<"gen4"> = Agent<"gen4">,
    TArgs extends unknown[] = unknown[],
    TResult extends unknown = unknown
>(
    pred: SingleEventInfPredicate<TEvent>,
    parser: Parser<"gen4", TAgent, [event: TEvent, ...args: TArgs], TResult>,
    onIgnored?: () => void,
    ...parserArgs: TArgs): EventInf<TAgent, TArgs, TResult | null>
{
    return singleCaseEventInference(
        async function singleEventInfParser(ctx, accept, ...args: TArgs)
        {
            const event = await tryPeek(ctx);
            if (!event || !pred(event)) return null;
            accept();
            await consume(ctx);
            return await parser(ctx, event, ...args);
        },
        onIgnored, ...parserArgs);
}
