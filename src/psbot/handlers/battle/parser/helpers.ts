/** @file Useful BattleParser-related helper functions. */
import { Protocol } from "@pkmn/protocol";
import { Event } from "../../../parser";
import { BattleAgent } from "../agent";
import { FormatType, State } from "../formats";
import { BattleParser, BattleParserContext } from "./BattleParser";
import { BattleIterator, IteratorPair } from "./iterators";

/**
 * Config for `startBattleParser()`.
 * @template T Format type.
 * @template TAgent Battle agent type.
 */
export interface StartBattleParserArgs
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
>
    extends Omit<BattleParserContext<T, TAgent>, "iter" | "state">
{
    /**
     * Gets or constructs the battle state tracker object that will be used by
     * the BattleParser. Only called once.
     */
    getState(): State<T>;
}

/**
 * Initializes a BattleParser.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 * @param cfg Parser config.
 * @param parser Parser function to call.
 * @param args Additional args to supply to the parser.
 * @returns An iterator for sending TEvents to the BattleParser, as well as a
 * Promise that resolves when the BattleParser returns or throws.
 */
export function startBattleParser
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>(
    cfg: StartBattleParserArgs<T, TAgent>,
    parser: BattleParser<T, TAgent, TArgs, TResult>,
    ...args: TArgs): {iter: BattleIterator, finish: Promise<TResult>}
{
    const {eventIt, battleIt} = new IteratorPair();
    const ctx: BattleParserContext<T, TAgent> =
    {
        agent: cfg.agent, iter: eventIt, logger: cfg.logger, sender: cfg.sender,
        state: cfg.getState()
    };
    const finish = (async function asyncBattleParserCtx()
    {
        try
        {
            const result = await parser(ctx, ...args);
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

/**
 * Maps an event type to a BattleParser handler.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 */
export type EventHandlerMap
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
> =
{
    readonly [_ in Protocol.ArgName]?: BattleParser<T, TAgent, TArgs, TResult>;
};

/**
 * Creates a BattleParser that dispatches to an appropriate event handler using
 * the given map, or can return null if no events left or no handler is defined
 * for it.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 * @param handlers Map of event handlers.
 */
export function dispatcher
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>(
    handlers: EventHandlerMap<T, TAgent, TArgs, TResult>
): BattleParser<T, TAgent, TArgs, TResult | null>
{
    return async function eventDispatcher(ctx: BattleParserContext<T, TAgent>,
        ...args: TArgs): Promise<TResult | null>
    {
        const event = await tryPeek(ctx);
        if (!event) return null;
        const key = Protocol.key(event.args);
        if (!key) return null;
        const handler = handlers[key];
        if (!handler) return null;
        return await handler(ctx, ...args);
    };
}

/**
 * Creates a BattleParser that continuously calls the given BattleParser until
 * it stops consuming events or until the end of the event stream.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 * @param parser Parser function to use.
 * @returns All of the returned `TResult`s in an array.
 */
export function baseEventLoop
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>(
    parser: BattleParser<T, TAgent, TArgs, TResult>):
    BattleParser<T, TAgent, TArgs, TResult[]>
{
    return async function baseLoopParser(ctx: BattleParserContext<T, TAgent>,
        ...args: TArgs): Promise<TResult[]>
    {
        const results: TResult[] = [];
        while (true)
        {
            const preEvent = await tryPeek(ctx);
            if (!preEvent) break;
            results.push(await parser(ctx, ...args));
            const postEvent = await tryPeek(ctx);
            if (preEvent === postEvent) break;
        }
        return results;
    };
}

/**
 * Keeps calling a BattleParser with the given args until it doesn't consume an
 * event or until the end of the event stream.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 * @param ctx Parser context.
 * @param parser Parser function to use.
 * @param args Args to supply to the parser.
 * @returns All of the returned `TResult`s in an array.
 */
export async function eventLoop
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>,
    TArgs extends unknown[] = unknown[],
    TResult = unknown
>(
    ctx: BattleParserContext<T, TAgent>,
    parser: BattleParser<T, TAgent, TArgs, TResult>, ...args: TArgs):
    Promise<TResult[]>
{
    return baseEventLoop(parser)(ctx, ...args);
}

/**
 * Peeks at the next event. Throws if there are none left.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @param ctx Parser context.
 */
export async function peek
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>
>(
    ctx: BattleParserContext<T, TAgent>): Promise<Event>
{
    const event = await tryPeek(ctx);
    if (!event) throw new Error("Expected event");
    return event;
}

/**
 * Peeks at the next event. Returns null if there are none left.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @param ctx Parser context.
 */
export async function tryPeek
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>
>(
    ctx: BattleParserContext<T, TAgent>): Promise<Event | null>
{
    const result = await ctx.iter.peek();
    return result.done ? null : result.value;
}

/**
 * Peeks and verifies the next event according to the given event type. Returns
 * null if there are no events left or if the event type doesn't match.
 * @template TName Event type identifier.
 * @template T Format type.
 * @param ctx Parser context.
 * @param expectedKey Expected event type.
 */
export async function tryVerify
<
    TName extends Protocol.ArgName,
    T extends FormatType = FormatType
>(
    ctx: BattleParserContext<T>, ...expectedKeys: TName[]):
    Promise<Event<TName> | null>
{
    const event = await tryPeek(ctx);
    if (!event) return null;

    const key = Protocol.key(event.args);
    if (!key || !expectedKeys.includes(key as TName)) return null;
    return event as Event<TName>;
}

/**
 * Peeks and verifies the next event according to the given event type. Throws
 * if there are no events left or if the event type doesn't match.
 * @template TName Event type identifier.
 * @template T Format type.
 * @param ctx Parser context.
 * @param expectedKey Expected event type.
 */
export async function verify
<
    TName extends Protocol.ArgName,
    T extends FormatType = FormatType
>(
    ctx: BattleParserContext<T>, ...expectedKeys: TName[]):
    Promise<Event<TName>>
{
    const event = await peek(ctx);

    const key = Protocol.key(event.args);
    if (!key || !expectedKeys.includes(key as TName))
    {
        throw new Error("Invalid event: Expected type " +
            `[${expectedKeys.map(k => `'${k}'`).join(", ")}] but got '${key}'`);
    }
    return event as Event<TName>;
}

/**
 * Consumes an event. Throws if there are no events left.
 * @template T Format type.
 * @template TAgent Battle agent type.
 * @param ctx Parser context.
 */
export async function consume
<
    T extends FormatType = FormatType,
    TAgent extends BattleAgent<T> = BattleAgent<T>
>(
    ctx: BattleParserContext<T, TAgent>): Promise<Event>
{
    const result = await ctx.iter.next();
    if (result.done) throw new Error("Expected event");
    return result.value;
}
