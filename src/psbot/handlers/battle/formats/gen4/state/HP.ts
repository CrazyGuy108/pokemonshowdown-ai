/** Readonly HP representation. */
export interface ReadonlyHP
{
    /** Current HP. May be a percentage. */
    readonly current: number;
    /** Maximum HP. May be a percentage. */
    readonly max: number;
}

/** Hit points info. */
export class HP implements ReadonlyHP
{
    /** @override */
    public get current(): number { return this._current; }
    private _current = 0;

    /** @override */
    public get max(): number { return this._max; }
    private _max = 0;

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
     * @param isPercent Whether to report HP as a percentage.
     * @returns The HP in string form.
     */
    public toString(isPercent?: boolean): string
    {
        return `${this._current}/${this._max}${isPercent ? "%" : ""}`;
    }
}
