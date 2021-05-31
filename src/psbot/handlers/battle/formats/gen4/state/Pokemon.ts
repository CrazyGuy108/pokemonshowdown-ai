import * as dex from "../dex/dex";
import * as dexutil from "../dex/dex-util";
import { HP, ReadonlyHP } from "./HP";
import { MajorStatusCounter, ReadonlyMajorStatusCounter } from
    "./MajorStatusCounter";
import { Move } from "./Move";
import { Moveset, ReadonlyMoveset } from "./Moveset";
import { PokemonTraits, ReadonlyPokemonTraits } from "./PokemonTraits";
import { PossibilityClass, ReadonlyPossibilityClass } from "./PossibilityClass";
import { Team } from "./Team";
import { ReadonlyVolatileStatus, VolatileStatus } from "./VolatileStatus";

/** Options for `Pokemon#transformPost()`. */
export interface MoveData
{
    /** Move ID. */
    id: string;
    /** PP value. */
    pp?: number;
    /** Max PP value. */
    maxpp?: number;
}

/** Readonly Pokemon representation. */
export interface ReadonlyPokemon
{
    /** Whether this is the current active pokemon. */
    readonly active: boolean;

    /** Current pokemon traits. May be overridden by VolatileStatus. */
    readonly traits: ReadonlyPokemonTraits;
    /** Base pokemon traits. */
    readonly baseTraits: ReadonlyPokemonTraits;

    /** Current ability for this Pokemon, or the empty string if unknown. */
    readonly ability: string;

    /** Current species for this Pokemon. or the empty string if unknown. */
    readonly species: string;

    /** Current types for this Pokemon. */
    readonly types: readonly dexutil.Type[];

    // TODO: use dex.Item wrappers instead of data
    /** Current reference to held item possibilities. */
    readonly item: ReadonlyPossibilityClass<string, dexutil.ItemData>;
    /** Current reference to last consumed item possibilities. */
    readonly lastItem: ReadonlyPossibilityClass<string, dexutil.ItemData>;

    /** Pokemon's current moveset. */
    readonly moveset: ReadonlyMoveset;
    /** Pokemon's base moveset. */
    readonly baseMoveset: ReadonlyMoveset;

    /** Pokemon's gender. M=male, F=female, null=genderless. */
    readonly gender?: string | null;

    /** Current Hidden Power type possibility. */
    readonly hpType: ReadonlyPossibilityClass<dexutil.HPType>;

    /** Happiness value between 0 and 255, or null if unknown. */
    readonly happiness: number | null;

    /** Info about the pokemon's hit points. */
    readonly hp: ReadonlyHP;
    /** Whether this pokemon is fainted. */
    readonly fainted: boolean;

    /** Major status turn counter manager. */
    readonly majorStatus: ReadonlyMajorStatusCounter;

    /**
     * Whether the pokemon is definitely grounded or ungrounded, or null if
     * there isn't enough information.
     */
    readonly grounded: boolean | null;

    /** Minor status conditions. Cleared on switch. */
    readonly volatile: ReadonlyVolatileStatus;
}

/** Holds all the possibly incomplete info about a pokemon. */
export class Pokemon implements ReadonlyPokemon
{
    /** @override */
    public get active(): boolean { return !!this._volatile; }

    /** @override */
    public get traits(): PokemonTraits
    {
        return this._volatile?.overrideTraits ?? this.baseTraits;
    }
    /** @override */
    public get baseTraits(): PokemonTraits { return this._baseTraits; }
    private _baseTraits: PokemonTraits;

    /** @override */
    public get ability(): string
    {
        if (!this.traits.ability.definiteValue) return "";

        const ability = this.traits.ability;
        return ability.definiteValue ?? "";
    }
    /** Checks whether the Pokemon can currently have the given ability. */
    public canHaveAbility(ability: string): boolean
    {
        return this.traits.ability.isSet(ability);
    }
    /**
     * Narrows the current ability possibility or overrides it in the
     * VolatileStatus if narrowing isn't possible.
     */
    public setAbility(...ability: string[]): void
    {
        if (ability.every(a => this.canHaveAbility(a)))
        {
            this.traits.ability.narrow(ability);
        }
        else
        {
            this.volatile.overrideTraits =
                this.volatile.overrideTraits!.divergeAbility(...ability);
        }
    }

    /** @override */
    public get species(): string
    {
        return this.traits.species.name;
    }
    /**
     * Does a form change for this Pokemon.
     * @param species The species to change into.
     * @param level New form's level for stat calcs.
     * @param perm Whether this is permanent. Default false. Can be overridden
     * to false by `VolatileStatus#transformed`.
     */
    public formChange(species: string, level: number, perm = false): void
    {
        if (!dex.pokemon.hasOwnProperty(species))
        {
            throw new Error(`Unknown species ${species}`);
        }
        const data = dex.pokemon[species];

        if (perm && !this.volatile.transformed)
        {
            // completely diverge from original base traits
            // TODO: what changes stay the same?
            // TODO: how to recover stats for "us" case? need evs/ivs/etc
            this._baseTraits = PokemonTraits.base(data, level);
            this.volatile.overrideTraits = this._baseTraits.volatile();
        }
        // diverge from original override traits
        else this.volatile.overrideTraits = PokemonTraits.base(data, level);
    }

    /** @override */
    public get types(): readonly dexutil.Type[]
    {
        let result = [...this.traits.types];
        if (this._volatile) result.push(this._volatile.addedType);
        result = result.filter(
            type => type !== "???" &&
                // roost removes flying type
                (!this._volatile?.roost || type !== "flying"));
        if (result.length <= 0) return ["???"];
        return result;
    }

    /** @override */
    public get item(): PossibilityClass<string, dexutil.ItemData>
    { return this._item; }
    /** @override */
    public get lastItem(): PossibilityClass<string, dexutil.ItemData>
    { return this._lastItem; }
    /**
     * Indicates that an item has been revealed or gained.
     * @param item Item id name.
     * @param gained Whether the item was gained just now or being revealed. If
     * `"recycle"`, the item was recovered via the Recycle move. Default false.
     */
    public setItem(item: string, gained: boolean | "recycle" = false): void
    {
        // override any possibilities of other items
        if (gained)
        {
            // item was gained via the recycle move
            if (gained === "recycle")
            {
                // recycled item must match tracked lastItem
                if (!this._lastItem.isSet(item))
                {
                    throw new Error(`Pokemon gained '${item}' via Recycle ` +
                        "but last item was '" +
                        (this._lastItem.definiteValue || "<unknown>") + "'");
                }
                this._item = this._lastItem;
                this._item.narrow(item);
                // recycle also resets lastItem
                this._lastItem = new PossibilityClass(dex.items, "none");
            }
            // if it was just gained through normal needs we don't need to do
            //  anything else
            else this._item = new PossibilityClass(dex.items, item);
        }
        // item is not gained but is just now being revealed
        else this._item.narrow(item);

        if (this._volatile)
        {
            // (de)activate unburden ability if the pokemon has it
            this._volatile.unburden = item === "none" && !!gained;
            // remove choice lock if we didn't gain a choice item
            if (!dex.items[item].isChoice) this._volatile.choiceLock = null;
        }
    }
    /**
     * Indicates that an item was just removed from this Pokemon.
     * @param consumed False if the item was removed or transferred. If the item
     * was consumed (i.e., it can be brought back using the Recycle move), this
     * is set to the item's name, or just true if the item's name is unknown.
     */
    public removeItem(consumed: string | boolean): void
    {
        if (consumed)
        {
            // move current item possibility object to the lastItem slot
            this._lastItem = this._item;
            // if the current item didn't match the consumed param, this should
            //  throw an overnarrowing error
            // TODO: guard this or replace the overnarrowing exception message
            //  in a parameter to be more useful
            if (typeof consumed === "string") this._lastItem.narrow(consumed);
        }

        // this should reset the _item reference so there aren't any duplicates
        this.setItem("none", /*gained*/true);
    }
    private _item = new PossibilityClass(dex.items);
    private _lastItem = new PossibilityClass(dex.items, "none");

    /** @override */
    public get moveset(): Moveset
    {
        if (this._volatile) return this._volatile.overrideMoveset;
        return this.baseMoveset;
    }
    /** Overrides a move slot via Mimic until switched out. */
    public mimic(name: string): void
    {
        // mimicked moves have 5 pp and maxed maxpp
        this.moveset.replace("mimic", new Move(name, "max", 5));
        // can't be choice locked if the move we're locked into is replaced
        if (this._volatile) this._volatile.choiceLock = null;
    }
    /** Permanently replaces a move slot via Sketch. */
    public sketch(name: string): void
    {
        // sketched moves have no pp ups applied
        this.moveset.replace("sketch", new Move(name, "min"), /*base*/true);
        // can't be choice locked if the move we're locked into is replaced
        if (this._volatile) this._volatile.choiceLock = null;
    }
    /** @override */
    public readonly baseMoveset: Moveset;

    /** @override */
    public gender?: string | null;

    /** @override */
    public get hpType(): PossibilityClass<dexutil.HPType>
    {
        // TODO: gen>=5: always use baseTraits
        return this.traits.stats.hpType;
    }

    /** @override */
    public get happiness(): number | null { return this._happiness; }
    public set happiness(value: number | null)
    {
        if (value === null) this._happiness = null;
        else this._happiness = Math.max(0, Math.min(value, 255));
    }
    private _happiness: number | null = null;

    /** @override */
    public readonly hp: HP;
    /** @override */
    public get fainted(): boolean { return this.hp.current === 0; }

    /** @override */
    public readonly majorStatus = new MajorStatusCounter().onCure(() =>
    {
        // TODO: don't confuse this with other methods of curing slp in 1 turn
        /*
        if (this.majorStatus.current === "slp" && this.majorStatus.turns === 1)
        {
            // cured in 0 turns, must have early bird ability
            this.traits.setAbility("earlybird");
        }
        */
        // if the pokemon was asleep before, nightmare should be cured now
        if (this._volatile) this._volatile.nightmare = false;
    });

    /** @override */
    public get grounded(): boolean | null
    {
        // gravity/ingrain override all ground checks
        if (this.team && this.team.state &&
            this.team.state.status.gravity.isActive)
        {
            return true;
        }
        const v = this._volatile;
        if (v?.ingrain) return true;

        // look for an ability-suppressing effect
        const ignoreAbility = v?.suppressAbility;
        const ability = ignoreAbility ? undefined : this.traits.ability;

        // look for an item-suppressing ability/effect
        let ignoreItem: boolean | null = !!v?.embargo.isActive;
        if (!ignoreItem && ability)
        {
            // if all possible abilities ignore item, ignoreItem=true
            // if some don't, ignoreItem=maybe (null)
            // if all don't, ignoreItem=false
            let allIgnoreItem = true;
            let oneIgnoreItem = false;
            for (const n of ability.possibleValues)
            {
                if (!ability.map[n].flags?.ignoreItem) allIgnoreItem = false;
                else oneIgnoreItem = true;
            }
            if (allIgnoreItem && oneIgnoreItem) ignoreItem = true;
            else if (!allIgnoreItem && !oneIgnoreItem) ignoreItem = false;
            else ignoreItem = null;
        }

        // whether the return value cannot be false, i.e. a prior grounded check
        //  could've overridden later ungroundedness checks but we don't have
        //  enough information to know the result of that check
        let maybeGrounded = false;

        // ironball causes grounding
        if (this._item.definiteValue === "ironball")
        {
            // item is definitely working so definitely grounded
            if (ignoreItem === false) return true;
            // item may be working so could be grounded
            if (ignoreItem === null) maybeGrounded = true;
        }
        // can't rule out ironball
        else if (this._item.isSet("ironball") && ignoreItem !== true)
        {
            maybeGrounded = true;
        }

        // magnetrise lifts non-levitate/non-flying-types but is overridden by
        //  ironball and other prior checks
        if (v?.magnetRise.isActive) return maybeGrounded ? null : false;

        // whether the return value cannot be true (similar to maybeGrounded)
        let maybeUngrounded = false;

        // levitate ability lifts non-flying types
        if (ability && [...ability.possibleValues].some(
                n => ability.map[n].on?.block?.move?.type === "ground"))
        {
            // levitate is definitely there so definitely ungrounded unless
            //  ironball negates it
            if (ability.definiteValue) return maybeGrounded ? null : false;
            // levitate may be there so could be ungrounded
            else maybeUngrounded = true;
        }

        // flying type lifts
        if (!this.types.includes("flying"))
        {
            return maybeUngrounded ? null : true;
        }
        return maybeGrounded ? null : false;
    }

    /** @override */
    public get volatile(): VolatileStatus
    {
        if (this._volatile) return this._volatile;
        throw new Error("Pokemon is currently inactive");
    }
    /** Minor status conditions. Cleared on switch. */
    private _volatile: VolatileStatus | null = null;

    /**
     * Creates a Pokemon.
     * @param species Species name.
     * @param hpPercent Whether to report HP as a percentage.
     * @param level Level for stat calcs.
     * @param moves Optional moveset to fill in.
     * @param team Optional reference to the parent Team.
     */
    constructor(species: string, hpPercent: boolean, level = 100,
        moves?: readonly string[], public readonly team?: Team)
    {
        if (!dex.pokemon.hasOwnProperty(species))
        {
            throw new Error(`Unknown species ${species}`);
        }
        const data = dex.pokemon[species];

        this._baseTraits = PokemonTraits.base(data, level)
        if (moves) this.baseMoveset = new Moveset(moves, moves.length);
        else this.baseMoveset = new Moveset(data.movepool);
        this.hp = new HP(hpPercent);
    }

    /** Indicates that the pokemon spent its turn being inactive. */
    public inactive(): void
    {
        this.volatile.inactive();
    }

    /** Called at the beginning of every turn to update temp statuses. */
    public preTurn(): void
    {
        if (this.active) this.volatile.preTurn();
    }

    /** Called at the end of every turn to update temp statuses. */
    public postTurn(): void
    {
        this.majorStatus.postTurn();
        if (this.active) this.volatile.postTurn();
    }

    /**
     * Switches this Pokemon in as if it replaces the given Pokemon.
     * @param mon Pokemon to replace with. If falsy, the Pokemon is switching
     * into an empty slot.
     * @param selfSwitch Self-switch status if any.
     */
    public switchInto(mon?: Pokemon | null,
        selfSwitch?: dexutil.SelfSwitchType | null): void
    {
        // create our own volatile status object
        if (!mon?._volatile) this._volatile = new VolatileStatus();
        else
        {
            // transfer volatile status object
            this._volatile = mon._volatile;
            mon._volatile = null;
        }

        // switch out provided mon

        // toxic counter resets on switch
        if (mon?.majorStatus.current === "tox") mon.majorStatus.resetCounter();

        // clear mirrorMove
        const state = mon?.team?.state;
        if (state)
        {
            if (state.teams.us.active?.active)
            {
                state.teams.us.active.volatile.mirrorMove = null;
            }
            if (state.teams.them.active?.active)
            {
                state.teams.them.active.volatile.mirrorMove = null;
            }
        }

        // switch in new mon

        // handle baton pass
        if (selfSwitch === "copyvolatile")
        {
            // leave self-switch passable
            this._volatile.clearUnpassable();
            this._volatile.batonPass(this.majorStatus.current ?? undefined);
        }
        else if (selfSwitch)
        {
            this._volatile.clearPassable();
            // leave self-switch passable statuses
            this._volatile.clearUnpassable();
        }
        else this._volatile.clear();

        // make sure volatile has updated info about this pokemon
        this._volatile.overrideMoveset.link(this.baseMoveset, "base");
        this._volatile.overrideTraits = this.baseTraits.volatile();
        if (selfSwitch) this._volatile.selfSwitch();
    }

    /** Indicates that the pokemon has fainted. */
    public faint(): void
    {
        this.hp.set(0, 0);
    }

    /**
     * Called when this pokemon is being trapped by an unknown ability.
     * @param by Opponent pokemon with the trapping ability.
     */
    public trapped(by: Pokemon): void
    {
        // opposing pokemon can have only one of these abilities here
        const abilities = new Set<string>();

        // TODO: add features of these abilities to dex data
        // arenatrap traps grounded pokemon
        if (this.grounded !== false) abilities.add("arenatrap");

        // magnetpull traps steel types
        if (this.types.includes("steel")) abilities.add("magnetpull");

        // shadowtag traps all pokemon who don't have it
        if (this.ability !== "shadowtag") abilities.add("shadowtag");

        // infer possible trapping abilities
        if (abilities.size > 0) by.traits.ability.narrow(abilities);
        else throw new Error("Can't figure out why we're trapped");
    }

    /** Indicates that the pokemon has transformed into its target. */
    public transform(target: Pokemon): void
    {
        this.volatile.transformed = true;
        // choice lock resets on transform
        this.volatile.choiceLock = null;

        // copy boosts
        for (const stat of dexutil.boostKeys)
        {
            this.volatile.boosts[stat] = target.volatile.boosts[stat];
        }

        // link moveset inference
        this.volatile.overrideMoveset.link(target.moveset, "transform");

        // copy traits but preserve some according to transform rules
        this.volatile.overrideTraits = target.traits.transform(this.traits);
        this.volatile.addedType = target.volatile.addedType;
    }

    // istanbul ignore next: only used for logging
    /**
     * Encodes all pokemon data into a string.
     * @param indent Indentation level to use.
     * @returns The Pokemon in string form.
     */
    public toString(indent = 0): string
    {
        const s = " ".repeat(indent);
        return `\
${s}${this.stringifySpecies()}${this.gender ? ` ${this.gender}` : ""} \
${this.hp.toString()}
${s}stats: ${this.stringifyStats()}
${s}status: ${this.majorStatus.toString()}
${s}active: ${this.active}\
${this.active ? `\n${s}volatile: ${this.volatile.toString()}` : ""}
${s}types: ${this.stringifyTypes()}
${s}ability: ${this.stringifyAbility()}
${s}item: ${this.stringifyItem()}
${s}grounded: ${this.stringifyGrounded()}
${this.stringifyMoveset(indent)}`;
    }

    // istanbul ignore next: only used for logging
    /** Displays the species as well as whether it's overridden. */
    private stringifySpecies(): string
    {
        const base = this.baseTraits.species;
        const override = this._volatile?.overrideTraits?.species;

        if (!override || override === base) return base.name;
        return `${override.name} (base: ${base.name})`;
    }

    // istanbul ignore next: only used for logging
    /** Displays stat data as well as whether it's overridden. */
    private stringifyStats(): string
    {
        const base = this.baseTraits.stats;
        const override = this._volatile?.overrideTraits?.stats;

        if (!override || base === override) return base.toString();
        return `${override} (base: ${base})`;
    }

    // istanbul ignore next: only used for logging
    /** Displays type values. */
    private stringifyTypes(): string
    {
        const base = this.baseTraits.types;
        const override = this._volatile?.overrideTraits?.types;
        if (!override || base === override) return `[${base.join(", ")}]`;
        return `[${override.join(", ")}] (base: [${base.join(", ")}])`;
    }

    // istanbul ignore next: only used for logging
    /** Displays the possible/overridden/suppressed values of the ability. */
    private stringifyAbility(): string
    {
        const base = this.baseTraits.ability;
        const baseStr = `${base.definiteValue ? "" : "possibly "}${base}`;
        const override = this._volatile?.overrideTraits?.ability;

        if (!override || base === override) return baseStr;

        const overrideStr =
            `${override.definiteValue ? "" : "possibly "}${override}`;
        return `${overrideStr} (base: ${baseStr})`;
    }

    // istanbul ignore next: only used for logging
    /** Displays the last and current values of the held item field. */
    private stringifyItem(): string
    {
        const baseVal = this._item.definiteValue;
        const base = baseVal ? baseVal : "<unrevealed>";

        const lastVal = this._lastItem.definiteValue;
        const last = lastVal ? lastVal : "<unknown>";

        if (last === "none") return base;
        return `${base} (consumed: ${last})`;
    }

    // istanbul ignore next: only used for logging
    /** Displays result of grounded check. */
    private stringifyGrounded(): string
    {
        const grounded = this.grounded;
        if (grounded === true) return "true";
        if (grounded === false) return "false";
        return "maybe";
    }

    // istanbul ignore next: only used for logging
    /** Displays moveset data with happiness and possibly overridden HPType. */
    private stringifyMoveset(indent = 0): string
    {
        const s = " ".repeat(indent);

        // stringify hp type
        const hpType = this.baseTraits.stats.hpType;
        const hpTypeStr = (hpType.definiteValue ? "" : "possibly ") +
            hpType.toString();

        // stringify moveset
        let result = `${s}moveset:\n` +
            this.moveset.toString(indent + 4, this._happiness, hpTypeStr);

        if (this._volatile)
        {
            // moveset property was actually override moveset
            // need to also include base moveset

            // stringify base hp type
            const baseHPType = this.baseTraits.stats.hpType;
            const baseHPTypeStr =
                (baseHPType.definiteValue ? "" : "possibly ") +
                baseHPType.toString();

            // stringify base moveset
            result += `\n${s}base moveset:\n` +
                this.baseMoveset.toString(indent + 4, this._happiness,
                    baseHPTypeStr);
        }

        return result;
    }
}
