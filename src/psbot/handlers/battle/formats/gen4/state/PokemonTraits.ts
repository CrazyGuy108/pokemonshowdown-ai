import * as dex from "../dex/dex";
import * as dexutil from "../dex/dex-util";
import { PokemonData, Type } from "../dex/dex-util";
import { PossibilityClass, ReadonlyPossibilityClass } from "./PossibilityClass";
import { ReadonlyStatTable, StatTable } from "./StatTable";

/** Readonly PokemonTraits representation. */
export interface ReadonlyPokemonTraits
{
    /** Species data. */
    readonly species: PokemonData;
    // TODO: use dex.Ability wrappers instead of data
    /** Ability possibility. */
    readonly ability: ReadonlyPossibilityClass<string, dexutil.AbilityData>;
    /** Stat range possibilities. */
    readonly stats: ReadonlyStatTable;
    /** Primary and secondary types. */
    readonly types: readonly [Type, Type];
}

/**
 * Tracks the overridable traits of a Pokemon that are directly tied to its
 * species.
 */
export class PokemonTraits implements ReadonlyPokemonTraits
{
    /** @override */
    public readonly species: dexutil.PokemonData;
    /** @override */
    public readonly ability: PossibilityClass<string, dexutil.AbilityData>;
    /** @override */
    public readonly stats: StatTable;
    /** @override */
    public readonly types: readonly [Type, Type];

    /**
     * Creates a base PokemonTraits object. Used for initialization or form
     * changes.
     * @param species Species data.
     * @param level Pokemon's level for stat calcs.
     */
    public static base(species: dexutil.PokemonData, level: number):
        PokemonTraits
    {
        return new PokemonTraits(species, level);
    }

    /**
     * Creates a new PokemonTraits object.
     * @param species Species data.
     * @param level Pokemon's level for stat calcs.
     * @param ability Override ability possibility.
     * @param stats Override stats.
     * @param types Override types.
     */
    private constructor(species: dexutil.PokemonData, level: number,
        ability?: PossibilityClass<string, dexutil.AbilityData>,
        stats?: StatTable, types?: readonly [Type, Type])
    {
        this.species = species;
        this.ability = ability ??
            new PossibilityClass(dex.abilities, ...this.species.abilities);
        this.stats = stats ?? StatTable.base(this.species, level);
        this.types = types ?? this.species.types;
    }

    /**
     * Creates a shallow copy suitable for a VolatileStatus object, assuming
     * `this` comes from the base traits.
     */
    public volatile(): PokemonTraits
    {
        return new PokemonTraits(this.species, this.stats.level!, this.ability,
            this.stats, this.types);
    }

    /**
     * Creates a partial shallow copy from the Transform target.
     * @param source Transform source containing certain traits that should be
     * preserved.
     */
    public transform(source: PokemonTraits): PokemonTraits
    {
        // TODO(gen>4): transform doesn't copy hpType, override from source mon
        return new PokemonTraits(this.species, this.stats.level!, this.ability,
            this.stats.transform(source.stats.hp), this.types);
    }

    /** Creates a partial shallow copy for ability changes. */
    public divergeAbility(...ability: string[]): PokemonTraits
    {
        const pc = new PossibilityClass(dex.abilities, ...ability);
        return new PokemonTraits(this.species, this.stats.level!, pc,
            this.stats, this.types);
    }

    /** Creates a partial shallow copy for type changes. */
    public divergeTypes(types: readonly [Type, Type]): PokemonTraits
    {
        return new PokemonTraits(this.species, this.stats.level!, this.ability,
            this.stats, types);
    }
}
