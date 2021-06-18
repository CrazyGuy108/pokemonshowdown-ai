/** @file Useful BattleParser-related helper functions. */
import { BattleAgent } from "../agent";
import { BattleParser, BattleParserContext } from
    "./BattleParser";
import { BattleIterator, IteratorPair } from "./iterators";

/**
 * Config for `startBattleParser()`.
 * @template TState Battle state type.
 * @template TRState Readonly battle state type.
 * @template TAgent Battle agent type.
 */
export interface StartBattleParserArgs
<
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>,
>
    extends Omit<
        BattleParserContext<unknown, TState, TRState, TAgent>, "iter" | "state">
{
    /**
     * Gets or constructs the battle state tracker object that will be used by
     * the BattleParser. Only called once.
     */
    getState(): TState;
}

/**
 * Initializes a BattleParser.
 * @template TEvent Game event type.
 * @template TState Battle state type.
 * @template TRState Readonly battle state type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 * @param cfg Config and dependencies for the BattleParser.
 * @param parser BattleParser function to call.
 * @returns An iterator for sending TEvents to the BattleParser, as well as a
 * Promise that resolves when the BattleParser returns or throws.
 */
export function startBattleParser
<
    TEvent,
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>(
    cfg: StartBattleParserArgs<TState, TRState, TAgent>,
    parser: BattleParser<TEvent, TState, TRState, TAgent, TArgs, TResult>,
    ...args: TArgs): {iter: BattleIterator<TEvent>, finish: Promise<TResult>}
{
    const {eventIt, battleIt} = new IteratorPair<TEvent>();
    const ctx: BattleParserContext<TEvent, TState, TRState, TAgent> =
    {
        agent: cfg.agent, iter: eventIt, logger: cfg.logger, sender: cfg.sender,
        state: cfg.getState()
    };
    const finish = (async function asyncBattleParserCtx()
    {
        try
        {
            const result = await parser(ctx, /*accept*/ null, ...args);
            await eventIt.return();
            await battleIt.return();
            return result;
        }
        catch (e)
        {
            // if the BattleParser threw an exception, make sure both iterators
            //  also get the error to settle any pending next() calls
            // TODO: wrap errors to preserve current stack and make it clear in
            //  the logs that the next() errors came from these rethrows here
            await eventIt.throw(e);
            await battleIt.throw(e);
            // rethrow the error here so that the final Promise as well as the
            //  last iterator.next() Promises contain the error
            throw e;
        }
    })();
    return {iter: battleIt, finish};
}

/** Maps an event type to a BattleParser handler. */
export type EventHandlerMap
<
    TEvent,
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>,
    TArgs extends unknown[] = unknown[],
    TResult extends unknown = unknown,
    TEventName extends string = string
> =
{
    readonly [T in TEventName]?:
        BattleParser<TEvent, TState, TRState, TAgent, TArgs, TResult>;
};

/**
 * Creates a BattleParser that dispatches to an appropriate event handler using
 * the given map, or can return null if no handler is defined for it.
 * @param handlers Map of event handlers.
 * @param getKey Function for extracting the TEventName from the TEvent.
 */
export function createDispatcher
<
    TEvent,
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>,
    TArgs extends unknown[] = unknown[],
    TResult extends unknown = unknown,
    TEventName extends string = string
>(
    handlers:
        EventHandlerMap<TEvent, TState, TRState, TAgent, TArgs, TResult,
            TEventName>,
    getKey: (event: TEvent) => TEventName | undefined
): BattleParser<TEvent, TState, TRState, TAgent, TArgs, TResult | null>
{
    return async function dispatcher(
        ctx: BattleParserContext<TEvent, TState, TRState, TAgent>,
        accept: (() => void) | null, ...args: TArgs): Promise<TResult | null>
    {
        const event = await tryPeek(ctx);
        if (!event) return null;
        const key = getKey(event);
        if (!key) return null;
        const handler = handlers[key];
        if (!handler) return null;
        return await handler(ctx, accept, ...args);
    };
}

/**
 * Creates a BattleParser that continuously calls the given BattleParser until
 * it stops consuming events or until the end of the event stream.
 * @param parser Parser function to use.
 */
export function baseEventLoop
<
    TEvent,
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>,
    TArgs extends unknown[] = unknown[],
>(
    parser: BattleParser<TEvent, TState, TRState, TAgent, TArgs, unknown>):
    BattleParser<TEvent, TState, TRState, TAgent, TArgs, void>
{
    return async function baseLoopParser(
        ctx: BattleParserContext<TEvent, TState, TRState, TAgent>,
        accept: (() => void) | null,
        ...args: TArgs): Promise<void>
    {
        while (true)
        {
            const preEvent = await tryPeek(ctx);
            if (!preEvent) break;
            await parser(ctx, accept, ...args);
            const postEvent = await tryPeek(ctx);
            if (preEvent === postEvent) break;
            accept = null;
        }
    };
}

/**
 * Keeps calling a BattleParser with the given args until it doesn't consume an
 * event or until the end of the event stream.
 */
export async function eventLoop
<
    TEvent,
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>,
    TArgs extends unknown[] = unknown[]
>(
    ctx: BattleParserContext<TEvent, TState, TRState, TAgent>,
    parser: BattleParser<TEvent, TState, TRState, TAgent, TArgs, unknown>,
    ...args: TArgs
): Promise<void>
{
    return baseEventLoop(parser)(ctx, ...args);
}

/** Peeks at the next event. Throws if there are none left. */
export async function peek<TEvent>(ctx: BattleParserContext<TEvent, any, any>):
    Promise<TEvent>
{
    const event = await tryPeek(ctx);
    if (!event) throw new Error("Expected event");
    return event;
}

/** Peeks at the next event. Returns null if there are none left. */
export async function tryPeek<TEvent>(
    ctx: BattleParserContext<TEvent, any, any>): Promise<TEvent | null>
{
    const result = await ctx.iter.peek();
    return result.done ? null : result.value;
}

/**
 * Peeks and verifies the next event according to the given predicate. Throws if
 * there are no events left or if the predicate fails.
 * @param ctx Parser context.
 * @param pred Event verifier function.
 * @param errorMsg Function to get a suitable error message.
 */
export async function verify<TVerified extends TEvent, TEvent>(
    ctx: BattleParserContext<TEvent, any, any>,
    pred: (event: TEvent) => event is TVerified,
    errorMsg?: (event: TEvent) => string): Promise<TVerified>
{
    const event = await peek(ctx);
    if (!pred(event))
    {
        throw new Error("Invalid event" +
            `${errorMsg ? `: ${errorMsg(event)}` : ""}`);
    }
    return event;
}

/** Consumes an event. Throws if there are no events left.  */
export async function consume<TEvent>(
    ctx: BattleParserContext<TEvent, any, any>): Promise<TEvent>
{
    const result = await ctx.iter.next();
    if (result.done) throw new Error("Expected event");
    return result.value;
}
