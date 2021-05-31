/** Readonly HP representation. */
export interface ReadonlyHP
{
    /** Current HP. */
    readonly current: number;
    /** Maximum HP. */
    readonly max: number;
    /**
     * Whether this is represented as a percentage. If true, `max` is `100` and
     * `current` is the percentage.
     */
    readonly isPercent: boolean;
}

/** Hit points info. */
export class HP implements ReadonlyHP
{
    /** @override */
    public get current(): number { return this._current; }
    private _current: number;

    /** @override */
    public get max(): number { return this._max; }
    private _max: number;

    /** @override */
    public readonly isPercent: boolean;

    /**
     * Creates a full HP object.
     * @param isPercent Whether this HP is to be reported as a percentage.
     */
    constructor(isPercent: boolean)
    {
        this.isPercent = isPercent;
        this._current = 0;
        this._max = 0;
    }

    /**
     * Sets the HP.
     * @param current Current HP.
     * @param max Optional max HP.
     */
    public set(current: number, max?: number): void
    {
        if (max) this._max = max;
        this._current = Math.min(Math.max(0, current), this._max);
    }

    /**
     * Encodes all hp data into a string.
     * @returns The HP in string form.
     */
    public toString(): string
    {
        return `${this._current}/${this._max}${this.isPercent ? "%" : ""}`;
    }
}
