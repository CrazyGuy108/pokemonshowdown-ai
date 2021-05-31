/** Readonly StatRange representation. */
export interface ReadonlyStatRange
{
    /** Base stat value used to calculate `#min` and `#max`. */
    readonly base: number;
    /** Pokemon's level. */
    readonly level: number;
    /** Whether this is an HP stat, which alters how calculations are made. */
    readonly hp: boolean;
    /** Minimum possible stat value. */
    readonly min: number;
    /** Maximum possible stat value. */
    readonly max: number;
}

/** Represents a range of stat values from a base stat. */
export class StatRange implements ReadonlyStatRange
{
    /** Minimum possible stat value. */
    public get min(): number { return this._min; }
    private _min: number;

    /** Maximum possible stat value. */
    public get max(): number { return this._max; }
    private _max: number;

    // TODO: nature, ev, and iv possibilities

    /**
     * Creates a StatRange.
     * @param base Base stat value used to calculate `#min` and `#max`.
     * @param level Pokemon's level.
     * @param hp Whether this is an HP stat. Stat calculations are different
     * for this stat.
     */
    constructor(public readonly base: number, public readonly level: number,
        public readonly hp = false)
    {
        // calc min and max stats
        this._min = StatRange.calcStat(this.hp, base, level, 0, 0, 0.9);
        this._max = StatRange.calcStat(this.hp, base, level, 252, 31, 1.1);
    }

    /**
     * Indicates that this stat value is known. Throws if not yet initialized.
     */
    public set(stat: number): void
    {
        if (this._min > stat || stat > this._max)
        {
            throw new Error("Known stat value is out of range " +
                `(${this._min}-${this._max} vs ${stat})`);
        }
        this._min = stat;
        this._max = stat;
    }

    /**
     * Calculates a stat value.
     * @param hp Whether this is an HP stat. If true, nature is ignored.
     * @param base Base stat.
     * @param level Pokemon's level.
     * @param evs Effort values, between 0 and 252.
     * @param ivs Individual values, between 0 and 31.
     * @param nature Nature modifier.
     * @returns The calculated stat value.
     */
    public static calcStat(hp: boolean, base: number, level: number,
        evs: number, ivs: number, nature: 0.9 | 1 | 1.1): number
    {
        if (hp && base === 1) return 1; // shedinja

        const x = Math.floor(2 * base + ivs + Math.floor(evs / 4));

        let result: number;
        if (hp) result = Math.floor((x + 100) * level / 100 + 10);
        else result =  Math.floor(x * level / 100 + 5);

        return hp ? result : Math.floor(result * nature);
    }

    // istanbul ignore next: only used in logging
    /** Encodes all stat range data into a string. */
    public toString(): string
    {
        let s: string;
        if (this._min === this._max) s = this._min.toString();
        else s = `${this._min}-${this._max}`;
        return `${s}(${this.base})`;
    }
}
