import { Logger } from "../../Logger";
import { BattleAgent } from "../agent/BattleAgent";
import { Choice } from "../agent/Choice";

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
    extends Omit<BattleParserContext<any, any, any, TAgent>, "iter" | "state">
{
    /**
     * Gets the battle state tracker object that will be used in the
     * BattleParser. Only called once.
     */
    getState(): TState;
}

/**
 * Initializes a BattleParser.
 * @template TEvent Game event type.
 * @template TState Battle state type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 * @template TAgent Battle agent type.
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
    TArgs extends any[] = any[],
    TResult extends BattleParserResult = BattleParserResult,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>
>(
    cfg: StartBattleParserArgs<TState, TRState, TAgent>,
    parser: BattleParser<TEvent, TState, TRState, TAgent, TArgs, TResult>,
    ...args: TArgs): {iter: BattleIterator<TEvent>, finish: Promise<TResult>}
{
    const {eventIt, battleIt} = createEventIteratorPair<TEvent>();
    const ctx: BattleParserContext<TEvent, TState, TRState, TAgent> =
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

/** Function type for sending a Choice to the game. */
export type ChoiceSender = (choice: Choice) => Promise<SenderResult>;

// tslint:disable: no-trailing-whitespace (force newline in doc)
/**
 * Result after sending a Choice to the game.  
 * `<falsy>` - Choice was accepted.  
 * `true` - Choice was rejected for an unknown reason.  
 * `"disabled"` - Choice was rejected because the chosen move is disabled by
 * some effect.  
 * `"trapped"` - Choice was rejected because the client's pokemon is trapped by
 * some effect.
 */
// tslint:enable: no-trailing-whitespace
export type SenderResult = void | undefined | null | boolean | "disabled" |
    "trapped";

/**
 * Function type for parsing battle events.
 * @template TEvent Game event type.
 * @template TState Battle state type.
 * @template TRState Readonly battle state type.
 * @template TAgent Battle agent type.
 * @template TArgs Additional parameter types.
 * @template TResult Result type.
 * @param ctx General args.
 * @param args Additional args.
 * @returns A custom result value to be handled by the caller.
 */
export type BattleParser
<
    TEvent,
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>,
    TArgs extends any[] = any[],
    TResult extends BattleParserResult = BattleParserResult
> =
    (ctx: BattleParserContext<TEvent, TState, TRState, TAgent>,
        ...args: TArgs) => Promise<TResult>

/**
 * Context container needed to call a BattleParser.
 * @template TEvent Game event type.
 * @template TState Battle state type.
 * @template TRState Readonly battle state type.
 * @template TAgent Battle agent type.
 */
export interface BattleParserContext
<
    TEvent,
    TState extends TRState,
    TRState,
    TAgent extends BattleAgent<TRState> = BattleAgent<TRState>
>
{
    /** Function that makes the decisions for this battle. */
    readonly agent: TAgent;
    /** Iterator for getting the next event.  */
    readonly iter: EventIterator<TEvent>;
    /** Logger object. */
    readonly logger: Logger;
    /** Function for sending the BattleAgent's Choice to the game. */
    readonly sender: ChoiceSender;
    /** Battle state tracker. */
    readonly state: TState;
}

/** Extendable BattleParser return type interface. */
export interface BattleParserResult {}

/**
 * Iterator for retreiving the next event. Also takes the latest BattleState for
 * logging.
 */
export interface EventIterator<TEvent> extends
    PeekableAsyncIterator<TEvent, void, void>
{
    /**
     * Gets the next event.
     * @override
     */
    next(): Promise<IteratorResult<TEvent, void>>;
    /**
     * Peeks at the next event.
     * @override
     */
    peek(): Promise<IteratorResult<TEvent, void>>;
    /**
     * Finishes the iterator. If this is connected to a BattleIterator, the
     * `#return()` call will be propagated to it.
     * @override
     */
    return(): Promise<IteratorResult<TEvent, void>>;
    /**
     * Finishes the iterator with an error, causing any pending
     * `#next()`/`#peek()` Promises to reject. If this is connected to a
     * BattleIterator, the `#throw()` call will be propagated to it.
     * @override
     */
    throw(e?: any): Promise<IteratorResult<TEvent, void>>;
}

/**
 * Iterator for sending the next event to the BattleParser. Also outputs the
 * latest BattleState for logging.
 */
export interface BattleIterator<TEvent> extends
    AsyncIterator<void, void, TEvent>
{
    /**
     * Sends the next event. Once consumed, the latest BattleState is returned.
     * @override
     */
    next(event: TEvent): Promise<IteratorResult<void, void>>;
    /**
     * Finishes the iterator. If this is connected to an EventIterator, the
     * `#return()` call will be propagated to it.
     * @override
     */
    return(): Promise<IteratorResult<void, void>>;
    /**
     * Finishes the iterator with an error. If this is connected to an
     * EventIterator, the `#throw()` call will be propagated to it.
     * @override
     */
    throw(e?: any): Promise<IteratorResult<void, void>>;
}

/**
 * Creates two corresponding iterators, one for sending BattleEvents and the
 * other for receiving them. Also sends the latest version of the BattleState
 * the other way after handling the received event. Note that `#next()` or
 * `#peek()` cannot be called on a single iterator more than once if the first
 * call hadn't resolved yet.
 * @returns An EventIterator for the BattleParser and a corresponding
 * BattleIterator for the game/sim parser.
 */
function createEventIteratorPair<TEvent>():
    {eventIt: EventIterator<TEvent>, battleIt: BattleIterator<TEvent>}
{
    let error: Error | undefined;

    // TODO: could implement this more easily by using duplex/transform streams?
    let nextEventPromise: Promise<TEvent | undefined> | null = null;
    let nextEventRes: ((event?: TEvent) => void) | null = null;
    let nextEventRej: ((reason?: any) => void) | null = null;
    const eventIt: EventIterator<TEvent> =
    {
        async next()
        {
            // give back the new battlestate after handling the last event
            if (battleRes) battleRes();
            else battlePromise = Promise.resolve();

            // wait for a response or consume the cached response
            nextEventPromise ??= new Promise(
                    (res, rej) => [nextEventRes, nextEventRej] = [res, rej]);
            if (error) nextEventRej!(error);
            const event = await nextEventPromise
                .finally(() =>
                    nextEventPromise = nextEventRes = nextEventRej = null);

            if (!event) return {value: undefined, done: true};
            return {value: event};
        },
        async peek()
        {
            // wait for a response and cache it, or get the cached response
            nextEventPromise ??= new Promise(
                    (res, rej) => [nextEventRes, nextEventRej] = [res, rej]);
            if (error) nextEventRej!(error);
            const event = await nextEventPromise
                .finally(() => nextEventRes = nextEventRej = null);

            if (!event) return {value: undefined, done: true};
            return {value: event};
        },
        async return()
        {
            // disable iterator
            this.next = this.peek = this.return = this.throw =
                async () => ({value: undefined, done: true});

            // resolve any pending eventIt.next()/peek() calls
            nextEventRes?.();

            // make sure the corresponding iterator doesn't hang
            await battleIt.return?.();

            return {value: undefined, done: true};
        },
        async throw(e)
        {
            error = e;
            // disable iterator
            this.next = this.peek = this.return = this.throw =
                async () => ({value: undefined, done: true});

            // resolve any pending eventIt.next()/peek() calls
            nextEventRej?.(e);

            // make sure the corresponding iterator doesn't hang
            await battleIt.throw(e);

            return {value: undefined, done: true};
        }
    };

    let battlePromise: Promise<boolean | void> | null = null;
    let battleRes: ((ret?: boolean | PromiseLike<boolean>) => void) | null =
        null;
    let battleRej: ((reason?: any) => void) | null = null;
    const battleIt: BattleIterator<TEvent> =
    {
        async next(event)
        {
            // send the next event
            if (nextEventRes) nextEventRes(event);
            else nextEventPromise = Promise.resolve(event);

            // wait for a response or consume the cached response
            battlePromise ??= new Promise(
                    (res, rej) => [battleRes, battleRej] = [res, rej]);
            if (error) battleRej!(error);
            const ret = await battlePromise
                .finally(() => battlePromise = battleRes = battleRej = null);

            return {value: undefined, done: !!ret};
        },
        async return()
        {
            // disable iterator
            this.next = this.return = this.throw =
                async () => ({value: undefined, done: true});

            // resolve any pending battleIt.next() calls
            battleRes?.(/*ret*/ true);

            // make sure the corresponding iterator doesn't hang
            await eventIt.return();

            return {value: undefined, done: true};
        },
        async throw(e)
        {
            error = e;
            // disable iterator
            this.next = this.return = this.throw =
                async () => ({value: undefined, done: true});

            // resolve any pending battleIt.next() calls
            battleRej?.(e);

            // make sure the corresponding iterator doesn't hang
            await eventIt.throw(e);

            return {value: undefined, done: true};
        }
    };
    return {eventIt, battleIt};
}

/** AsyncIterator with peek operation. */
interface PeekableAsyncIterator<T, TReturn = any, TNext = unknown> extends
    AsyncIterator<T, TReturn, TNext>
{
    /** Gets the next T/TReturn without consuming it. */
    peek(): Promise<IteratorResult<T, TReturn>>;
}
