import { Protocol } from "@pkmn/protocol";
import { BoostID, SideID } from "@pkmn/types";
import { Type, WeatherType } from "..";
import { toIdName } from "../../../../../../helpers";
import { Event } from "../../../../../../parser";
import { BattleParserContext, consume, eventLoop, inference, tryPeek, tryVerify,
    unordered, verify } from "../../../../parser";
import { dispatch, handlers as base } from "../../parser/base";
import { boost } from "../../parser/effect/boost";
import { percentDamage } from "../../parser/effect/damage";
import { updateItems } from "../../parser/effect/item";
import { hasStatus, status, StatusEventType } from "../../parser/effect/status";
import { chance, diffMoveType, hasAnItem, moveIsType } from
    "../../parser/reason";
import { Pokemon, ReadonlyPokemon } from "../../state/Pokemon";
import { getMove } from "../dex";
import { BoostTable, ItemData, ItemOn, StatusType } from "../dex-util";
import { getTypeEffectiveness } from "../typechart";
import { Move, MoveAndUser, MoveAndUserRef } from "./Move";

/** Result of `Item#consumeOnPreHit()`. */
export interface ItemConsumePreHitResult
{
    /** Resist berry type if applicable. */
    resistSuper?: Type;
}

/** Encapsulates item properties. */
export class Item
{
    // TODO: eventually make #data inaccessible apart from internal dex?
    /**
     * Creates an Item data wrapper.
     * @param data Item data from dex.
     */
    constructor(public readonly data: ItemData) {}

    //#region canX() SubReasons and onX() item effect parsers

    //#region on-movePostDamage

    /**
     * Activates an item on-`movePostDamage` (e.g. lifeorb).
     * @param accept Callback to accept this pathway.
     * @param side Item holder reference.
     */
    public async onMovePostDamage(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        if (!this.data.on?.movePostDamage) return;
        // self-damage
        if (this.data.on.movePostDamage.percentDamage)
        {
            const damageResult = await this.percentDamage(ctx, accept, side,
                this.data.on.movePostDamage.percentDamage);
            if (damageResult !== true) return;
            // this counts as indirect damage (blocked by magicguard)
            // TODO: make this a SubReason in #canMovePostDamage()
            this.indirectDamage(ctx, side);
        }
    }

    //#endregion

    //#region on-turn

    /**
     * Handles events due to a turn item (e.g. leftovers).
     * @param accept Callback to accept this pathway.
     * @param side Item holder reference.
     */
    public async onTurn(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        if (!this.data.on?.turn) return;
        // self-damage from leftovers, blacksludge, etc
        const holder = ctx.state.getTeam(side).active;
        const isPoison = holder.types.includes("poison");
        const percent =
            this.data.on.turn[isPoison ? "poisonDamage" : "noPoisonDamage"];
        if (percent)
        {
            const damageResult = await this.percentDamage(ctx, accept, side,
                    percent);
            if (damageResult !== true) return;
            this.indirectDamage(ctx, side);
        }
        // self-status from toxicorb, flameorb, etc
        else if (this.data.on.turn.status)
        {
            await this.status(ctx, accept, side,
                [this.data.on.turn.status]);
        }
    }

    //#endregion

    //#endregion

    //#region canConsumeX() SubReasons and onConsumeX() item effect parsers

    //#region consumeOn-preMove

    // TODO: custap hp check happens on pre-turn
    /**
     * Activates an item on-`preMove` (e.g. custapberry).
     * @param accept Callback to accept this pathway.
     * @param side Item holder reference.
     * @returns `"moveFirst"` if the holder is moving first in its priority
     * bracket due to the item. Otherwise `undefined`.
     */
    public async consumeOnPreMove(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID):
        Promise<"moveFirst" | undefined>
    {
        if (!this.data.consumeOn?.preMove) return;
        if (this.data.consumeOn.preMove.moveFirst &&
            this.data.consumeOn.preMove.threshold)
        {
            if (!await this.consumeItem(ctx, accept, side)) return;

            const holder = ctx.state.getTeam(side).active;
            Item.assertHPThreshold(holder,
                this.data.consumeOn.preMove.threshold);
            return "moveFirst";
        }
    }

    //#endregion

    //#region consumeOn-moveCharge

    /**
     * Activates an item on-`moveCharge` (e.g. powerherb).
     * @param accept Callback to accept this pathway.
     * @param side Item holder reference.
     * @returns `"shorten"` if the holder's two-turn move is being shortend to
     * one due to the item. Otherwise `undefined`.
     */
    public async consumeOnMoveCharge(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID):
        Promise<"shorten" | undefined>
    {
        if (!this.data.consumeOn?.moveCharge) return;
        if (this.data.consumeOn.moveCharge === "shorten")
        {
            if (!await this.consumeItem(ctx, accept, side)) return;
            return "shorten";
        }
    }

    //#endregion

    //#region consumeOn-preHit

    /**
     * Activates an item on-`preHit` (e.g. resist berries).
     * @param accept Callback to accept this pathway.
     * @param side Item holder reference.
     * @param hitBy Move+user the holder is being hit by.
     */
    public async consumeOnPreHit(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID, hitBy: MoveAndUser):
        Promise<ItemConsumePreHitResult>
    {
        if (!this.data.consumeOn?.preHit) return {};
        if (this.data.consumeOn.preHit.resistSuper)
        {
            return await this.resistSuper(ctx, accept, side, hitBy,
                this.data.consumeOn.preHit.resistSuper);
        }
        return {};
    }

    /**
     * Activates a resist berry item.
     * @param accept Callback to accept this pathway.
     * @param side Item holder reference.
     * @param hitBy Move+user the holder is being hit by.
     * @param moveType Resist berry type, which must match the `hitBy.move`
     * type.
     */
    private async resistSuper(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID, hitBy: MoveAndUser,
        moveType: Type): Promise<ItemConsumePreHitResult>
    {
        if (!await this.consumeItem(ctx, accept, side)) return {};

        // item effect is similar to the initial parsed consumeItem()
        //  event but with a [weaken] suffix instead of [eat]
        const event = await tryVerify(ctx, "|-enditem|");
        if (!event) return {};
        const [, identStr, itemName] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        if (ident.player !== side) return {};
        const itemId = toIdName(itemName);
        if (itemId !== this.data.name) return {};
        if (!event.kwArgs.weaken) return {};
        accept();
        // since this is sort of like a duplicate |-enditem| event we should
        //  just consume it here rather than try to handle it a second time
        await consume(ctx);

        // assert that the holder is weak to this type
        const holder = ctx.state.getTeam(side).active;
        const {types} = holder;
        const eff = getTypeEffectiveness(types, moveType);
        if (eff !== "super")
        {
            // TODO: log error instead of throw?
            throw new Error("Expected type effectiveness to be 'super' but " +
                `got '${eff}' for '${moveType}' vs [${types.join(", ")}]`);
        }

        // infer move type based on resist berry type
        hitBy.move.assertType(moveType, hitBy.user);
        return {resistSuper: moveType};
    }

    //#endregion

    //#region consumeOn-tryOHKO

    /**
     * Activates an item on-`tryOHKO` (e.g. focussash).
     * @param accept Callback to accept this pathway.
     * @param side Item holder reference.
     */
    public async consumeOnTryOHKO(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        const tryOHKO = this.data.consumeOn?.tryOHKO;
        if (!tryOHKO) return;
        if (tryOHKO === "block")
        {
            await this.consumeItem(ctx, accept, side);
        }
    }

    //#endregion

    //#region consumeOn-super

    /**
     * Activates an item on-`super` (e.g. enigmaberry).
     * @param accept Callback to accept this pathway.
     * @param side Item holder reference.
     */
    public async consumeOnSuper(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        if (!this.data.consumeOn?.super) return;
        // TODO: assert type effectiveness from hitby-move?
        if (this.data.consumeOn.super.heal)
        {
            await this.consumeItem(ctx, accept, side);
            let accepted = false;
            const damageResult = await this.percentDamage(ctx,
                () => accepted = true, side, this.data.consumeOn.super.heal);
            if (damageResult !== true || !accepted)
            {
                throw new Error("ConsumeOn-super heal effect failed");
            }
        }
    }

    //#endregion

    //#region consumeOn-postHit parser

    /**
     * Activates an item on-`postHit` (e.g. jabocaberry/rowapberry).
     * @param accept Callback to accept this pathway.
     * @param side Item holder reference.
     * @param hitBy Move+user the holder is being hit by.
     */
    public async consumeOnPostHit(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID, hitBy: MoveAndUserRef):
        Promise<void>
    {
        if (!this.data.consumeOn?.postHit) return;
        const {condition, damage} = this.data.consumeOn.postHit;
        if (hitBy.move.data.category !== condition) return;
        if (damage)
        {
            await this.consumeItem(ctx, accept, side);
            let accepted = false;
            const damageResult = await this.percentDamage(ctx,
                () => accepted = true, hitBy.userRef, -damage);
            if (damageResult !== true || !accepted)
            {
                throw new Error("ConsumeOn-postHit damage effect failed");
            }
            // after taking damage, check if any other items need to activate
            await updateItems(ctx);
        }
    }

    //#endregion

    //#region consumeOn-update parser

    /**
     * Activates an item on-`update` (e.g. sitrusberry).
     * @param accept Callback to accept this pathway.
     * @param side Item holder reference.
     */
    public async consumeOnUpdate(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        const holder = ctx.state.getTeam(side).active;
        const data = this.data.consumeOn?.update;
        switch (data?.condition)
        {
            case "hp":
                Item.assertHPThreshold(holder, data.threshold);
                switch (data.effect.type)
                {
                    case "healPercent": case "healFixed":
                    {
                        await this.verifyConsume(ctx, side);
                        await Item.heal(ctx, "update", side,
                            data.effect.heal);
                        if (data.effect.dislike)
                        {
                            // TODO: assert dislike nature
                            await parsers.status(ctx, side, ["confusion"]);
                        }
                        return {};
                    }
                    case "boost":
                    {
                        await this.verifyConsume(ctx, side);
                        const boostResult = await parsers.boostOne(ctx,
                            side, data.effect.boostOne);
                        if (!boostResult.success)
                        {
                            throw new Error("ConsumeOn-update boost effect " +
                                "failed");
                        }
                        return {};
                    }
                    case "focusEnergy":
                    {
                        await this.verifyConsume(ctx, side);
                        const statusResult = await parsers.status(ctx,
                            side, ["focusEnergy"]);
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
                await this.verifyConsume(ctx, side);
                // cure all the relevant statuses
                const statusResult = await parsers.cure(ctx, side,
                    Object.keys(data.cure) as dexutil.StatusType[]);
                if (statusResult.ret !== true && statusResult.ret !== "silent")
                {
                    throw new Error("ConsumeOn-update cure effect failed");
                }
                break;
            }
            case "depleted":
                return await this.updateDepleted(ctx, accept, side);
        }
    }

    /**
     * Activates an item on-`update` for condition=depleted (e.g. leppaberry).
     * @param accept Callback to accept this pathway.
     * @param side Item holder reference.
     */
    private async updateDepleted(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        const data = this.data.consumeOn?.update;
        if (data?.condition !== "depleted") return;
        if (data.restore)
        {
            await this.consumeItem(ctx, accept, side);
            const fail =
                (reason?: string) =>
                    this.updateFailed("depleted restore", reason);

            const event = await tryVerify(ctx, "|-activate|");
            if (!event) return fail("Missing |-activate| event");
            const [, identStr, effectStr, moveName] = event.args;
            Item.requireIdent(identStr, side, fail);
            this.requireEffectFromItem(effectStr, fail);
            Item.requireString(moveName, "move", fail);
            const moveId = toIdName(moveName);
            accept();

            const holder = ctx.state.getTeam(side).active;
            holder.moveset.reveal(moveId).pp += data.restore;
            await consume(ctx);
        }
    }

    // TODO: replace fail cb with aggregate errors
    private static requireIdent(str?: string, side?: SideID,
        fail?: (reason: string) => never):
        ReturnType<typeof Protocol["parsePokemonIdent"]>
    {
        fail ??= reason => { throw new Error(reason); };
        Item.requireString(str, "ident", fail);
        const ident = Protocol.parsePokemonIdent(str as Protocol.PokemonIdent);
        if (side && ident.player !== side)
        {
            return fail(`Expected ident '${side}' but got '${ident.player}'`);
        }
        return ident;
    }

    private requireEffectFromItem(str?: string,
        fail?: (reason: string) => never):
        ReturnType<typeof Protocol["parseEffect"]>
    {
        fail ??= reason => { throw new Error(reason); };
        if (!str) return fail("Missing effect");
        const effect = Protocol.parseEffect(str, toIdName);
        if (!this.isEffectFromItem(effect))
        {
            return fail(
                `Expected item '${this.data.name}' but got '${effect?.name}'`);
        }
        return effect;
    }

    private static requireString(str?: string, name?: string,
        fail?: (reason: string) => never): asserts str is string
    {
        if (str) return;
        fail ??= reason => { throw new Error(reason); };
        name ??= "string";
        return fail(`Missing ${name}`);
    }

    private updateFailed(effectName: string, reason?: string): never
    {
        let s = `ConsumeOn-update ${effectName} effect failed`;
        if (reason) s += ": " + reason;
        throw new Error(s);
    }

    //#endregion

    //#region consumeOn-residual parser

    /**
     * Activates an item on-`residual` (e.g. micleberry).
     * @param side Item holder reference.
     */
    public async consumeOnResidual(ctx: BattleParserContext<"gen4">, side: SideID):
        Promise<ItemConsumeResult>
    {
        if (this.data.consumeOn?.residual)
        {
            const holder = ctx.state.teams[side].active;
            Item.assertHPThreshold(holder,
                this.data.consumeOn.residual.threshold);
            if (this.data.consumeOn.residual.status === "micleberry")
            {
                holder.volatile.micleberry = true;
                await this.verifyConsume(ctx, side);
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
     * @param side Item holder reference.
     */
    private async verifyConsume(ctx: BattleParserContext<"gen4">, side: SideID):
        Promise<void>
    {
        const event = await verify(ctx, "removeItem");
        if (event.monRef !== side)
        {
            throw new Error(`Mismatched monRef: expected '${side}' but ` +
                `got '${event.monRef}'`);
        }
        if (event.consumed !== this.data.name)
        {
            throw new Error("Mismatched item: expected " +
                `'${this.data.name}' but got '${event.consumed}'`);
        }
        await consume(ctx);
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
    private static async heal(ctx: BattleParserContext<"gen4">, on: dexutil.ItemConsumeOn,
        side: SideID, percent: number): Promise<SubParserResult>
    {
        const healResult = await parsers.percentDamage(ctx, side,
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

    //#region consumeOn-x helper methods

    /**
     * Expects the initial `|-enditem|<holder>|<item>` event for consuming an
     * Item.
     * @param accept Callback to accept this pathway.
     * @param side Item holder reference.
     * @returns `true` if parsed, `undefined` otherwise.
     */
    private async consumeItem(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID):
        Promise<true | undefined>
    {
        const event = await tryVerify(ctx, "|-enditem|");
        if (!event) return;
        const [, identStr, itemName] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        if (ident.player !== side) return;
        const itemId = toIdName(itemName);
        if (itemId !== this.data.name) return;
        // berries have to be explicitly eaten to gain their effect
        if (this.data.isBerry && !event.kwArgs.eat) return;
        // this event is caused by resistSuper berries but only after the
        //  current initial [eat] event that we're parsing
        if (event.kwArgs.weaken) return;
        // differentiate from item-removal/stealeat move effects
        if (event.kwArgs.from || event.kwArgs.move || event.kwArgs.of) return;
        accept();
        await base["|-enditem|"](ctx);
        return true;
    }

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
        Set<inference.SubReason> | null
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

    //#region on-x/consumeOn-x helper methods

    /**
     * Expects an event for a percent-damage effect with the correct `[from]`
     * suffix.
     * @param accept Callback to accept this pathway.
     * @param side Pokemon reference receiving the damage.
     * @param percent Percent damage to deal.
     * @param of Pokemon that should be referenced by the event's `[of]` suffix.
     * Optional.
     * @returns `true` if the effect was parsed, `"silent"` if the effect is a
     * no-op, or `undefined` if the effect wasn't parsed.
     * @see {@link percentDamage}
     */
    private async percentDamage(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID, percent: number,
        of?: SideID): ReturnType<typeof percentDamage>
    {
        return await percentDamage(ctx, side, percent,
            event =>
            {
                if (!this.isEventFromItem(event)) return false;
                if (of)
                {
                    if (!event.kwArgs.of) return false;
                    const identOf = Protocol.parsePokemonIdent(event.kwArgs.of);
                    if (identOf.player !== of) return false;
                }
                accept();
                return true;
            });
    }

    /**
     * Expects an event for a status effect with the correct `[from]` suffix.
     * @param accept Callback to accept this pathway.
     * @param side Pokemon reference to which to afflict the status.
     * @param statusTypes Possible statuses to afflict.
     * @param of Pokemon that should be referenced by the event's `[of]` suffix.
     * Optional.
     * @returns The status type that was consumed, or `true` if the effect
     * couldn't be applied and was a no-op, or `undefined` if no valid event was
     * found.
     * @see {@link status}
     */
    private async status(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID,
        statusTypes: readonly StatusType[], of?: SideID):
        ReturnType<typeof status>
    {
        return await status(ctx, side, statusTypes,
            event =>
            {
                if (event.args[0] !== "-message")
                {
                    const e = event as
                        Event<Exclude<StatusEventType, "|-message|">>;
                    if (!this.isEventFromItem(e)) return false;
                    if (of)
                    {
                        if (!e.kwArgs.of) return false;
                        const identOf = Protocol.parsePokemonIdent(e.kwArgs.of);
                        if (identOf.player !== of) return false;
                    }
                }
                accept();
                return true;
            });
    }

    /** Verifies that the event's `[from]` effect suffix matches this Item. */
    private isEventFromItem(event: Event<Protocol.BattleArgsWithKWArgName>):
        boolean
    {
        const from = Protocol.parseEffect((event.kwArgs as any).from, toIdName);
        return this.isEffectFromItem(from);
    }

    /** Verifies that a parsed effect string matches this Item. */
    private isEffectFromItem(
        effect: ReturnType<typeof Protocol["parseEffect"]>): boolean
    {
        return (!effect.type || effect.type === "item") &&
            effect.name === this.data.name;
    }

    /**
     * Indicates that the item holder received indirect damage from the item, in
     * order to make ability inferences.
     */
    private indirectDamage(ctx: BattleParserContext<"gen4">, side: SideID): void
    {
        const holder = ctx.state.getTeam(side).active;
        if (holder.volatile.suppressAbility) return;

        // can't have an ability that blocks indirect damage
        const ability = holder.traits.ability;
        const filteredAbilities =
            [...ability.possibleValues]
                .filter(n => ability.map[n].flags?.noIndirectDamage === true);
        if (filteredAbilities.length >= ability.size)
        {
            throw new Error(`Pokemon '${side}' received indirect damage ` +
                `from item '${this.data.name}' even though its ability ` +
                `[${[...ability.possibleValues].join(", ")}] suppresses that ` +
                "damage");
        }
        ability.remove(filteredAbilities);
    }

    //#endregion
}
