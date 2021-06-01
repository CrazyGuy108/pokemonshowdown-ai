import { MajorStatus } from "../dex";
import { pluralTurns } from "./utility";

/** Readonly MajorStatusCounter representation. */
export interface ReadonlyMajorStatusCounter
{
    /** Current MajorStatus, or null if none. */
    readonly current: MajorStatus | null;
    /** Amount of turns this status has been active (if applicable). */
    readonly turns: number;
    /** Max amount of turns this status can be active, or null if unknown. */
    readonly duration: number | null;
}

/** Mutually-exclusive turn-counter manager for major status conditions. */
export class MajorStatusCounter implements ReadonlyMajorStatusCounter
{
    /** @override */
    public get current(): MajorStatus | null { return this._current; }
    private _current: MajorStatus | null = null;

    /** @override */
    public get turns(): number { return this._turns; }
    private _turns: number = 0;

    /** @override */
    public get duration(): number | null { return this._duration; }
    private _duration: number | null = null;

    /** Callback for when a status is cured. */
    private cureCallback?: () => void;

    /**
     * Afflicts a new major status.
     * @param status Status to afflict.
     */
    public afflict(status: MajorStatus): void
    {
        this._current = status;
        this._turns = 1;
        this._duration = status === "slp" ? 4 : null;
    }

    /**
     * Increments the turn counter if active.
     * @param ability Ability of the statused pokemon that might affect the
     * status duration. Optional.
     */
    public tick(ability?: string): void
    {
        if (!this._current) return;

        if (this._duration && this._turns > this._duration)
        {
            throw new Error(`MajorStatus '${this._current}' lasted longer ` +
                "than expected (" +
                `${pluralTurns(this._turns - 1, this._duration)})`);
        }

        // TODO: implement in AbilityData/Ability wrapper
        if (ability === "earlybird" && this._current === "slp")
        {
            this._turns += 2;
        }
        else ++this._turns;
    }

    /** End of turn updates for certain statuses. */
    public postTurn(): void
    {
        if (this._current === "tox") this.tick();
    }

    /** Resets the current turn counter. */
    public resetCounter(): void
    {
        if (this._current) this._turns = 1;
    }

    /**
     * Asserts that the current status is the given argument.
     * @param status Status that should be currently set.
     * @returns `this` to allow chaining, typically with `#tick()`.
     */
    public assert(status: MajorStatus | null): this
    {
        if (this._current !== status)
        {
            throw new Error(`MajorStatus '${this._current}' was expected to ` +
                `be '${status}'`);
        }
        return this;
    }

    /** Cures this status. */
    public cure(): void
    {
        if (this.cureCallback) this.cureCallback();
        this._current = null;
        this._turns = 0;
        this._duration = null;
    }

    /**
     * Registers the callback for when `#cure()` is called. The function will be
     * called right before the method executes.
     */
    public onCure(cb: () => void): this
    {
        this.cureCallback = cb;
        return this;
    }

    /** Stringifies this MajorStatus, with turn info if applicable. */
    public toString(): string
    {
        const s = this._current;
        if (s === "slp" || s === "tox")
        {
            return `${s} (${pluralTurns(this._turns - 1,
                    this._duration || undefined)})`;
        }
        // other statuses don't care about the turn counter
        return s || "none";
    }
}
