import { BattleAgent } from "../../agent";
import { BattleParser, BattleParserContext } from "../BattleParser";
import { SubInference } from "./SubInference";

/**
 * Callback type for BattleParsers provided to the EventInference constructor.
 * @param inf The SubInference that ended up being chosen out of the ones given
 * when the EventInference was initially constructed.
 */
export type AcceptCallback = (inf: SubInference) => void;

/**
 * BattleParser type that EventInferences can wrap.
 * @template TEvent Game event type.
 * @template TState Battle state type.
 * @template TRState Readonly battle state type.
 * @template TAgent Battle agent type.
 * @template TArgs BattleParser's additional parameter types.
 * @template TResult BattleParser's result type.
 * @param accept Callback to state that a particular SubInference as the sole
 * reason for being able to parse an event. Must be called after verifying the
 * first event but before consuming it.
 */
export type InferenceParser
<
    TEvent,
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
> =
    BattleParser<TEvent, TState, TRState, TAgent,
        [accept: AcceptCallback, ...args: TArgs], TResult>;

/**
 * Describes the different but related cases in which a single group of events
 * can be parsed.
 * @template TEvent Game event type.
 * @template TState Battle state type.
 * @template TRState Readonly battle state type.
 * @template TAgent Battle agent type.
 * @template TArgs BattleParser's additional parameter types.
 * @template TResult BattleParser's result type.
 */
export class EventInference
<
    TEvent,
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>
{
    private readonly innerParserArgs: TArgs;

    /**
     * Creates an EventInference.
     * @param cases All the possible cases in which this inference could accept
     * an event.
     * @param innerParser Parser function that selects from the given cases. If
     * it accepts the current event, it should call the provided `accept`
     * callback before parsing to indicate which SubInference was chosen.
     * @param innerParserArgs Additional parser arguments.
     */
    constructor(
        private readonly cases: ReadonlySet<SubInference>,
        private readonly innerParser:
            InferenceParser<TEvent, TState, TRState, TAgent, TArgs, TResult>,
        ...innerParserArgs: TArgs)
    {
        this.innerParserArgs = innerParserArgs;
    }

    /**
     * Attempts to parse some events.
     * @param ctx Parser context.
     * @returns The result from the wrapped BattleParser, as well as a boolean
     * indicating whether this EventInference accepted the parsed events or it
     * needs more/different events at a later time.
     */
    public async parse(
        ctx: BattleParserContext<TEvent, TState, TRState, TAgent>):
        Promise<{result: TResult, accepted: boolean}>
    {
        let accepted = false;
        const result = await this.innerParser(ctx,
            inf =>
            {
                this.accept(inf);
                accepted = true;
            },
            ...this.innerParserArgs);
        return {result, accepted};
    }

    /**
     * Indicates that this EventInference was never able to parse an event,
     * meaning that none of its SubInferences held.
     */
    public reject(): void
    {
        for (const subInf of this.cases) subInf.resolve(/*held*/ false);
    }

    /**
     * Indicates that this EventInference is about to parse an event, and that
     * the SubInference provided is accepted as the sole reason for that.
     */
    private accept(inf: SubInference): void
    {
        if (!this.cases.has(inf))
        {
            throw new Error("BattleParser didn't provide accept " +
                "callback with a valid SubInference");
        }
        // assert the case that was accepted, and reject all the other
        //  cases that weren't
        for (const c of this.cases) c.resolve(/*held*/ c === inf);
    }
}
