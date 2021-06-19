/** @file Defines iterator types used by BattleParsers. */
import { Event } from "../../../parser";

/**
 * Holds two corresponding iterators, one for sending BattleEvents and the
 * other for receiving them.
 */
export class IteratorPair
{
    /** Event iterator for receiving events in a BattleParserContext. */
    public readonly eventIt: EventIterator;
    /** Battle iterator for sending events to the BattleParser. */
    public readonly battleIt: BattleIterator;

    private error: Error | null = null;

    private nextEventPromise: Promise<Event | undefined> | null = null;
    private nextEventRes: ((event?: Event) => void) | null = null;
    private nextEventRej: ((reason?: any) => void) | null = null;

    private battlePromise: Promise<boolean | void> | null = null;
    private battleRes: ((ret?: boolean | PromiseLike<boolean>) => void) | null =
        null;
    private battleRej: ((reason?: any) => void) | null = null;

    /**
     * Creates a pair of corresponding AsyncIterators, one for sending
     * BattleEvents to the BattleParser and one for receiving them in a
     * BattleParserContext.
     *
     * Note that `#next()` or `#peek()` cannot be called on a single iterator
     * more than once if the first call hadn't resolved yet.
     */
    constructor()
    {
        this.eventIt =
        {
            next: async () => await this.eventNext(),
            peek: async () => await this.eventPeek(),
            return: async () => await this.eventReturn(),
            throw: async e => await this.eventThrow(e)
        };
        this.battleIt =
        {
            next: async event => await this.battleNext(event),
            return: async () => await this.battleReturn(),
            throw: async e => await this.battleThrow(e)
        };
    }

    /** Implementation for {@link EventIterator#next()}. */
    private async eventNext(): Promise<IteratorResult<Event, void>>
    {
        // indicate that we're receiving the next event
        if (this.battleRes) this.battleRes();
        else this.battlePromise = Promise.resolve();

        // wait for a response or consume the cached response
        this.nextEventPromise ??= new Promise(
            (res, rej) => [this.nextEventRes, this.nextEventRej] = [res, rej]);
        if (this.error) this.nextEventRej!(this.error);
        const event = await this.nextEventPromise
            .finally(() =>
                this.nextEventPromise = this.nextEventRes = this.nextEventRej =
                    null);

        if (!event) return {value: undefined, done: true};
        return {value: event};
    }

    /** Implementation for {@link EventIterator#peek()}. */
    private async eventPeek(): Promise<IteratorResult<Event, void>>
    {
        // wait for a response and cache it, or get the cached response
        this.nextEventPromise ??= new Promise(
            (res, rej) => [this.nextEventRes, this.nextEventRej] = [res, rej]);
        if (this.error) this.nextEventRej!(this.error);
        const event = await this.nextEventPromise
            .finally(() => this.nextEventRes = this.nextEventRej = null);

        if (!event) return {value: undefined, done: true};
        return {value: event};
    }

    /** Implementation for {@link EventIterator#return()}. */
    private async eventReturn(): Promise<IteratorReturnResult<void>>
    {
        this.disableEvent();

        // resolve any pending iterator calls so they don't hang
        this.nextEventRes?.();
        await this.battleIt.throw();

        return {value: undefined, done: true};
    }

    /** Implementation for {@link EventIterator#throw()}. */
    private async eventThrow(e: any): Promise<IteratorReturnResult<void>>
    {
        this.disableEvent();

        this.error = e;

        // reject any pending iterator calls so they don't hang
        this.nextEventRej?.(e);
        await this.battleIt.throw(e);

        return {value: undefined, done: true};
    }

    /**
     * Disables the EventIterator. If called along with `#disableBattle()`, this
     * should trigger garbage collection of the entire object once all the other
     * pending iterator calls resolve.
     */
    private disableEvent()
    {
        this.eventIt.next = this.eventIt.peek = this.eventIt.return =
            this.eventIt.throw = async () => ({value: undefined, done: true});
    }

    /** Implementation for {@link BattleIterator#next()}. */
    private async battleNext(event: Event): Promise<IteratorResult<void, void>>
    {
        // send the next event
        if (this.nextEventRes) this.nextEventRes(event);
        else this.nextEventPromise = Promise.resolve(event);

        // wait for a response or consume the cached response
        this.battlePromise ??= new Promise(
                (res, rej) => [this.battleRes, this.battleRej] = [res, rej]);
        if (this.error) this.battleRej!(this.error);
        const ret = await this.battlePromise
            .finally(
                () => this.battlePromise = this.battleRes = this.battleRej =
                    null);

        return {value: undefined, done: !!ret};
    }

    /** Implementation for {@link BattleIterator#return()}. */
    private async battleReturn(): Promise<IteratorReturnResult<void>>
    {
        this.disableBattle();

        // resolve any pending battleIt.next() calls
        this.battleRes?.(/*ret*/ true);

        // make sure the corresponding iterator doesn't hang
        await this.eventIt.return();

        return {value: undefined, done: true};
    }

    /** Implementation for {@link BattleIterator#throw()}. */
    private async battleThrow(e: any): Promise<IteratorReturnResult<void>>
    {
        this.disableBattle();
        this.error = e;

        // resolve any pending battleIt.next() calls
        this.battleRej?.(e);

        // make sure the corresponding iterator doesn't hang
        await this.eventIt.throw(e);

        return {value: undefined, done: true};
    }

    /**
     * Disables the BattleIterator. If called along with `#disableEvent()`, this
     * should trigger garbage collection of the entire object once all the other
     * pending iterator calls resolve.
     */
    private disableBattle()
    {
        this.battleIt.next = this.battleIt.return = this.battleIt.throw =
            async () => ({value: undefined, done: true});
    }
}

/**
 * Iterator for retreiving the next event. Also takes the latest BattleState for
 * logging.
 */
export interface EventIterator extends PeekableAsyncIterator<Event, void, void>
{
    /**
     * Gets the next event.
     * @override
     */
    next(): Promise<IteratorResult<Event, void>>;
    /**
     * Peeks at the next event.
     * @override
     */
    peek(): Promise<IteratorResult<Event, void>>;
    /**
     * Finishes the iterator. If this is connected to a BattleIterator, the
     * `#return()` call will be propagated to it.
     * @override
     */
    return(): Promise<IteratorReturnResult<void>>;
    /**
     * Finishes the iterator with an error, causing any pending
     * `#next()`/`#peek()` Promises to reject. If this is connected to a
     * BattleIterator, the `#throw()` call will be propagated to it.
     * @override
     */
    throw(e?: any): Promise<IteratorReturnResult<void>>;
}

/**
 * Iterator for sending the next event to the BattleParser. Also outputs the
 * latest BattleState for logging.
 */
export interface BattleIterator extends AsyncIterator<void, void, Event>
{
    /**
     * Sends the next event. Once consumed, the latest BattleState is returned.
     * @override
     */
    next(event: Event): Promise<IteratorResult<void, void>>;
    /**
     * Finishes the iterator. If this is connected to an EventIterator, the
     * `#return()` call will be propagated to it.
     * @override
     */
    return(): Promise<IteratorReturnResult<void>>;
    /**
     * Finishes the iterator with an error. If this is connected to an
     * EventIterator, the `#throw()` call will be propagated to it.
     * @override
     */
    throw(e?: any): Promise<IteratorReturnResult<void>>;
}

/** AsyncIterator with peek operation. */
interface PeekableAsyncIterator<T, TReturn = any, TNext = unknown>
    extends AsyncIterator<T, TReturn, TNext>
{
    /** Gets the next T/TReturn without consuming it. */
    peek(): Promise<IteratorResult<T, TReturn>>;
}
