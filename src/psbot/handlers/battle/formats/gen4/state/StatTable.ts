import { HPType, hpTypeKeys, hpTypes, PokemonData, StatName } from
    "../dex/dex-util";
import { PossibilityClass, ReadonlyPossibilityClass } from "./PossibilityClass";
import { ReadonlyStatRange, StatRange } from "./StatRange";

type ReadonlyStatRanges = {readonly [T in StatName]: ReadonlyStatRange};
type StatRanges = {readonly [T in StatName]: StatRange};

/** Readonly StatTable representation. */
export interface ReadonlyStatTable extends ReadonlyStatRanges
{
    /** Pokemon's level from 1 to 100 used for stat calcs. */
    readonly level: number;
    /** Hidden power type possibility tracker. */
    readonly hpType: ReadonlyPossibilityClass<HPType>;
}

/** Tracks stat ranges and species/level for stat calculations. */
export class StatTable implements ReadonlyStatTable, StatRanges
{
    /** @override */
    public readonly level: number;
    public readonly hp: StatRange;
    public readonly atk: StatRange;
    public readonly def: StatRange;
    public readonly spa: StatRange;
    public readonly spd: StatRange;
    public readonly spe: StatRange;

    // TODO: make this a separate obj backed by ivs implementing this interface
    /** @override */
    public readonly hpType: PossibilityClass<HPType>;

    /**
     * Creates a StatTable and calculates all the stats.
     * @param species Reference to the species data for looking up base stats.
     * @param level Pokemon's level from 1 to 100 used for stat calcs.
     */
    public static base(species: PokemonData, level: number): StatTable
    {
        return new StatTable(level, species.baseStats);
    }

    private constructor(level: number,
        baseStats: {readonly [T in StatName]: number | StatRange},
        hpType?: PossibilityClass<HPType>)
    {
        // clamp between 1-100.
        this.level = Math.max(1, Math.min(level, 100));

        this.hp = typeof baseStats.hp === "number" ?
            new StatRange(baseStats.hp, this.level, /*hp*/ true)
            : baseStats.hp;
        this.atk = typeof baseStats.atk === "number" ?
            new StatRange(baseStats.atk, this.level) : baseStats.atk;
        this.def = typeof baseStats.def === "number" ?
            new StatRange(baseStats.def, this.level) : baseStats.def;
        this.spa = typeof baseStats.spa === "number" ?
            new StatRange(baseStats.spa, this.level) : baseStats.spa;
        this.spd = typeof baseStats.spd === "number" ?
            new StatRange(baseStats.spd, this.level) : baseStats.spd;
        this.spe = typeof baseStats.spe === "number" ?
            new StatRange(baseStats.spe, this.level) : baseStats.spe;

        this.hpType = hpType ?? new PossibilityClass(hpTypes, hpTypeKeys);
    }

    // TODO: change param type to StatTable
    /**
     * Creates a partial shallow copy from a Transform target, overriding the HP
     * stat with that of the Transform user.
     */
    public transform(hp: StatRange): StatTable
    {
        // TODO(gen>4): transform doesn't copy hpType, override from source mon
        return new StatTable(this.level,
        {
            hp, atk: this.atk, def: this.def, spa: this.spa, spd: this.spd,
            spe: this.spe
        }, this.hpType);
    }

    // istanbul ignore next: only used in logging
    /** Encodes all stat table data into a string. */
    public toString(): string
    {
        return `[${
            [
                `L${this.level}`,
                `hp: ${this.hp}`, `atk: ${this.atk}`, `def: ${this.def}`,
                `spa: ${this.spa}`, `spd: ${this.spd}`, `spe: ${this.spe}`
            ].join(", ")}]`;
    }
}
