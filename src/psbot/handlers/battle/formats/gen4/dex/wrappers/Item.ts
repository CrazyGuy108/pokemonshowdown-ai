import { SubParserConfig, SubParserResult } from "../../../../../../../battle/parser/BattleParser";
import { ItemResult } from "../../parser/activateItem";
import { handlers as base } from "../../parser/base";
import { SubReason } from "../../parser/EventInference";
import { cantHaveKlutz, checkKlutz, hasAbility, isAt1HP, moveIsType } from
    "../../parser/helpers";
import * as parsers from "../../parser/parsers";
import { ItemConsumeResult } from "../../parser/removeItem";
import { consume, hasStatus, matchPercentDamage, tryPeek, verify } from
    "../../../../../../../battle/parser/helpers";
import { Pokemon } from "../../state/Pokemon";
import { Side } from "../../state/Side";
import * as dexutil from "../dex-util";
import { getAttackerTypes, getTypeEffectiveness } from "../typechart";

/** Encapsulates item properties. */
export class Item
{
    // TODO: eventually make #data inaccessible apart from internal dex
    /**
     * Creates an Item data wrapper.
     * @param data Item data from dex.
     */
    constructor(public readonly data: dexutil.ItemData) {}

    //#region onX() effect parsers for main activateItem parser

    // note: each of these parsers assumes that the initial activateItem event
    //  hasn't been consumed/verified yet

    //#region on-movePostDamage parser

    /**
     * Activates an item on-`movePostDamage` (e.g. lifeorb).
     * @param holderRef Item holder reference.
     */
    public async onMovePostDamage(cfg: SubParserConfig, holderRef: Side):
        Promise<ItemResult>
    {
        if (this.data.on?.movePostDamage)
        {
            // self-damage
            if (this.data.on.movePostDamage.percentDamage)
            {
                this.indirectDamage(cfg, holderRef);
                await this.verifyActivate(cfg, holderRef);

                const damageResult = await parsers.percentDamage(cfg, holderRef,
                        this.data.on.movePostDamage.percentDamage);
                if (damageResult.success === true)
                {
                    await parsers.update(cfg);
                    return {};
                }
                throw new Error("On-movePostDamage percentDamage effect " +
                    "failed");
            }
        }
        throw new Error("On-movePostDamage effect shouldn't activate for " +
            `item '${this.data.name}'`);
    }

    //#endregion

    //#region on-turn parser

    /**
     * Handles events due to a turn item (e.g. leftovers).
     * @param holderRef Item holder reference.
     */
    public async onTurn(cfg: SubParserConfig, holderRef: Side):
        Promise<ItemResult>
    {
        const holder = cfg.state.teams[holderRef].active;
        if (this.data.on?.turn)
        {
            await this.verifyActivate(cfg, holderRef);
            let allSilent = true;

            // leftovers, blacksludge, etc
            const isPoison = holder.types.includes("poison");
            const percentDamage =
                this.data.on.turn[isPoison ? "poisonDamage" : "noPoisonDamage"];
            if (percentDamage)
            {
                const damageResult = await parsers.percentDamage(cfg, holderRef,
                        percentDamage);
                if (damageResult.success === true)
                {
                    this.indirectDamage(cfg, holderRef);
                    allSilent = false;
                }
            }

            // toxicorb, etc
            if (this.data.on.turn.status)
            {
                const statusResult = await parsers.status(cfg, holderRef,
                        [this.data.on.turn.status]);
                if (statusResult.success === this.data.on.turn.status)
                {
                    allSilent = false;
                }
            }

            if (!allSilent) return {};
        }
        throw new Error("On-turn effect shouldn't activate for item " +
            `'${this.data.name}'`);
    }

    //#endregion

    //#region onX() method helpers

    /**
     * Verifies and consumes the initial activateItem event to verify that it
     * may be relevant for this Item obj.
     * @param holderRef Item holder reference.
     */
    private async verifyActivate(cfg: SubParserConfig, holderRef: Side):
        Promise<void>
    {
        const event = await verify(cfg, "activateItem");
        if (event.monRef !== holderRef)
        {
            throw new Error(`Mismatched monRef: expected '${holderRef}' but ` +
                `got '${event.monRef}'`);
        }
        if (event.item !== this.data.name)
        {
            throw new Error("Mismatched item: expected " +
                `'${this.data.name}' but got '${event.item}'`);
        }
        await consume(cfg);
    }

    /**
     * Indicates that the item holder received indirect damage from the item, in
     * order to make ability inferences.
     */
    private indirectDamage(cfg: SubParserConfig, holderRef: Side): void
    {
        const holder = cfg.state.teams[holderRef].active;
        if (holder.volatile.suppressAbility) return;

        // can't have an ability that blocks indirect damage
        const ability = holder.traits.ability;
        const filteredAbilities =
            [...ability.possibleValues]
                .filter(n => ability.map[n].flags?.noIndirectDamage === true);
        if (filteredAbilities.length >= ability.size)
        {
            throw new Error(`Pokemon '${holderRef}' received indirect damage ` +
                `from item '${this.data.name}' even though its ability ` +
                `[${[...ability.possibleValues].join(", ")}] suppresses that ` +
                "damage");
        }
        ability.remove(filteredAbilities);
    }

    //#endregion

    //#endregion

    //#region consumeOnX() effect parsers for main removeItem parser

    //#region consumeOn-preMove parser

    /**
     * Activates an item on-`preMove` (e.g. custapberry).
     * @param holderRef Item holder reference.
     */
    public async consumeOnPreMove(cfg: SubParserConfig, holderRef: Side):
        Promise<ItemConsumeResult>
    {
        if (this.data.consumeOn?.preMove)
        {
            if (this.data.consumeOn.preMove.moveFirst &&
                this.data.consumeOn.preMove.threshold)
            {
                const holder = cfg.state.teams[holderRef].active;
                Item.assertHPThreshold(holder,
                    this.data.consumeOn.preMove.threshold);
                await this.verifyConsume(cfg, holderRef);
                return {moveFirst: true};
            }
        }
        throw new Error(`ConsumeOn-preMove effect shouldn't activate for ` +
            `item '${this.data.name}'`);
    }

    //#endregion

    //#region consumeOn-moveCharge parser

    /**
     * Activates an item on-`moveCharge` (e.g. powerherb).
     * @param holderRef Item holder reference.
     */
    public async consumeOnMoveCharge(cfg: SubParserConfig, holderRef: Side):
        Promise<ItemConsumeResult>
    {
        if (this.data.consumeOn?.moveCharge)
        {
            if (this.data.consumeOn.moveCharge === "shorten")
            {
                await this.verifyConsume(cfg, holderRef);
                return {shorten: true};
            }
        }
        throw new Error(`ConsumeOn-moveCharge effect shouldn't activate for ` +
            `item '${this.data.name}'`);
    }

    //#endregion

    //#region consumeOn-preHit parser

    /**
     * Activates an item on-`preHit` (e.g. resist berries).
     * @param holderRef Item holder reference.
     * @param hitBy Move+user the holder is being hit by.
     */
    public async consumeOnPreHit(cfg: SubParserConfig, holderRef: Side,
        hitBy: dexutil.MoveAndUser): Promise<ItemConsumeResult>
    {
        const holder = cfg.state.teams[holderRef].active;
        if (this.data.consumeOn?.preHit)
        {
            const {resistSuper} = this.data.consumeOn.preHit;
            if (resistSuper)
            {
                // assert that the holder is weak to this type
                const {types} = holder;
                const eff = getTypeEffectiveness(types, resistSuper);
                if (eff !== "super")
                {
                    // TODO: log error instead of throwing?
                    throw new Error("Expected type effectiveness to be " +
                        `'super' but got '${eff}' for '${resistSuper}' vs ` +
                        `[${types.join(", ")}]`);
                }

                // infer move type based on resist berry type
                hitBy.move.assertType(resistSuper, hitBy.user);
                await this.verifyConsume(cfg, holderRef);
                return {resistSuper};
            }
        }
        throw new Error(`ConsumeOn-preHit effect shouldn't activate for ` +
            `item '${this.data.name}'`);
    }

    //#endregion

    //#region consumeOn-tryOHKO parser

    /**
     * Activates an item on-`tryOHKO` (e.g. focussash).
     * @param holderRef Item holder reference.
     */
    public async consumeOnTryOHKO(cfg: SubParserConfig, holderRef: Side):
        Promise<ItemConsumeResult>
    {
        const tryOHKO = this.data.consumeOn?.tryOHKO;
        if (tryOHKO)
        {
            if (tryOHKO === "block")
            {
                await this.verifyConsume(cfg, holderRef);
                return {};
            }
        }
        throw new Error(`ConsumeOn-tryOHKO effect shouldn't activate for ` +
            `item '${this.data.name}'`);
    }

    //#endregion

    //#region consumeOn-super parser

    /**
     * Activates an item on-`super` (e.g. enigmaberry).
     * @param holderRef Item holder reference.
     */
    public async consumeOnSuper(cfg: SubParserConfig, holderRef: Side):
        Promise<ItemConsumeResult>
    {
        if (this.data.consumeOn?.super)
        {
            await this.verifyConsume(cfg, holderRef);
            const {heal} = this.data.consumeOn.super;
            // TODO: assert type effectiveness from hitby-move?
            if (heal) return await Item.heal(cfg, "super", holderRef, heal);
        }
        throw new Error(`ConsumeOn-super effect shouldn't activate for ` +
            `item '${this.data.name}'`);
    }

    //#endregion

    //#region consumeOn-postHit parser

    /**
     * Activates an item on-`postHit` (e.g. jabocaberry/rowapberry).
     * @param holderRef Item holder reference.
     * @param hitBy Move+user the holder is being hit by.
     */
    public async consumeOnPostHit(cfg: SubParserConfig, holderRef: Side,
        hitBy: dexutil.MoveAndUserRef): Promise<ItemConsumeResult>
    {
        if (this.data.consumeOn?.postHit)
        {
            const {condition, damage} = this.data.consumeOn.postHit;
            if (hitBy.move.data.category !== condition)
            {
                throw new Error("Mismatched move category: expected " +
                    `'${condition}' but got '${hitBy.move.data.category}'`);
            }
            if (damage)
            {
                await this.verifyConsume(cfg, holderRef);
                const damageResult = await parsers.percentDamage(cfg,
                    hitBy.userRef, -damage);
                if (!damageResult.success)
                {
                    throw new Error("ConsumeOn-postHit damage effect failed");
                }
                if (damageResult.success === true)
                {
                    // after taking damage, check if any other items need to
                    //  activate
                    await parsers.update(cfg);
                }
                return {};
            }
        }
        throw new Error(`ConsumeOn-postHit effect shouldn't activate for ` +
            `item '${this.data.name}'`);
    }

    //#endregion

    //#region consumeOn-update parser

    /**
     * Activates an item on-`update` (e.g. sitrusberry).
     * @param holderRef Item holder reference.
     */
    public async consumeOnUpdate(cfg: SubParserConfig, holderRef: Side):
        Promise<ItemConsumeResult>
    {
        const holder = cfg.state.teams[holderRef].active;
        const data = this.data.consumeOn?.update;
        switch (data?.condition)
        {
            case "hp":
                Item.assertHPThreshold(holder, data.threshold);
                switch (data.effect.type)
                {
                    case "healPercent": case "healFixed":
                    {
                        await this.verifyConsume(cfg, holderRef);
                        await Item.heal(cfg, "update", holderRef,
                            data.effect.heal);
                        if (data.effect.dislike)
                        {
                            // TODO: assert dislike nature
                            await parsers.status(cfg, holderRef, ["confusion"]);
                        }
                        return {};
                    }
                    case "boost":
                    {
                        await this.verifyConsume(cfg, holderRef);
                        const boostResult = await parsers.boostOne(cfg,
                            holderRef, data.effect.boostOne);
                        if (!boostResult.success)
                        {
                            throw new Error("ConsumeOn-update boost effect " +
                                "failed");
                        }
                        return {};
                    }
                    case "focusEnergy":
                    {
                        await this.verifyConsume(cfg, holderRef);
                        const statusResult = await parsers.status(cfg,
                            holderRef, ["focusEnergy"]);
                        if (!statusResult.success)
                        {
                            throw new Error("ConsumeOn-update focusEnergy " +
                                "effect failed");
                        }
                        return {};
                    }
                    default:
                        // istanbul ignore next: should never happen
                        throw new Error("ConsumeOn-update effect failed: " +
                            `Unknown effect type '${data.effect!.type}'`);
                }
            case "status":
            {
                await this.verifyConsume(cfg, holderRef);
                // cure all the relevant statuses
                const statusResult = await parsers.cure(cfg, holderRef,
                    Object.keys(data.cure) as dexutil.StatusType[]);
                if (statusResult.ret !== true && statusResult.ret !== "silent")
                {
                    throw new Error("ConsumeOn-update cure effect failed");
                }
                return {};
            }
            case "depleted":
            {
                await this.verifyConsume(cfg, holderRef);
                // restore pp
                const event = await tryPeek(cfg);
                if (event?.type !== "modifyPP" || event.monRef !== holderRef ||
                    event.amount !== data.restore)
                {
                    throw new Error("ConsumeOn-update restore effect failed");
                }
                await base.modifyPP(cfg);
                return {};
            }
        }
        // istanbul ignore next: should never happen
        throw new Error(`ConsumeOn-update effect shouldn't activate for ` +
            `item '${this.data.name}'`);
    }

    //#endregion

    //#region consumeOn-residual parser

    /**
     * Activates an item on-`residual` (e.g. micleberry).
     * @param holderRef Item holder reference.
     */
    public async consumeOnResidual(cfg: SubParserConfig, holderRef: Side):
        Promise<ItemConsumeResult>
    {
        if (this.data.consumeOn?.residual)
        {
            const holder = cfg.state.teams[holderRef].active;
            Item.assertHPThreshold(holder,
                this.data.consumeOn.residual.threshold);
            if (this.data.consumeOn.residual.status === "micleberry")
            {
                holder.volatile.micleberry = true;
                await this.verifyConsume(cfg, holderRef);
                return {};
            }
        }
        throw new Error(`ConsumeOn-residual effect shouldn't activate for ` +
            `item '${this.data.name}'`);
    }

    //#endregion

    //#region consumeOnX() method helpers

    /**
     * Verifies and consumes the initial activateItem event to verify that it
     * may be relevant for this Item obj.
     * @param holderRef Item holder reference.
     */
    private async verifyConsume(cfg: SubParserConfig, holderRef: Side):
        Promise<void>
    {
        const event = await verify(cfg, "removeItem");
        if (event.monRef !== holderRef)
        {
            throw new Error(`Mismatched monRef: expected '${holderRef}' but ` +
                `got '${event.monRef}'`);
        }
        if (event.consumed !== this.data.name)
        {
            throw new Error("Mismatched item: expected " +
                `'${this.data.name}' but got '${event.consumed}'`);
        }
        await consume(cfg);
    }

    /** Makes HP/ability assertions based on item activation HP threshold. */
    private static assertHPThreshold(holder: Pokemon, threshold: number): void
    {
        const percentHP = 100 * holder.hp.current / holder.hp.max;
        if (threshold === 25 && percentHP > 25 && percentHP <= 50)
        {
            if (holder.volatile.suppressAbility)
            {
                throw new Error("Holder must have early-berry (gluttony) " +
                    "ability but ability is suppressed");
            }
            holder.traits.ability.narrow((_, a) => !!a.flags?.earlyBerry);
        }
        else if (percentHP > threshold)
        {
            throw new Error(`Holder expected to have HP (${percentHP}%) to ` +
                `be below the item's activation threshold of ${threshold}%`);
        }
    }

    /** Handles heal effect from items. */
    private static async heal(cfg: SubParserConfig, on: dexutil.ItemConsumeOn,
        holderRef: Side, percent: number): Promise<SubParserResult>
    {
        const healResult = await parsers.percentDamage(cfg, holderRef,
            percent);
        if (!healResult.success)
        {
            throw new Error(`ConsumeOn-${on} heal effect failed`);
        }
        return {};
    }

    //#endregion

    //#endregion

    //#region canX() SubReason builders for onX() activateItem parsers

    //#region on-movePostDamage reason

    /**
     * Checks whether the item can activate on-`movePostDamage`.
     * @param mon Potential item holder.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canMovePostDamage(mon: Pokemon): Set<SubReason> | null
    {
        if (!this.data.on?.movePostDamage) return null;

        // check for abilities that would block the item
        // can't be blocked if ability is suppressed
        if (mon.volatile.suppressAbility) return new Set();

        const abilities = new Set(mon.traits.ability.possibleValues);
        // if the effect is silent or nonexistent, leave it
        const percent = this.data.on.movePostDamage.percentDamage;
        if (percent && !matchPercentDamage(percent, mon.hp.current, mon.hp.max))
        {
            // filter ability possibilities that can block the remaining effects
            // if one effect can't be suppressed, then the item should activate
            for (const abilityName of abilities)
            {
                const ability = mon.traits.ability.map[abilityName];
                if (ability.flags?.ignoreItem) continue;
                if (percent < 0 &&
                    ability.flags?.noIndirectDamage === true)
                {
                    continue;
                }
                abilities.delete(abilityName);
            }
        }
        else return null;
        if (abilities.size <= 0) return new Set();
        if (abilities.size >= mon.traits.ability.size) return null;
        return new Set([hasAbility(mon, abilities, /*negative*/ true)]);
    }

    //#endregion

    //#endregion

    //#region canConsumeX() SubReason builders for consumeOnX() removeItem
    //  parsers

    //#region consumeOn-preMove reason

    /**
     * Checks whether the item can activate consumeOn-`preMove`.
     * @param mon Potential item holder.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canConsumePreMove(mon: Pokemon): Set<SubReason> | null
    {
        if (!this.data.consumeOn?.preMove) return null;
        return this.checkHPThreshold(mon,
            this.data.consumeOn.preMove.threshold);
    }

    //#endregion

    //#region consumeOn-moveCharge reason

    /**
     * Checks whether the item can activate consumeOn-`moveCharge`.
     * @param mon Potential item holder.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canConsumeMoveCharge(mon: Pokemon): Set<SubReason> | null
    {
        if (!this.data.consumeOn?.moveCharge) return null;
        if (this.data.consumeOn.moveCharge === "shorten")
        {
            return cantHaveKlutz(mon);
        }
        return null;
    }

    //#endregion

    //#region consumeOn-preHit reason

    /**
     * Checks whether the item can activate consumeOn-`preHit`.
     * @param mon Potential item holder.
     * @param hitBy Move+user the holder was hit by.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canConsumePreHit(mon: Pokemon, hitBy: dexutil.MoveAndUser):
        Set<SubReason> | null
    {
        if (!this.data.consumeOn?.preHit) return null;

        const result = cantHaveKlutz(mon);
        if (!result) return null;

        const {resistSuper} = this.data.consumeOn.preHit;
        if (resistSuper)
        {
            // can't activate if holder isn't weak to the type this item
            //  protects against (unless normal)
            if (resistSuper !== "normal" &&
                getTypeEffectiveness(mon.types, resistSuper) !== "super")
            {
                return null;
            }
            // can't activate for moves that can never be super-effective
            if (!hitBy.move.canBeEffective) return null;
            // will only work then if the move type is the protected type
            // TODO: don't add if already proven/disproven
            result.add(moveIsType(hitBy.move, hitBy.user,
                new Set([resistSuper])));
        }
        return result;
    }

    //#endregion

    //#region consumeOn-tryOHKO reason

    /**
     * Checks whether the item can activate consumeOn-`tryOHKO`.
     * @param mon Potential item holder.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canConsumeTryOHKO(mon: Pokemon): Set<SubReason> | null
    {
        if (!this.data.consumeOn?.tryOHKO) return null;
        const {tryOHKO} = this.data.consumeOn;
        if (tryOHKO !== "block") return null;

        const result = cantHaveKlutz(mon);
        if (!result) return null;

        const activate = isAt1HP(mon);
        if (!activate) return null;
        for (const reason of activate) result.add(reason);

        return result;
    }

    //#endregion

    //#region consumeOn-super reason

    /**
     * Checks whether the item can activate consumeOn-`super`.
     * @param mon Potential item holder.
     * @param hitBy Move+user the holder was hit by.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canConsumeSuper(mon: Pokemon, hitBy: dexutil.MoveAndUser):
        Set<SubReason> | null
    {
        if (!this.data.consumeOn?.super) return null;

        const result = cantHaveKlutz(mon);
        if (!result || !hitBy.move.canBeEffective) return null;
        // move must be super-effective
        result.add(moveIsType(hitBy.move, hitBy.user,
                getAttackerTypes(mon.types, "super")))
        return result;
    }

    //#endregion

    //#region consumeOn-postHit reason

    /**
     * Checks whether the item can activate consumeOn-`postHit`.
     * @param mon Potential item holder.
     * @param hitBy Move+user the holder was hit by.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canConsumePostHit(mon: Pokemon, hitBy: dexutil.MoveAndUser):
        Set<SubReason> | null
    {
        if (!this.data.consumeOn?.postHit) return null;

        if (this.data.consumeOn.postHit.condition === hitBy.move.data.category)
        {
            // items with -damage will activate even if opponent's hp = 0
            // can likely assume the same for +damage items, but such a case
            //  would be harder to test
            return cantHaveKlutz(mon);
        }
        return null;
    }

    //#endregion

    //#region consumeOn-update reason

    /**
     * Checks whether the item can activate consumeOn-`update`.
     * @param mon Potential item holder.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canConsumeUpdate(mon: Pokemon): Set<SubReason> | null
    {
        if (mon.fainted) return null;
        switch (this.data.consumeOn?.update?.condition)
        {
            case "hp":
                return this.checkHPThreshold(mon,
                        this.data.consumeOn.update.threshold);
            case "status":
            {
                const {cure} = this.data.consumeOn.update;
                let canCure = false;
                for (const status in cure)
                {
                    if (!cure.hasOwnProperty(status)) continue;
                    if (canCure ||=
                        hasStatus(mon, status as dexutil.StatusType))
                    {
                        break;
                    }
                }
                if (!canCure) return null;
                return cantHaveKlutz(mon);
            }
            case "depleted":
                for (const move of mon.moveset.moves.values())
                {
                    // TODO: pp may be uncertain in corner cases, handle
                    //  these then add a SubReason to support this later
                    if (move.pp > 0) continue;
                    return cantHaveKlutz(mon);
                }
                // fallthrough
            default: return null;
        }
    }

    //#endregion

    //#region consumeOn-residual reason

    /**
     * Checks whether the item can activate consumeOn-`residual`.
     * @param mon Potential item holder.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canConsumeResidual(mon: Pokemon): Set<SubReason> | null
    {
        if (!this.data.consumeOn?.residual) return null;
        return this.checkHPThreshold(mon,
            this.data.consumeOn.residual.threshold);
    }

    //#endregion

    //#region canConsumeX() method helpers

    /**
     * Checks whether the described HP threshold item can activate for the
     * holder.
     * @param mon Potential item holder.
     * @param threshold Item activation HP threshold.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    private checkHPThreshold(mon: Pokemon, threshold: number):
        Set<SubReason> | null
    {
        // TODO: is percentHP reliable? how does PS/cart handle rounding?
        const percentHP = 100 * mon.hp.current / mon.hp.max;

        // can't infer abilities
        if (mon.volatile.suppressAbility)
        {
            if (percentHP <= threshold) return new Set();
            return null;
        }

        const {ability} = mon.traits; // shorthand

        const blockingAbilities = checkKlutz(mon);
        if (blockingAbilities.size >= ability.size) return null;

        // hp is between 25-50% so the 25% berry can't activate on it's own, but
        //  it can if the holder has gluttony ability
        if (this.data.isBerry && threshold === 25 && percentHP > 25 &&
            percentHP <= 50 &&
            [...ability.possibleValues].some(n =>
                ability.map[n].flags?.earlyBerry))
        {
            // TODO: PossibilityClass methods that abstract away #possibleValues
            //  set manipulations
            // all other non-gluttony abilities therefore block the activation
            //  of this item
            const abilities = [...ability.possibleValues].filter(
                n => !ability.map[n].flags?.earlyBerry);
            for (const n of abilities) blockingAbilities.add(n);
        }
        // gluttony isn't applicable, just do regular hp check
        else if (percentHP > threshold) return null;

        if (blockingAbilities.size <= 0) return new Set();
        if (blockingAbilities.size >= ability.size) return null;
        return new Set([hasAbility(mon, blockingAbilities, /*negative*/ true)]);
    }

    //#endregion

    //#endregion
}
