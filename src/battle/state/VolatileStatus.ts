import { dex, lockedMoves, twoTurnMoves } from "../dex/dex";
import { BoostName, PokemonData, Type } from "../dex/dex-util";
import { Moveset } from "./Moveset";
import { PossibilityClass } from "./PossibilityClass";
import { StatTable } from "./StatTable";
import { TempStatus } from "./TempStatus";
import { pluralTurns, plus } from "./utility";
import { VariableTempStatus } from "./VariableTempStatus";

/**
 * Contains the minor or temporary status conditions of a pokemon that are
 * removed upon switch.
 */
export class VolatileStatus
{
    // all fields are initialized on #clear() which is called in the constructor

    // passed when copying

    /* Aqua Ring move status. */
    public aquaRing!: boolean;

    /** Stat boost stages. */
    public get boosts(): {[N in BoostName]: number}
    {
        return this._boosts;
    }
    private _boosts!: {[N in BoostName]: number};

    /** Confusion status. */
    public readonly confusion = new TempStatus("confused", 3);

    /** Embargo move status. */
    public readonly embargo = new TempStatus("embargo", 3);

    /** Focus Energy move status. */
    public focusEnergy!: boolean;

    /** Gasto Acid move status (suppresses current ability). */
    public gastroAcid!: boolean;

    /** Ingrain move status. */
    public ingrain!: boolean;

    /** Leech Seed move status. */
    public leechSeed!: boolean;

    /** Magnet Rise move status. */
    public readonly magnetRise = new TempStatus("magnet rise", 3);

    /** Substitute move status. */
    public substitute!: boolean;

    // not passed when copying

    /** Bide move status. */
    public readonly bide = new TempStatus("bide", 1);

    /** Charge move status. */
    public readonly charge = new TempStatus("charging", 2, /*silent*/true);

    /** List of disabled move statuses. */
    public readonly disabledMoves: readonly TempStatus[] =
        Array.from({length: Moveset.maxSize},
            (_, i) => new TempStatus(`disabled move ${i + 1}`, 7));
    /** Removes disable status. */
    public enableMoves(): void
    {
        for (const disabled of this.disabledMoves) disabled.end();
    }

    /** Encore move status. Encored move corresponds to `#lastUsed`. */
    public readonly encore = new TempStatus("encore", 7);

    /** Foresight/Miracle Eye move status. */
    public identified!: "foresight" | "miracleeye" | null;

    /**
     * Index of the last used move, or -1 if none yet. Resets at the beginning
     * of each turn, so this field can be used to check if a pokemon has not
     * yet used a move.
     */
    public lastUsed!: number;

    /**
     * Tracks locked moves, e.g. petaldance variants. Should be ticked after
     * every successful move attempt.
     *
     * After the 2nd or 3rd move, the user will become confused, explicitly
     * ending the status. However, if the user was already confused, the status
     * can be implicitly ended, so this VariableTempStatus field is
     * silent-endable.
     */
    public readonly lockedMove = new VariableTempStatus(lockedMoves, 2,
        /*silent*/true);

    /** Whether the pokemon has used Minimize while out. */
    public minimize!: boolean;

    /** Whether this pokemon must recharge on the next turn. */
    public mustRecharge!: boolean;

    /** Override ability while active. */
    public get overrideAbility(): PossibilityClass<typeof dex.abilities[string]>
    {
        return this._overrideAbility;
    }
    /** Links override ability possibilities to a different PossibilityClass. */
    public linkOverrideAbility(
        ability: PossibilityClass<typeof dex.abilities[string]>): void
    {
        const last = this._overrideAbility;
        this._overrideAbility = ability;
        // don't try to call this twice on the same object
        if (last !== ability) this.setNarrowHandlers();
    }
    /** Resets override ability reference to a new PossibilityClass. */
    public resetOverrideAbility(): void
    {
        this._overrideAbility = new PossibilityClass(dex.abilities);
        this.setNarrowHandlers();
        // truant ability no longer applies
        this._willTruant = false;
    }
    /** Sets ability narrow handlers for ability-specific statuses */
    private setNarrowHandlers(): void
    {
        this._overrideAbility.onNarrow(pc =>
        {
            // reset truant if it no longer applies
            if (pc.definiteValue!.name === "truant") this._willTruant = false;
        });
    }
    private _overrideAbility!: PossibilityClass<typeof dex.abilities[string]>;

    /** Temporary form change. */
    public get overrideSpecies(): PokemonData | null
    {
        return this._overrideSpecies;
    }
    /**
     * Initializes override species data.
     * @param data Dex object for override species.
     * @param setAbility Whether to re-set override ability possibility.
     * Default true.
     */
    public setOverrideSpecies(data: PokemonData, setAbility = true): void
    {
        this._overrideSpecies = data;
        // link to other override fields
        if (setAbility)
        {
            this.resetOverrideAbility();
            this._overrideAbility.narrow(...data.abilities);
        }
        this.overrideStats.data = data;
        this.overrideTypes = data.types;
    }
    private _overrideSpecies!: PokemonData | null;

    /** Override stats connected to `#overrideSpecies`. */
    public readonly overrideStats = new StatTable();

    /**
     * Temporarily overridden types. This should not be included in toString()
     * since the parent Pokemon object should handle that. Should not be
     * accessed other than by the parent Pokemon object.
     */
    public overrideTypes!: readonly [Type, Type];
    /** Temporary third type. */
    public addedType!: Type;

    /** Roost move effect (single turn). */
    public roost!: boolean;

    /** First 5 turns of Slow Start ability. */
    public readonly slowStart = new TempStatus("slow start", 5);

    /** Number of turns this pokemon has used a stalling move, e.g. Protect. */
    public get stallTurns(): number { return this._stallTurns; }
    /**
     * Sets the stall flag. Should be called once per turn if it's on.
     * @param flag Value of the flag.
     */
    public stall(flag: boolean): void
    {
        this._stallTurns = flag ? this._stallTurns + 1 : 0;
        this.stalled = flag;
    }
    private _stallTurns!: number;
    /** Whether we have successfully stalled this turn. */
    private stalled!: boolean;

    /** Taunt move status. */
    public readonly taunt = new TempStatus("taunt", 5);

    /** Torment move status. */
    public torment!: boolean;

    /** Two-turn move currently being prepared. */
    public readonly twoTurn = new VariableTempStatus(twoTurnMoves, 1,
            /*silent*/true);

    /** Whether the Unburden ability would be active here. */
    public unburden!: boolean;

    /** Uproar move status. */
    public readonly uproar = new TempStatus("uproar", 5);

    /** Whether the Truant ability will activate next turn. */
    public get willTruant(): boolean { return this._willTruant; }
    /** Indicates that the Truant ability has activated. */
    public activateTruant(): void
    {
        if (!this._overrideAbility.definiteValue ||
            this._overrideAbility.definiteValue.name !== "truant")
        {
            throw new Error("Expected ability to equal truant but found " +
                (this.overrideAbility.definiteValue ?
                    this.overrideAbility.definiteValue.name
                    : "unknown ability"));
        }

        // will invert to false on postTurn() so it's properly synced
        this._willTruant = true;
    }
    private _willTruant!: boolean;

    /** Creates a VolatileStatus object. */
    constructor()
    {
        this.clear();
    }

    /**
     * Clears all volatile status conditions. This does not affect shallow
     * clones.
     */
    public clear(): void
    {
        this.aquaRing = false;
        this._boosts =
        {
            atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0
        };
        this.confusion.end();
        this.embargo.end();
        this.focusEnergy = false;
        this.gastroAcid = false;
        this.ingrain = false;
        this.leechSeed = false;
        this.magnetRise.end();
        this.substitute = false;

        this.bide.end();
        this.charge.end();
        this.enableMoves();
        this.encore.end();
        this.identified = null;
        this.lastUsed = -1;
        this.lockedMove.reset();
        this.minimize = false;
        this.mustRecharge = false;
        this.resetOverrideAbility();
        this._overrideSpecies = null;
        this.overrideStats.reset();
        this.overrideTypes = ["???", "???"];
        this.addedType = "???";
        this.roost = false;
        this.slowStart.end();
        this._stallTurns = 0;
        this.stalled = false;
        this.taunt.end();
        this.torment = false;
        this.twoTurn.reset();
        this.unburden = false;
        this.uproar.end();
        this._willTruant = false;
    }

    /** Called at the beginning of every turn to update temp statuses. */
    public preTurn(): void
    {
        this.lastUsed = -1;
    }

    /**
     * Called at the end of the turn, after a Choice has been sent to the
     * server.
     */
    public postTurn(): void
    {
        // confusion counter handled by in-game events
        this.embargo.tick();
        this.magnetRise.tick();
        this.taunt.tick();
        // toxic counter handled by in-game events
        this.slowStart.tick();
        this.charge.tick();
        for (const disabled of this.disabledMoves) disabled.tick();

        // move was not used
        if (this.lastUsed < 0)
        {
            this.lockedMove.reset();
            this.twoTurn.reset();
        }

        // after roost is used, the user is no longer grounded at the end of
        //  the turn
        this.roost = false;

        // stalling moves must be used successfully every turn or the turn
        //  counter will reset
        if (!this.stalled) this._stallTurns = 0;
        this.stalled = false;

        // toggle truant activation
        if (this._overrideAbility.definiteValue &&
            this._overrideAbility.definiteValue.name === "truant")
        {
            this._willTruant = !this._willTruant;
        }
        else this._willTruant = false;
    }

    /**
     * Creates a shallow clone of this VolatileStatus.
     * @returns A shallow clone of this object.
     */
    public shallowClone(): VolatileStatus
    {
        const v = new VolatileStatus();
        v.aquaRing = this.aquaRing;
        v._boosts = this._boosts;
        this.confusion.copyTo(v.confusion);
        this.embargo.copyTo(v.embargo);
        v.focusEnergy = this.focusEnergy;
        v.gastroAcid = this.gastroAcid;
        v.ingrain = this.ingrain;
        v.leechSeed = this.leechSeed;
        this.magnetRise.copyTo(v.magnetRise);
        v.substitute = this.substitute;
        return v;
    }

    // istanbul ignore next: only used in logging
    /**
     * Encodes all volatile status data into a string.
     * @returns The VolatileStatus in string form.
     */
    public toString(): string
    {
        return `[${([] as string[]).concat(
            this.aquaRing ? ["aqua ring"] : [],
            (Object.keys(this._boosts) as BoostName[])
                .filter(key => this._boosts[key] !== 0)
                .map(key => `${key}: ${plus(this._boosts[key])}`),
            this.confusion.isActive ? [this.confusion.toString()] : [],
            this.embargo.isActive ? [this.embargo.toString()] : [],
            this.focusEnergy ? ["focus energy"] : [],
            this.gastroAcid ? ["gastro acid"] : [],
            this.ingrain ? ["ingrain"] : [],
            this.leechSeed ? ["leech seed"] : [],
            this.magnetRise.isActive ? [this.magnetRise.toString()] : [],
            this.substitute ? ["has substitute"] : [],
            // override ability/species/etc are handled by Pokemon#toString()
            this.bide.isActive ? [this.bide.toString()] : [],
            this.charge.isActive ? [this.charge.toString()] : [],
            this.disabledMoves.filter(d => d.isActive).map(d => d.toString()),
            this.encore.isActive ? [this.encore.toString()] : [],
            this.identified ? [this.identified] : [],
            this.lastUsed >= 0 ? [`last used move ${this.lastUsed + 1}`] : [],
            this.lockedMove.isActive ? [this.lockedMove.toString()] : [],
            this.minimize ? ["minimize"] : [],
            this.mustRecharge ? ["must recharge"] : [],
            this.roost ? ["roosting"] : [],
            this.slowStart.isActive ? [this.slowStart.toString()] : [],
            this._stallTurns ?
                [pluralTurns("stalled", this._stallTurns - 1)] : [],
            this.taunt.isActive ? [this.taunt.toString()] : [],
            this.torment ? ["torment"] : [],
            // toxic turns handled by Pokemon#toString()
            this.twoTurn.isActive ?
                [`preparing ${this.twoTurn.toString()}`] : [],
            this.uproar.isActive ? [this.uproar.toString()] : [],
            this._willTruant ? ["truant next turn"] : [])
        .join(", ")}]`;
    }
}
