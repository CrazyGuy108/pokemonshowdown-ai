import { pluralTurns } from "./utility";

/** Readonly TempStatus representation. */
export interface ReadonlyTempStatus
{
    /** Name of the status. */
    readonly name: string;
    /** Whether the status is currently active. */
    readonly isActive: boolean;
    /** Current number of `#tick()`s. */
    readonly turns: number;
    /**
     * Max amount of `#tick()`s the status will last. `#end()` should be called
     * in place of the last `#tick()`.
     */
    readonly duration: number;
}

/** Counts turns for a temporary status condition. */
export class TempStatus implements ReadonlyTempStatus
{
    /** @override */
    public get isActive(): boolean { return this._isActive; }
    private _isActive = false;

    /** @override */
    public get turns(): number { return this._turns; }
    private _turns = 0;

    /**
     * Creates a TempStatus.
     * @param name Name of the status.
     * @param duration Max amount of `#tick()`s the status will last. `#end()`
     * should be called in place of the last `#tick()`.
     * @param silent Whether `#tick()` will act as `#end()` if it hits the
     * duration limit.
     */
    constructor(public readonly name: string, public readonly duration: number,
        public readonly silent = false)
    {
    }

    /**
     * Starts the status' turn counter, restarting by default if not already
     * active.
     * @param restart Whether the status should be restarted if called while
     * still active. Default true.
     */
    public start(restart = true): void
    {
        if (!restart && this._isActive) return;
        this._isActive = true;
        this._turns = 0;
    }

    /**
     * Increments turn counter if active. If the `silent` field is true, this
     * will automatically call `#end()` if the duration was reached, rather
     * than throwing an error on the next call.
     */
    public tick(): void
    {
        // inapplicable
        if (!this._isActive) return;
        // went over duration
        if (++this._turns < this.duration) return;
        // should've called end() on last tick() unless silent
        if (this.silent) return this.end();
        throw new Error(
            `TempStatus '${this.name}' lasted longer than expected ` +
            `(${pluralTurns(this._turns, this.duration)})`);
    }

    /** Ends this status. */
    public end(): void
    {
        this._isActive = false;
        this._turns = 0;
    }

    /**
     * Copies turn data over to another TempStatus object, as long as the names
     * and durations match.
     */
    public copyTo(ts: this): void
    {
        if (this.name !== ts.name || this.duration !== ts.duration)
        {
            throw new Error(`TempStatus '${this.name}' of duration ` +
                `${this.duration} can't be copied to TempStatus '${ts.name}' ` +
                `of duration ${ts.duration}`);
        }

        ts._isActive = this._isActive;
        ts._turns = this._turns;
    }

    // istanbul ignore next: only used in logging
    /** Stringifies this TempStatus. */
    public toString(): string
    {
        return pluralTurns(this.name, this._turns, this.duration);
    }
}
