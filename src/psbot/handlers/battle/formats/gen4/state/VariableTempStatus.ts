import { pluralTurns } from "./utility";

/** Readonly VariableTempStatus representation. */
export interface ReadonlyVariableTempStatus<TStatusType extends string>
{
    /** Whether this status is currently active and not `"none"`. */
    readonly isActive: boolean;
    /** Current status type. */
    readonly type: TStatusType | "none";
    /** Whether this was status started by a called move. */
    readonly called: boolean;
    /** Current number of `#tick()`s. */
    readonly turns: number;
    /**
     * Max amount of `#tick()`s the status will last. `#reset()` should be
     * called in place of the last `#tick()`.
     */
    readonly duration: number;
    /** Stores all the `TStatusType` keys for iterating. */
    readonly map: {readonly [T in TStatusType]: any};
}

/**
 * TempStatus whose duration depends on the type of status that's currently
 * active. Similar to a set of mutually exclusive TempStatuses.
 * @template TStatusType String union of status types that this object can
 * represent. This excludes the `"none"` type, which is automatically added.
 */
export class VariableTempStatus<TStatusType extends string> implements
    ReadonlyVariableTempStatus<TStatusType>
{
    /** @override */
    public get isActive(): boolean { return this._type !== "none"; }

    /** @override */
    public get type(): TStatusType | "none" { return this._type; }
    private _type: TStatusType | "none" = "none";

    /** @override */
    public get called(): boolean { return this._called; }
    private _called = false;

    /** @override */
    public get turns(): number { return this._turns; }
    private _turns = 0;

    /**
     * Creates a VariableTempStatus.
     * @param map Used to provide type info.
     * @param duration Max amount of `#tick()`s the status will last. `#reset()`
     * should be called in place of the last `#tick()`.
     * @param silent Whether `#tick()` will act as `#reset()` if it hits the
     * duration limit.
     */
    constructor(public readonly map: {readonly [T in TStatusType]: any},
        public readonly duration: number, public readonly silent = false)
    {
    }

    /** Resets status to `none`. */
    public reset(): void
    {
        this._type = "none";
        this._called = false;
        this._turns = 0;
    }

    /** Starts (or restarts) a status. */
    public start(type: TStatusType, called = false): void
    {
        this._type = type;
        this._called = called;
        this._turns = 0;
    }

    /** Indicates that the status lasted another turn. */
    public tick(): void
    {
        // no need to increment turns if it's none
        if (this._type === "none") return;
        // went over duration
        if (++this._turns < this.duration) return;
        // should've reset() on last tick() unless silent
        if (this.silent) return this.reset();
        throw new Error(`Status '${this._type}' went longer than expected ` +
            `(duration=${this.duration}, turns=${this._turns})`);
    }

    // istanbul ignore next: only used in logging
    /** Encodes status data into a log string. */
    public toString(): string
    {
        if (this._type === "none") return "inactive";
        return pluralTurns(this._type, this._turns, this.duration) +
            (this._called ? " (called)" : "");
    }
}
