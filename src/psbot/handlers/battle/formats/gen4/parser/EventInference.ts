import { SubParser, SubParserConfig, SubParserResult } from "../../../../../../battle/parser/BattleParser";
import { eventLoop, peek, tryPeek } from "../../../../../../battle/parser/helpers";

// TODO: make this a class?
/**
 * Describes the different but related cases in which a single group of events
 * can be parsed. Should only be created by the `createEventInference()`
 * function.
 * @template TResult Result type from parsing an event.
 * @see createEventInference
 */
export interface EventInference<
    TResult extends SubParserResult = SubParserResult>
{
    /** Parser for the event. */
    readonly take: SubParser<TResult>;
    /**
     * Models the possible cases in which this inference can activate or
     * `#take()`.
     */
    readonly cases: ReadonlySet<SubInference>;
}

/**
 * Creates an EventInference.
 * @template TResult Result type from parsing an event.
 * @param cases Possible cases in which this inference could accept an event.
 * @param taker Parser function that selects from the given cases. If it accepts
 * the current event, it should call the provided `accept` callback before
 * parsing to indicate which SubInference was chosen.
 */
export function createEventInference<
        TResult extends SubParserResult = SubParserResult>(
    cases: ReadonlySet<SubInference>,
    taker: SubParser<TResult, [accept: (inf: SubInference) => void]>):
    EventInference<TResult>
{
    return {
        take: cfg => taker(cfg,
            function accept(inf: SubInference)
            {
                // istanbul ignore next: should never happen
                if (!cases.has(inf))
                {
                    throw new Error("Taker accept callback didn't provide " +
                        "the correct SubInference");
                }
                // assert the case that happened
                assertAll(inf.reasons);
                // reject all the other cases that didn't happen
                for (const c of cases) if (c !== inf) rejectOne(c.reasons);
            }),
        cases
    };
}

// TODO: should this be removed in favor of its reasons field directly?
/** A possible candidate for an EventInference. */
export interface SubInference
{
    /**
     * Reasons why this SubInference should be the one that activates for the
     * EventInference. If one of them is disproven, then this SubInference
     * shouldn't be considered (i.e., the entire SubInference is disproven).
     *
     * This Set will eventually be emptied as SubReasons get proven/disproven.
     */
    readonly reasons: Set<SubReason>;
}

// TODO: rename to assumption or premise?
/** Reason for a SubInference to activate. */
export interface SubReason
{
    /** Asserts that the reason holds. Requires `#canHold()=true`. */
    assert(): void;
    /** Asserts that the reason cannot hold. */
    reject(): void;
    /**
     * Sets up callbacks to wait for more information before asserting.
     * @param cb Callback for when the reason can be asserted (param
     * `held=true`) or rejected (`held=false`). Can be called immediately.
     * @returns A callback to cancel this call. Should be called automatically
     * when this function calls `cb`. Should do nothing if called again.
     */
    delay(cb: (held: boolean) => void): () => void;
}

/** Result from `expectEvents()`. */
export interface ExpectEventsResult<TResult = SubParserResult> extends
    SubParserResult
{
    results: TResult[];
}

/** Evaluates a group of EventInferences in any order. */
export async function expectEvents<
        TResult extends SubParserResult = SubParserResult>(
    cfg: SubParserConfig, inferences: EventInference<TResult>[]):
    Promise<ExpectEventsResult<TResult>>
{
    if (inferences.length <= 0) return {results: []};

    const results: TResult[] = [];
    const result = await eventLoop(cfg,
        async function expectEventsLoop(_cfg)
        {
            const peek1 = await peek(_cfg);
            for (let i = 0; i < inferences.length; ++i)
            {
                // see if the EventInference takes the event
                const inf = inferences[i];
                const infResult = await inf.take(_cfg);

                // if it didn't, try a different EventInference
                const peek2 = await tryPeek(_cfg);
                if (peek1 === peek2) continue;

                // if it did, we can move on to the next event
                inferences.splice(i, 1);
                results.push(infResult);
                return infResult;
            }
            // if no EventInferences take the event, then stop the event loop
            return {};
        });

    // for the EventInferences that didn't take any events, reject each case
    for (const inf of inferences)
    {
        for (const subInf of inf.cases) rejectOne(subInf.reasons);
    }

    return {...result, results};
}

/** Asserts that all the reasons are valid. */
function assertAll(reasons: Set<SubReason>): void
{
    for (const reason of reasons) reason.assert();
    reasons.clear();
}

/**
 * Asserts that at least one of the reasons is invalid and sets up inferences to
 * figure out which.
 */
function rejectOne(reasons: Set<SubReason>): void
{
    // early return: only one reason provided which must be the invalid one
    // TODO: also add early return for SubReasons that were already disproven
    if (reasons.size <= 1)
    {
        for (const reason of reasons) reason.reject();
        reasons.clear();
        return;
    }

    // keep track of delay() cancel callbacks for cleanup after disproving a
    //  SubReason
    const cancelCbs: (() => void)[] = [];
    // cancels all delay() callbacks
    function cancelAll()
    {
        for (const cb of cancelCbs) cb();
        cancelCbs.length = 0;
    }

    // main callback function for delay() calls
    function evalReason(reason: SubReason, held: boolean): void
    {
        if (!reasons.has(reason)) return;
        if (held)
        {
            // the reason held, so we don't need to care about it anymore
            // note: remove elements from set first in case assert()/reject()
            //  cause this function to be called again
            reasons.delete(reason);
            if (reasons.size < 1)
            {
                throw new Error("All SubReasons held but was supposed to " +
                    "reject one");
            }
            // if all other reasons held, then the last one shouldn't have held
            if (reasons.size === 1)
            {
                const toReject = reasons.keys().next().value! as SubReason;
                reasons.clear();
                toReject.reject();

                // cancel all other delay() callbacks since we're now done
                cancelAll();
            }
            reason.assert(); // sanity check
        }
        else
        {
            // the reason didn't hold, so we don't need to care about any other
            //  inferences
            reasons.clear();
            reason.reject(); // sanity check

            // cancel all other delay() callbacks since we're now done
            cancelAll();
        }
    }

    // delay() each reason and keep track of cancel callbacks
    for (const reason of reasons)
    {
        cancelCbs.push(reason.delay(held => evalReason(reason, held)));
    }
}
