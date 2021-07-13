import { Protocol } from "@pkmn/protocol";
import { BoostID, SideID } from "@pkmn/types";
import { Type, WeatherType } from "..";
import { toIdName } from "../../../../../../helpers";
import { Event } from "../../../../../../parser";
import { BattleParserContext, consume, eventLoop, inference, tryPeek, tryVerify,
    unordered, verify } from "../../../../parser";
import { dispatch, handlers as base } from "../../parser/base";
import { boost } from "../../parser/effect/boost";
import { isPercentDamageSilent, verifyPercentDamage } from
    "../../parser/effect/damage";
import { updateItems } from "../../parser/effect/item";
import { isStatusSilent, verifyStatus } from "../../parser/effect/status";
import { chance, diffMoveType, hasAnItem, moveIsType } from
    "../../parser/reason";
import { Pokemon, ReadonlyPokemon } from "../../state/Pokemon";
import { getMove } from "../dex";
import { AbilityData, AbilityOn, BoostTable, StatusType } from "../dex-util";
import { Move, MoveAndUser, MoveAndUserRef } from "./Move";

/** Result from `Ability#onBlock(). */
export interface AbilityBlockResult
{
    /** Statuses to block. */
    blockStatus?: {[T in StatusType]?: true};
    /**
     * Whether the ability activated to grant an immunity to the move being used
     * against the holder.
     */
    immune?: true;
    /** Whether the ability caused the move to fail completely. */
    failed?: true;
}

// TODO: data wrappers may need SRP refactoring and/or complete removal
/** Encapsulates ability properties. */
export class Ability
{
    // TODO: eventually make #data inaccessible apart from internal dex
    /**
     * Creates an Ability data wrapper.
     * @param data Ability data from dex.
     */
    constructor(public readonly data: AbilityData) {}

    //#region canX() SubInference builders and onX() ability effect parsers

    //#region on-switchOut

    /**
     * Checks whether the ability can activate on-`switchOut`.
     * @param mon Potential ability holder.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canSwitchOut(mon: ReadonlyPokemon): Set<inference.SubReason> | null
    {
        return mon.majorStatus.current && this.data.on?.switchOut?.cure ?
            new Set() : null;
    }

    /**
     * Activates an ability on-`switchOut`.
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     */
    public async onSwitchOut(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        if (!this.data.on?.switchOut) return;
        // cure major status
        if (this.data.on.switchOut.cure)
        {
            return await this.cureMajorStatus(ctx, accept, side);
        }
    }

    // onSwitchOut() helpers

    private async cureMajorStatus(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        const event = await verify(ctx, "|-curestatus|");
        const [, identStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        // TODO: provide reasons for failure to parse
        if (ident.player !== side) return;
        const from = Protocol.parseEffect(event.kwArgs.from, toIdName);
        if (from.type && from.type !== "ability") return;
        if (from.name !== this.data.name) return;
        if (!this.isEventFromAbility(event)) return;
        accept();
        await base["|-curestatus|"](ctx);
    }

    //#endregion

    //#region on-start

    /**
     * Checks whether the ability can activate on-`start`.
     * @param mon Potential ability holder.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canStart(mon: Pokemon): Set<inference.SubReason> | null
    {
        if (!this.data.on?.start) return null;
        // activate on a certain status immunity to cure it
        const canCure = this.canCureImmunity("start", mon);
        if (canCure) return new Set();
        if (canCure === false) return null;
        // forewarn: reveal opponent's item
        if (this.data.on.start.revealItem)
        {
            // TODO(doubles): track actual opponents
            const team = mon.team;
            if (!team) return null;
            const state = team.state;
            if (!state) return null;
            const side = team.side;
            const oppSide = side === "p1" ? "p2" : "p1";
            const opp = state.getTeam(oppSide).active;
            // TODO: other restrictions?
            return new Set([hasAnItem(opp)]);
        }
        // TODO: add trace/intimidate restrictions
        return new Set();
    }

    /**
     * Activates an ability on-`start`.
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     */
    public async onStart(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        if (!this.data.on?.start) return;
        // cure status immunity
        if (this.data.on.start.cure)
        {
            return await this.cureImmunity(ctx, accept, side);
        }
        // NOTE(gen4): trace is handled using other special logic found in
        //  #copyFoeAbility() and gen4/parser/ability.ts' onStart() function
        //  where this is called
        if (this.data.on.start?.copyFoeAbility) return;
        // frisk
        if (this.data.on.start.revealItem)
        {
            return await this.revealItem(ctx, accept, side);
        }
        // forewarn
        if (this.data.on.start.warnStrongestMove)
        {
            return await this.warnStrongestMove(ctx, accept, side);
        }
        // if nothing is set, then the ability just reveals itself
        return await this.revealAbility(ctx, accept, side);
    }

    /**
     * Parses indicator event due to a copeFoeAbility ability (e.g. Trace).
     * @param side Ability holder reference.
     * @returns The name of the traced ability and the trace target, or
     * undefined if not found.
     */
    public async copyFoeAbility(ctx: BattleParserContext<"gen4">, side: SideID):
        Promise<{ability: string, side: SideID} | undefined>
    {
        // NOTE(gen4): traced ability activates before trace is acknowledged
        // to handle possible ambiguity, we have some special logic in
        //  gen4/parser/ability.ts' onStart() function where this is called
        const event = await tryVerify(ctx, "|-ability|");
        if (!event) return;
        const [, identStr, abilityName] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        if (ident.player !== side) return;
        if (!this.isEventFromAbility(event)) return;
        if (!event.kwArgs.of) return;
        const identOf = Protocol.parsePokemonIdent(event.kwArgs.of);
        const abilityId = toIdName(abilityName);
        await consume(ctx);
        return {ability: abilityId, side: identOf.player};
    }

    // onStart() helpers

    /**
     * Handles events due to a revealItem ability (e.g. Frisk).
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     */
    private async revealItem(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        // TODO(doubles): same event format for each opponent
        const event = await tryVerify(ctx, "|-item|");
        if (!event) return;
        const [, targetIdentStr, itemName] = event.args;
        const targetIdent = Protocol.parsePokemonIdent(targetIdentStr);
        const itemId = toIdName(itemName);
        if (!this.isEventFromAbility(event)) return;
        if (!event.kwArgs.of) return;
        const holderIdent = Protocol.parsePokemonIdent(event.kwArgs.of);
        if (holderIdent.player !== side) return;
        if (!event.kwArgs.identify) return;
        accept();
        ctx.state.getTeam(targetIdent.player).active.setItem(itemId);
        await consume(ctx);
    }

    /**
     * Handles events due to a warnStrongestMove ability (e.g. Forewarn).
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     */
    private async warnStrongestMove(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        const event = await tryVerify(ctx, "|-activate|");
        if (!event) return;
        const [, identStr, effectStr, warnMoveName] = event.args;
        if (!identStr) return;
        const ident = Protocol.parsePokemonIdent(identStr);
        if (ident.player !== side) return;
        const effect = Protocol.parseEffect(effectStr, toIdName);
        if (effect.type !== "ability") return;
        if (effect.name !== this.data.name) return;
        if (!warnMoveName) return;
        const warnMoveId = toIdName(warnMoveName);
        accept();

        // reveal move for opponent
        const targetSide = side === "p1" ? "p2" : "p1";
        const opp = ctx.state.getTeam(targetSide).active;
        opp.moveset.reveal(warnMoveId);

        // rule out moves stronger than the revealed one
        const bp = Ability.getForewarnPower(warnMoveId);
        const strongerMoves = [...opp.moveset.constraint]
            .filter(m => Ability.getForewarnPower(m) > bp);
        opp.moveset.inferDoesntHave(strongerMoves);

        await consume(ctx);
    }

    /**
     * Looks up the base power of a move based on how the Forewarn ability
     * evaluates it.
     */
    private static getForewarnPower(move: string): number
    {
        const data = getMove(move)?.data;
        if (!data) return 0;
        // ohko moves
        if (data.damage === "ohko") return 160;
        // counter moves
        if (data.damage === "counter" || data.damage === "metalburst")
        {
            return 120;
        }
        // fixed damage/variable power moves (hiddenpower, lowkick, etc)
        if (!data.basePower && data.category !== "status") return 80;
        // regular base power, eruption/waterspout and status moves
        return data.basePower;
    }

    /**
     * Handles events due to an ability that just announces itself (e.g.
     * Pressure).
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     */
    private async revealAbility(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        // TODO(doubles): same event format for each opponent
        const event = await tryVerify(ctx, "|-ability|");
        if (!event) return;
        const [, identStr, abilityName] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        if (ident.player !== side) return;
        const abilityId = toIdName(abilityName);
        if (abilityId !== this.data.name) return;
        accept();
        await base["|-ability|"](ctx);
    }

    //#endregion

    //#region on-block

    /**
     * Checks whether the ability can activate on-`block` vs a status effect.
     * @param statuses Possible statuses to afflict.
     * @param weather Current weather.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canBlockStatusEffect(statuses: readonly StatusType[],
        weather: WeatherType | "none"): Set<inference.SubReason> | null
    {
        return statuses.some(
                s => this.canBlockStatus(s, weather, /*allowSilent*/ false)) ?
            new Set() : null;
    }

    /**
     * Checks whether the ability can block the given status.
     * @param status Status to check.
     * @param weather Current weather.
     * @param allowSilent Whether to allow silent activation. Default true.
     */
    public canBlockStatus(status: StatusType,
        weather: WeatherType | "none", allowSilent = true): boolean
    {
        const condition = this.data.on?.block?.status;
        return (condition === true || condition === weather) &&
            !!this.data.statusImmunity &&
            (allowSilent ?
                !!this.data.statusImmunity[status]
                : this.data.statusImmunity[status] === true);
    }

    /**
     * Checks whether the ability can activate on-`block` vs a move's type.
     * @param types Possible move types.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canBlockMoveType(types: ReadonlySet<Type>, move: Move,
        user: Pokemon): Set<inference.SubReason> | null
    {
        // TODO: type effectiveness assertions/SubReasons
        if (this.data.on?.block?.move?.type === "nonSuper")
        {
            return new Set([chance]);
        }
        // side/field status moves don't count
        // TODO: what about moves with additional effects that target the
        //  holder?
        if (move.data.category === "status" &&
            (move.data.effects?.team || move.data.effects?.field))
        {
            return null;
        }
        // can't activate unless the ability could block one of the move's
        //  possible types
        const typeImmunity = this.getTypeImmunity();
        if (!typeImmunity || !types.has(typeImmunity)) return null;
        return new Set([moveIsType(move, user, new Set([typeImmunity]))]);
    }

    /**
     * Checks whether the ability can activate on-`block` vs some effect.
     * @param explosive Explosive flag for damp check.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canBlockEffect(explosive?: boolean): Set<inference.SubReason> | null
    {
        return explosive && this.data.on?.block?.effect?.explosive ?
            new Set() : null;
    }

    /**
     * Activates an ability on-`block`.
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     * @param hitBy Move+user ref that the holder was hit by, if applicable.
     */
    public async onBlock(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID, hitBy?: MoveAndUserRef):
        Promise<AbilityBlockResult>
    {
        // TODO: assert non-ignoreTargetAbility (moldbreaker) after handling
        if (!this.data.on?.block) return {};
        // block status
        if (this.data.on.block.status)
        {
            return await this.blockStatus(ctx, accept, side);
        }
        // block move type
        if (this.data.on.block.move)
        {
            if (!hitBy) return {};
            return await this.blockMove(ctx, accept, side, hitBy);
        }
        // block effect
        if (this.data.on.block.effect)
        {
            if (!hitBy) return {};
            return await this.blockEffect(ctx, accept, side, hitBy);
        }
        return {};
    }

    // onBlock() helpers

    /**
     * Handles events due to a status-blocking ability (e.g. Immunity).
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     */
    private async blockStatus(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID):
        Promise<AbilityBlockResult>
    {
        const blockData = this.data.on?.block?.status;
        // istanbul ignore next: should never happen
        if (!blockData) return {};
        if (blockData !== true)
        {
            // specify required weather in order to block (e.g. leafguard)
            if (ctx.state.status.weather.type !== blockData) return {};
        }

        const statuses = this.data.statusImmunity;
        if (!statuses) return {};

        const event = await tryVerify(ctx, "|-immune|");
        if (!event) return {};
        const [, identStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        if (ident.player !== side) return {};
        if (!this.isEventFromAbility(event)) return {};
        accept();
        await dispatch(ctx);
        // silent blocked statuses are handled by a different parser
        return {
            blockStatus: Object.fromEntries(Object.entries(statuses)
                // note: Ability parsers only care about events, so ignore
                //  silent blocked statuses since they're already implied
                .filter(([, v]) => v === true))
        };
    }

    /**
     * Handles events due to an ability immunity to a move (e.g. Water Absorb).
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     * @param hitBy Move+user ref that the holder was hit by.
     */
    private async blockMove(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID, hitBy: MoveAndUserRef):
        Promise<AbilityBlockResult>
    {
        const blockData = this.data.on?.block?.move;
        // istanbul ignore next: should never happen
        if (!blockData) return {};

        // TODO: implement type effectiveness assertion for "nonSuper"
        if (blockData.type !== "nonSuper")
        {
            const hitByUser = ctx.state.getTeam(hitBy.userRef).active;
            hitBy.move.assertType(blockData.type, hitByUser);
        }

        // if no effects are being applied by the ability, just an |-immune|
        //  event will be shown
        const event = await tryVerify(ctx, "|-immune|");
        if (event)
        {
            const [, identStr] = event.args;
            const ident = Protocol.parsePokemonIdent(identStr);
            if (ident.player !== side) return {};
            if (!this.isEventFromAbility(event)) return {};
            accept();
            await base["|-immune|"](ctx);
            return {immune: true};
        }

        // self-boost effect
        if (blockData.boost)
        {
            return await this.blockMoveBoost(ctx, accept, side,
                blockData.boost);
        }
        // self-damage/heal effect
        if (blockData.percentDamage)
        {
            return await this.blockMoveHeal(ctx, accept, side,
                blockData.percentDamage, hitBy.userRef);
        }
        // self-status effect
        if (blockData.status)
        {
            return await this.blockMoveStatus(ctx, accept, side,
                blockData.status);
        }
        return {};
    }

    /**
     * Handles events due to an ability immunity causing a stat boost effect
     * (e.g. Motor Drive).
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     * @param boosts Boosts to try to apply.
     */
    private async blockMoveBoost(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID,
        boosts: Partial<BoostTable<number>>): Promise<AbilityBlockResult>
    {
        // parse initial event indicating boost effect
        const event = await tryVerify(ctx, "|-ability|", "|-immune|");
        if (!event) return {};

        // if no boosts are being applied, just an |-immune| event will be shown
        if (event.args[0] === "-immune")
        {
            const [, ident2Str] = event.args;
            const ident2 = Protocol.parsePokemonIdent(ident2Str);
            if (ident2.player !== side) return {};
            if (!this.isEventFromAbility(event)) return {};
            accept();
            await base["|-immune|"](ctx);
            return {immune: true};
        }

        // otherwise, parse this initial event then the boost events
        const [, identStr, abilityName, s] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        if (ident.player !== side) return {};
        const abilityId = toIdName(abilityName);
        if (this.data.name !== abilityId) return {};
        if (s !== "boost") return {};
        accept();
        await base["|-ability|"](ctx);

        // parse boost events
        const remaining = await boost(ctx, {side, table: boosts, silent: true});
        if (Object.keys(remaining).length > 0)
        {
            throw new Error("On-block move boost effect failed: " +
                "Failed to parse boosts " +
                `[${Object.keys(remaining).join(", ")}]`);
        }
        return {immune: true};
    }

    /**
     * Handles events due to an ability immunity causing a healing effect
     * (e.g. Water Absorb).
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     * @param percent Percent damage to apply.
     * @param hitByUseRef User ref of the move the holder is being hit by.
     */
    private async blockMoveHeal(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID,
        percent: number, hitByUseRef: SideID): Promise<AbilityBlockResult>
    {
        const mon = ctx.state.getTeam(side).active;
        // effect would do nothing
        if (isPercentDamageSilent(percent, mon.hp.current, mon.hp.max))
        {
            return {};
        }

        // parse initial event indicating heal effect
        const event = await tryVerify(ctx, "|-heal|");
        if (!event) return {};
        if (!verifyPercentDamage(ctx, event, side, percent)) return {};
        if (!this.isEventFromAbility(event)) return {};
        if (!event.kwArgs.of) return {};
        const identOf = Protocol.parsePokemonIdent(event.kwArgs.of);
        if (identOf.player !== hitByUseRef) return {};
        accept();
        await base["|-heal|"](ctx);
        return {immune: true};
    }

    /**
     * Handles events due to an ability immunity causing a self-status effect
     * (e.g. Flash Fire).
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     * @param statusType Status effect to apply.
     */
    private async blockMoveStatus(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID, statusType: StatusType):
        Promise<AbilityBlockResult>
    {
        const mon = ctx.state.getTeam(side).active;
        if (isStatusSilent(mon, [statusType])) return {};

        const event = await tryVerify(ctx, "|-start|");
        if (!event) return {};
        if (!verifyStatus(event, side, [statusType])) return {};
        if (!this.isEventFromAbility(event)) return {};
        accept();
        await base["|-start|"](ctx);
        return {immune: true};
    }

    /**
     * Handles events due to a certain effect type being blocked (e.g. Damp vs
     * Explosion)
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     * @param hitBy Move+user ref that the holder was hit by.
     */
    private async blockEffect(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID, hitBy: MoveAndUserRef):
        Promise<AbilityBlockResult>
    {
        // verify explosive flag
        const explosive = this.data.on?.block?.effect?.explosive;
        if (explosive && !hitBy.move.data.flags?.explosive) return {};

        // note: |move| event was shown prior

        const event = await tryVerify(ctx, "|cant|");
        if (!event) return {};
        const [, identStr, reasonStr, effectStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        if (ident.player !== hitBy.userRef) return {};
        const reason = Protocol.parseEffect(reasonStr, toIdName);
        if (reason.name !== this.data.name) return {};
        const effect = Protocol.parseEffect(effectStr, toIdName);
        if (effect.name !== hitBy.move.data.name) return {};
        if (!event.kwArgs.of) return {};
        const identOf = Protocol.parsePokemonIdent(event.kwArgs.of);
        if (identOf.player !== side) return {};
        accept();
        await base["|cant|"](ctx);
        return {failed: true};
    }

    //#endregion

    //#region on-tryUnboost

    /**
     * Checks whether the ability can activate on-`tryUnboost` to block an
     * unboost effect.
     * @param boosts Boosts that could be blocked.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canBlockUnboost(boosts: Partial<BoostTable<number>>):
        Set<inference.SubReason> | null
    {
        if (!this.data.on?.tryUnboost?.block) return null;
        const blockUnboost = this.data.on.tryUnboost.block;
        return (Object.keys(boosts) as BoostID[]).some(
                b => boosts[b]! < 0 && blockUnboost[b]) ?
            new Set() : null;
    }

    /**
     * Activates an ability on-`tryUnboost`.
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     * @returns The boosts that were blocked.
     */
    public async onTryUnboost(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID):
        Promise<Partial<BoostTable<true>>>
    {
        // TODO: assert non-ignoreTargetAbility (moldbreaker) after handling if
        //  this is due to a move effect
        if (this.data.on?.tryUnboost)
        {
            if (this.data.on.tryUnboost.block)
            {
                return await this.blockUnboost(ctx, accept, side);
            }
        }
        return {};
    }

    /**
     * Handles events due to an unboost-blocking ability (e.g. Clear Body).
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     * @returns The boosts that were blocked.
     */
    private async blockUnboost(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID):
        Promise<Partial<BoostTable<true>>>
    {
        const boosts = this.data.on?.tryUnboost?.block;
        // istanbul ignore next: no-op, should never happen
        if (!boosts) return {};

        const event = await tryVerify(ctx, "|-fail|");
        if (!event) return {};
        const [, identStr, blocked] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        if (ident.player !== side) return {};
        if (blocked !== "unboost") return {};
        if (!this.isEventFromAbility(event)) return {};
        if (!event.kwArgs.of) return {};
        const identOf = Protocol.parsePokemonIdent(event.kwArgs.of);
        if (identOf.player !== side) return {};
        accept();
        await base["|-fail|"](ctx);
        return boosts;
    }

    //#endregion

    //#region on-status

    /**
     * Checks whether the ability can activate on-`status` to cure it.
     * @param mon Potential ability holder.
     * @param statusType Afflicted status.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canStatus(mon: ReadonlyPokemon, statusType: StatusType):
        Set<inference.SubReason> | null
    {
        return this.canCureImmunity("status", mon, [statusType]) ?
            new Set() : null;
    }

    /**
     * Activates an ability on-`status`.
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     */
    public async onStatus(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        if (this.data.on?.status)
        {
            // cure status immunity
            if (this.data.on.status.cure)
            {
                return await this.cureImmunity(ctx, accept, side);
            }
        }
    }

    //#endregion

    //#region on-moveContactKO/moveContact/moveDamage

    /**
     * Checks whether the ability can activate
     * on-`moveDamage`/`moveContact`/`moveContactKO`.
     * @param mon Potential ability holder.
     * @param on Specific on-`X` condition.
     * @param hitBy Move+user that the holder was hit by.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canMoveDamage(mon: Pokemon, on: AbilityOn, hitBy: MoveAndUser):
        Set<inference.SubReason> | null
    {
        if (!this.data.on) return null;
        if (this.data.on.moveDamage &&
            // can't include moveContactKO since the only relevant effect
            //  affects the ability holder
            ["moveDamage", "moveContact"].includes(on))
        {
            if (this.data.on.moveDamage.changeToMoveType && !mon.fainted)
            {
                return new Set([diffMoveType(mon, hitBy)]);
            }
        }
        if (this.data.on.moveContact &&
            ["moveContact", "moveContactKO"].includes(on))
        {
            // TODO: silent status-immunity check?
            const chanceNum = this.data.on.moveContact.chance ?? 100;
            return new Set(chanceNum === 100 ? [] : [chance]);
        }
        if (this.data.on.moveContactKO && on === "moveContactKO")
        {
            // TODO: silent damp check?
            return new Set();
        }
        return null;
    }

    /**
     * Activates an ability on-`moveContactKO`/`moveContact`/`moveDamage`.
     * @param accept Callback to accept this pathway.
     * @param on Which on-`X` we're talking about.
     * @param side Ability holder reference.
     * @param hitBy Move+user ref that the holder was hit by.
     */
    public async onMoveDamage(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, on: AbilityOn, side: SideID,
        hitBy: MoveAndUserRef): Promise<void>
    {
        switch (on)
        {
            case "moveContactKO":
                if (this.data.on?.moveContactKO)
                {
                    return await this.moveContactKO(ctx, accept, side,
                        hitBy.userRef);
                }
                // fallthrough: contactKO also applies to contact in general
            case "moveContact":
                if (this.data.on?.moveContact)
                {
                    return await this.moveContact(ctx, accept, side,
                        hitBy.userRef);
                }
                // fallthrough: contact also applies to damage in general
            case "moveDamage":
                if (this.data.on?.moveDamage)
                {
                    // colorchange
                    if (this.data.on.moveDamage.changeToMoveType &&
                        // affects holder so can't activate if ko'd
                        on !== "moveContactKO")
                    {
                        return await this.changeToMoveType(ctx, accept, side,
                            hitBy);
                    }
                }
                break;
            default:
                // istanbul ignore next: should never happen
                throw new Error(`Invalid on-moveDamage-like type '${on}'`);
        }
    }

    /**
     * Handles events due to a moveContactKO ability (e.g. Aftermath).
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     * @param hitByUserRef Pokemon reference to the user of the move by which
     * the ability holder was hit.
     */
    private async moveContactKO(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID, hitByUserRef: SideID):
        Promise<void>
    {
        const effectData = this.data.on?.moveContactKO;
        // istanbul ignore next: should never happen
        if (!effectData) return;

        if (effectData.percentDamage)
        {
            const mon = ctx.state.getTeam(hitByUserRef).active;
            if (isPercentDamageSilent(effectData.percentDamage, mon.hp.current,
                mon.hp.max))
            {
                return;
            }
            const event = await tryVerify(ctx, "|-damage|");
            if (!event) return;
            if (!verifyPercentDamage(ctx, event, hitByUserRef,
                effectData.percentDamage))
            {
                return;
            }
            if (!this.isEventFromAbility(event)) return;
            if (!event.kwArgs.of) return;
            const identOf = Protocol.parsePokemonIdent(event.kwArgs.of);
            if (identOf.player !== side) return;
            accept();
            await base["|-damage|"](ctx);

            // also check for item updates since we caused damage
            await updateItems(ctx);
            return;
        }

        if (effectData.explosive)
        {
            // assert non-explosive-blocking ability (damp)
            // TODO(doubles): assert for all active mons
            const hitByUser = ctx.state.getTeam(hitByUserRef).active;
            if (!hitByUser.volatile.suppressAbility)
            {
                hitByUser.traits.ability.remove(
                    (_, a) => !!a.on?.block?.effect?.explosive);
            }
        }
    }

    /**
     * Handles events due to a moveContact ability (e.g. Rough Skin).
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     * @param hitByUserRef Pokemon reference to the user of the move by which
     * the ability holder was hit.
     */
    private async moveContact(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID, hitByUserRef: SideID):
        Promise<void>
    {
        const effectData = this.data.on?.moveContact;
        // istanbul ignore next: should never happen
        if (!effectData) return;

        const mon = ctx.state.getTeam(hitByUserRef).active;
        if (effectData.percentDamage)
        {
            if (isPercentDamageSilent(effectData.percentDamage, mon.hp.current,
                mon.hp.max))
            {
                return;
            }
            const event = await tryVerify(ctx, "|-damage|");
            if (!event) return;
            if (!verifyPercentDamage(ctx, event, hitByUserRef,
                effectData.percentDamage))
            {
                return;
            }
            if (!this.isEventFromAbility(event)) return;
            if (!event.kwArgs.of) return;
            const identOf = Protocol.parsePokemonIdent(event.kwArgs.of);
            if (identOf.player !== side) return;
            accept();
            await base["|-damage|"](ctx);
        }
        else if (effectData.status)
        {
            if (isStatusSilent(mon, effectData.status)) return;
            const event = await tryVerify(ctx, "|-start|", "|-status|",
                "|-message|");
            if (!event) return;
            if (!verifyStatus(event, hitByUserRef, effectData.status)) return;
            if (event.args[0] !== "-message")
            {
                const ev = event as Event<"|-start|" | "|-status|">;
                if (!this.isEventFromAbility(ev)) return;
                if (!ev.kwArgs.of) return;
                const identOf = Protocol.parsePokemonIdent(ev.kwArgs.of);
                if (identOf.player !== side) return;
            }
            accept();
            await dispatch(ctx);
        }

        // also check for item updates since we caused damage or afflicted a
        //  status
        await updateItems(ctx);
    }

    /**
     * Handles events due to a changeMoveType ability (e.g. Color Change).
     * Always targets ability holder.
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     * @param hitBy Move+user ref that the holder was hit by.
     */
    private async changeToMoveType(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID, hitBy: MoveAndUserRef):
        Promise<void>
    {
        const event = await tryVerify(ctx, "|-start|");
        if (!event) return;
        const [, identStr, effectStr, type] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        if (ident.player !== side) return;
        if (effectStr !== "typechange") return;
        accept();
        const hitByUser = ctx.state.getTeam(hitBy.userRef).active;
        hitBy.move.assertType(type as Type, hitByUser);
        await base["|-start|"](ctx);
    }

    //#endregion

    //#region on-moveDrain parser

    /**
     * Activates an ability on-`moveDrain`.
     * @param hitByUserRef Pokemon reference to the user of the draining move.
     * Throws an error if not specified
     */
    public async onMoveDrain(ctx: BattleParserContext<"gen4">, side: SideID,
        hitByUserRef?: SideID): Promise<AbilityResult>
    {
        if (this.data.on?.moveDrain)
        {
            // invert drain effect to damage instead of heal
            if (this.data.on.moveDrain.invert)
            {
                if (!hitByUserRef)
                {
                    throw new Error("On-moveDrain invert effect failed: " +
                        "Attacking move user not specified.");
                }
                return await this.invertDrain(ctx, side, hitByUserRef);
            }
        }
        throw new Error("On-moveDrain effect shouldn't activate for ability " +
            `'${this.data.name}'`);
    }

    /**
     * Handles events due to an invertDrain ability (e.g. Liquid Ooze). Always
     * targets the drain move's user.
     * @param side Ability holder reference.
     * @param hitByUserRef Pokemon reference to the user of the draining move.
     */
    private async invertDrain(ctx: BattleParserContext<"gen4">, side: SideID,
        hitByUserRef: SideID): Promise<AbilityResult>
    {
        await this.verifyInitialEvent(ctx, side);
        // expect the takeDamage event
        const damageResult = await parsers.damage(ctx, hitByUserRef,
            /*from*/ null, -1);
        if (!damageResult.success)
        {
            throw new Error("On-moveDrain invert effect failed");
        }
        await parsers.update(ctx);

        // TODO: include damage delta
        return {invertDrain: true};
    }

    //#endregion

    //#region general helper methods

    /**
     * Verifies that the event's `[from]` effect suffix matches this Ability.
     */
    private isEventFromAbility(event: Event<Protocol.BattleArgsWithKWArgName>):
        boolean
    {
        const from = Protocol.parseEffect((event.kwArgs as any).from, toIdName);
        return this.isEffectFromAbility(from);
    }

    /** Verifies that a parsed effect string matches this Ability. */
    private isEffectFromAbility(
        effect: ReturnType<typeof Protocol["parseEffect"]>): boolean
    {
        return (!effect.type || effect.type === "ability") &&
            effect.name === this.data.name;
    }

    /**
     * Checks if the ability can cure a status based on immunity.
     * @param on Circumstance in which the ability would activate.
     * @param mon Potential ability holder.
     * @param statusTypes Statuses to consider. Omit to assume all relevant
     * status immunities.
     * @returns True if the ability can activate under the given circumstances,
     * false if no immunities are violated, or null if the ability doesn't
     * apply here (i.e., it's not immune to any status under the given
     * circumstances).
     */
    private canCureImmunity(on: AbilityOn, mon: ReadonlyPokemon,
        statusTypes?: readonly StatusType[]): boolean | null
    {
        if (!this.data.statusImmunity) return null;
        switch (on)
        {
            case "start": case "status":
                if (!this.data.on?.[on]?.cure) return null;
                break;
            default:
                return null;
        }
        if (!statusTypes)
        {
            statusTypes = Object.keys(this.data.statusImmunity) as StatusType[];
        }
        return statusTypes.some(s => this.data.statusImmunity![s] &&
            hasStatus(mon, s));
    }

    /**
     * Handles events due to a statusImmunity ability curing a status (e.g.
     * Insomnia).
     * @param accept Callback to accept this pathway.
     * @param side Ability holder reference.
     */
    private async cureImmunity(ctx: BattleParserContext<"gen4">,
        accept: unordered.AcceptCallback, side: SideID): Promise<void>
    {
        const immunities = this.data.statusImmunity;
        if (!immunities) return;

        // verify initial event
        const initial = await tryVerify(ctx, "|-activate|");
        if (!initial) return;
        const [, initialIdentStr, initialEffectStr] = initial.args;
        if (!initialIdentStr) return;
        const initialIdent = Protocol.parsePokemonIdent(initialIdentStr);
        if (initialIdent.player !== side) return;
        const initialEffect = Protocol.parseEffect(initialEffectStr);
        if (initialEffect.type !== "ability") return;
        if (initialEffect.name !== this.data.name) return;
        accept();
        await base["|-activate|"](ctx);

        // parse cure events
        await eventLoop(ctx, async function cureImmunityLoop(_ctx)
        {
            const event = await tryPeek(_ctx);
            if (!event) return;
            switch (event.args[0])
            {
                case "-end":
                {
                    const [, identStr, effectStr] = event.args;
                    const ident = Protocol.parsePokemonIdent(identStr);
                    if (ident.player !== side) break;
                    const effect = Protocol.parseEffect(effectStr, toIdName);
                    if (immunities[effect.name as StatusType] !== true) break;
                    await base["|-end|"](_ctx);
                    break;
                }
                case "-curestatus":
                {
                    const [, identStr, majorStatusType] = event.args;
                    const ident = Protocol.parsePokemonIdent(identStr);
                    if (ident.player !== side) break;
                    if (immunities[majorStatusType] !== true) break;
                    await base["|-curestatus|"](_ctx);
                    break;
                }
            }
        });
    }

    // TODO: generalize for multiple immunities, e.g. wonderguard
    /** Gets the ability's move type immunity, or null if none found. */
    public getTypeImmunity(): Type | null
    {
        const type = this.data.on?.block?.move?.type;
        if (!type || type === "nonSuper") return null;
        return type;
    }

    //#endregion

    //#endregion

    //#region canX() SubReason builders for onX() activateAbility parsers

    //#region on-moveDrain reason

    /**
     * Checks whether the ability can activate on-`moveDrain`.
     * @returns A Set of SubReasons describing additional conditions of
     * activation, or the empty set if there are none, or null if it cannot
     * activate.
     */
    public canMoveDrain(): Set<SubReason> | null
    {
        return this.data.on?.moveDrain ? new Set() : null;
    }

    //#endregion

    //#endregion
}
