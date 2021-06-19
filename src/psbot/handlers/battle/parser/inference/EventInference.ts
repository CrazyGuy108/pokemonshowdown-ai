import { BattleAgent } from "../../agent";
import { FormatType } from "../../formats";
import { BattleParser, BattleParserContext } from "../BattleParser";
import { UnorderedDeadline } from "../unordered/UnorderedDeadline";
import { AcceptCallback } from "../unordered/UnorderedParser";
import { SubInference } from "./SubInference";

/**
 * BattleParser type that EventInferences can wrap.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs BattleParser's additional parameter types.
 * @template TResult BattleParser's result type.
 * @param accept Callback to state that a particular SubInference as the sole
 * reason for being able to parse an event. Must be called after verifying the
 * first event but before consuming it.
 */
export type EventInfParser
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
> =
    BattleParser<T, TAgent, [accept: EventInfAcceptCallback, ...args: TArgs],
        TResult>;

/**
 * Callback type for BattleParsers provided to the EventInference constructor.
 * @param inf The SubInference that ended up being chosen out of the ones given
 * when the EventInference was initially constructed.
 */
export type EventInfAcceptCallback = (inf: SubInference) => void;

/**
 * Describes the different but related cases in which a single group of events
 * can be parsed.
 *
 * This is an extended version of UnorderedDeadline in order to handle cases
 * where an event can cause one of several different but related inferences.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs BattleParser's additional parameter types.
 * @template TResult BattleParser's result type.
 */
export class EventInference
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>
    implements UnorderedDeadline<T, TAgent, TResult>
{
    /** Args to supply to the wrapped parser. */
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
        private readonly innerParser: EventInfParser<T, TAgent, TArgs, TResult>,
        ...innerParserArgs: TArgs)
    {
        this.innerParserArgs = innerParserArgs;
    }

    /** @override */
    public async parse(ctx: BattleParserContext<T, TAgent>,
        accept: AcceptCallback): Promise<TResult>
    {
        const result = await this.innerParser(ctx,
            inf =>
            {
                this.accept(inf);
                accept();
            },
            ...this.innerParserArgs);
        return result;
    }

    /** @override */
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
