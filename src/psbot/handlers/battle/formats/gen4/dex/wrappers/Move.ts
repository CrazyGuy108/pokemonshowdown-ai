import { Pokemon, ReadonlyPokemon } from "../../state/Pokemon";
import { ReadonlyPossibilityClass } from "../../state/PossibilityClass";
import { Side } from "../../state/Side";
import * as dexutil from "../dex-util";

/** Limited form of the `ReadonlyPokemon` interface. */
export type ReadonlyMoveUserSnapshot = Pick<ReadonlyPokemon, "hpType" | "item">;

/** Limited form of the `Pokemon` interface. */
export type MoveUserSnapshot = Readonly<Pick<Pokemon, "hpType" | "item">>;

/** Pairs a Move with its user-ref. */
export interface MoveAndUserRef
{
    /** Move object. */
    readonly move: Move;
    /** Pokemon reference to the move's user. */
    readonly userRef: Side;
}

/** Readonly form of `MoveAndUser`. */
export interface ReadonlyMoveAndUser
{
    /** Move object. */
    readonly move: Move;
    /** Move user. */
    readonly user: ReadonlyPokemon;
}

/** Pairs a Move with its user. */
export interface MoveAndUser extends ReadonlyMoveAndUser
{
    /** @override */
    readonly user: Pokemon;
}

/** Encapsulates move properties. */
export class Move
{
    //#region properties interpreted from MoveData

    /** Whether this move is affected by type effectiveness multipliers. */
    public get canBeEffective(): boolean
    {
        return this.data.category !== "status" && !this.data.damage;
    }

    /** Whether this move deals damage based on base power. */
    public get dealsBPDamage(): boolean
    {
        return this.data.category !== "status" && !this.data.damage;
    }

    //#endregion

    // TODO: eventually make #data inaccessible apart from internal dex
    /**
     * Creates a Move data wrapper.
     * @param data Move data from dex.
     */
    constructor(public readonly data: dexutil.MoveData) {}

    //#region interpreted properties that need extra info

    /**
     * Gets the effective target of the move.
     * @param user User of the move (To handle ghost-type Curse).
     */
    public getTarget(user: ReadonlyPokemon): dexutil.MoveTarget
    {
        // TODO(gen6): nonGhostTarget interactions with protean
        return this.data.nonGhostTarget && !user.types.includes("ghost") ?
            this.data.nonGhostTarget : this.data.target;
    }

    // TODO: encapsulate type-related methods into a PossibilityClass-like api
    /** Gets all the possible effective types of a move based on its user. */
    public getPossibleTypes(user: MoveUserSnapshot): Set<dexutil.Type>
    {
        // TODO: also include naturalgift and others
        switch (this.data.modifyType)
        {
            case "hpType": return new Set(user.hpType.possibleValues);
            case "plateType":
            {
                const result = new Set<dexutil.Type>();
                for (const n of user.item.possibleValues)
                {
                    result.add(user.item.map[n].plateType ?? this.data.type);
                }
                return result;
            }
            case "???": return new Set(["???"]);
            default: return new Set([this.data.type]);
        }
    }

    /**
     * Gets the move's effective type based on its user if the user's currently
     * revealed traits guarantee it, or null if not enough information has been
     * revealed.
     */
    public getDefiniteType(user: ReadonlyMoveUserSnapshot): dexutil.Type | null;
    /**
     * Gets the move's effective type based on its user if the user's currently
     * revealed traits guarantee it, or null if not enough information has been
     * revealed.
     * @param hpType HPType of the user.
     * @param item User's item.
     */
    public getDefiniteType(hpType: ReadonlyPossibilityClass<dexutil.HPType>,
        item: ReadonlyPossibilityClass<string, dexutil.ItemData>):
        dexutil.Type | null;
    public getDefiniteType(
        userOrHPType:
            ReadonlyMoveUserSnapshot | ReadonlyPossibilityClass<dexutil.HPType>,
        item?: ReadonlyPossibilityClass<string, dexutil.ItemData>):
        dexutil.Type | null
    {
        let hpType: ReadonlyPossibilityClass<dexutil.HPType>;
        if (item)
        {
            hpType = userOrHPType as ReadonlyPossibilityClass<dexutil.HPType>;
        }
        else ({hpType, item} = userOrHPType as ReadonlyPokemon);

        switch (this.data.modifyType)
        {
            // TODO: also include naturalgift and others
            case "hpType": return hpType.definiteValue;
            case "plateType":
                // TODO: include item-blocking effects
                if (!item.definiteValue) return null;
                return item.map[item.definiteValue].plateType ?? this.data.type;
            case "???": return "???";
            default: return this.data.type;
        }
    }

    /**
     * Gets the main (guaranteed) boost effects of this move.
     * @param tgt Target of the boost effect.
     * @param userTypes User's types, in order to handle Curse effect.
     * @returns A table of boost values which are guaranteed to apply to the
     * `tgt` when the move is used.
     */
    public getBoostEffects(tgt: dexutil.MoveEffectTarget,
        userTypes: readonly dexutil.Type[]):
        {boosts: Partial<dexutil.BoostTable>, set?: true}
    {
        if (!this.data.effects?.boost) return {boosts: {}};
        if (this.data.effects.boost.chance) return {boosts: {}};
        if (this.data.effects.boost.noGhost && userTypes.includes("ghost"))
        {
            return {boosts: {}};
        }
        return {
            boosts: this.data.effects.boost[tgt] ?? {},
            ...this.data.effects.boost.set && {set: true}
        };
    }

    /**
     * Gets the main guaranteed status effects of this move.
     * @param tgt Target of the status effect
     * @param userTypes User's types, in order to handle Curse effect.
     * @returns An array of statuses, one of which will afflict the `tgt` when
     * the move is used.
     */
    public getMainStatusEffects(tgt: dexutil.MoveEffectTarget,
        userTypes: readonly dexutil.Type[]): readonly dexutil.StatusType[]
    {
        if (this.data.category !== "status") return [];
        if (!this.data.effects?.status) return [];
        if (this.data.effects.status.ghost && !userTypes.includes("ghost"))
        {
            return [];
        }
        if (this.data.effects.status.chance) return [];
        return this.data.effects.status?.[tgt] ?? [];
    }

    /**
     * Gets all guaranteed status effects of this move.
     * @param tgt Target of the status effect
     * @param userTypes User's types, in order to handle Curse effect.
     * @returns An array of statuses, one of which will afflict the `tgt` when
     * the move is used.
     */
    public getGuaranteedStatusEffects(tgt: dexutil.MoveEffectTarget,
        userTypes: readonly dexutil.Type[]): readonly dexutil.StatusType[]
    {
        if (!this.data.effects?.status) return [];
        if (this.data.effects.status.ghost && !userTypes.includes("ghost"))
        {
            return [];
        }
        if ((this.data.effects.status.chance ?? 100) < 100) return [];
        return this.data.effects.status?.[tgt] ?? [];
    }

    /**
     * Gets all guaranteed or chance-based status effects of this move.
     * @param tgt Target of the status effect
     * @param userTypes User's types, in order to handle Curse effect.
     * @returns An array of statuses, one of which may afflict the `tgt` when
     * the move is used.
     */
    public getAllStatusEffects(tgt: dexutil.MoveEffectTarget,
        userTypes: readonly dexutil.Type[]): readonly dexutil.StatusType[]
    {
        if (!this.data.effects?.status) return [];
        if (this.data.effects.status.ghost && !userTypes.includes("ghost"))
        {
            return [];
        }
        return this.data.effects.status?.[tgt] ?? [];
    }

    //#endregion

    //#region inference helper methods

    /**
     * Makes inferences to support the assertion that, if this Move was used by
     * the given Pokemon, the Move would be of the given type.
     * @param type Expected move type
     * @param user User of the move.
     */
    public assertType(type: dexutil.Type, user: MoveUserSnapshot): void
    {
        // assert move type if known
        const moveType = this.getDefiniteType(user);
        if (moveType)
        {
            if (type !== moveType)
            {
                throw new Error("Move type assertion failed: " +
                    `Expected type-change to '${moveType}' but got '${type}'`);
            }
            return;
        }

        // if move type is unknown, reverse the assertion into an inference
        switch (this.data.modifyType)
        {
            // asserted type is the user's hiddenpower type
            case "hpType": user.hpType.narrow(type); break;
            // asserted type is the type of plate the user is holding
            case "plateType":
                user.item.narrow((_, i) =>
                        type === (i.plateType ?? this.data.type));
                break;
        }
    }

    /**
     * Makes inferences to support the assertion that, if this Move was used by
     * the given Pokemon, the Move would be of one of the given types, or the
     * opposite if `negative` is true.
     * @param types Expected possible move types.
     * @param user Move user.
     * @param negative Whether to flip the assertion.
     */
    public assertTypes(types: ReadonlySet<dexutil.Type>, user: MoveUserSnapshot,
        negative?: boolean): void
    {
        const method = negative ? "remove" : "narrow";
        let defaultType = this.data.type;
        switch (this.data.modifyType)
        {
            case "hpType": user.hpType[method](types); break;
            case "plateType":
                user.item[method]((_, i) =>
                    types.has(i.plateType ?? this.data.type));
                break;
            case "???":
                defaultType = "???";
                // fallthrough
            default:
                if (!!negative === types.has(defaultType))
                {
                    throw new Error(`Move of type '${defaultType}' cannot be ` +
                        `asserted to${negative ? "" : " not"} be of type ` +
                        `[${[...types].join(", ")}]`);
                }
        }
    }

    /**
     * Adds a callback to wait until it can be confirmed whether, if this Move
     * was used by the given Pokemon, that it would be of one of the given
     * types.
     * @param types Expected possible move types.
     * @param user Move user.
     * @param cb Callback to wait. Called with `held=true` if the assertion
     * holds, or `held=false` if it doesn't.
     * @returns A callback to deregister the given callback.
     */
    public onUpdateTypes(types: Set<dexutil.Type>, user: MoveUserSnapshot,
        cb: (held: boolean) => void): () => void
    {
        // early return: move type already known
        const moveType = this.getDefiniteType(user);
        if (moveType)
        {
            cb(/*held*/ types.has(moveType));
            return () => {};
        }

        switch (this.data.modifyType)
        {
            case "hpType":
                // types must be shared by hpType
                return user.hpType.onUpdate(types, cb);
            case "plateType":
                // item must cause the move to become one of the types
                // optimization: keep subsets small since only a couple items
                //  have a plateType
                if (types.has(this.data.type))
                {
                    // kept=false iff the user has a plate item that isn't of
                    //  the possible types
                    // TODO: replace predicate with set of plate items
                    return user.item.onUpdate(
                        (_, i) => !!i.plateType && !types.has(i.plateType),
                        kept => cb(!kept));
                }
                // kept=true iff the user has a plate item that is of the
                //  possible types (equivalent to above case)
                return user.item.onUpdate(
                    (_, i) => !!i.plateType && types.has(i.plateType),
                    cb);
            case "???":
                // should've been handled by `#getDefiniteType()`
                // fallthrough
            default:
                // istanbul ignore next: should never happen
                throw new Error(`Unsupported modifyType string ` +
                    `'${this.data.modifyType}'`);
        }
    }

    //#endregion
}
