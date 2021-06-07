import * as dexutil from "../dex/dex-util";
import { Pokemon } from "../state/Pokemon";
import { otherSide, Side } from "../state/Side";
import { consume, createDispatcher } from "../../../../../../battle/parser/helpers";
import { activateAbility } from "./activateAbility";
import { activateItem } from "./activateItem";
import { halt } from "./halt";
import { removeItem } from "./removeItem";
import { switchIn } from "./switchIn";
import { useMove } from "./useMove";
import { Event } from "../../../../../parser";
import { BattleState } from "../state";
import { Parser, ParserContext } from "../../FormatType";
import { BattleParserResult } from "../../../../../../battle/parser";
import { Protocol } from "@pkmn/protocol";
import { verifyNext } from "../../../helpers";

/** Base handlers for each event. */
export const handlers =
{
    async activateAbility(...[ctx, ...args]:
            Parameters<typeof activateAbility>):
        ReturnType<typeof activateAbility>
    {
        const event = await verifyNext(ctx, "activateAbility");
        return await activateAbility(
        {
            ...ctx,
            // TODO: should these functions add their own prefixes instead?
            logger: ctx.logger.addPrefix(`Ability(${event.monRef}, ` +
                `${event.ability}): `)
        },
            ...args);
    },
    async activateFieldEffect(ctx: ParserContext<"gen4">,
        weatherSource: Pokemon | null = null, weatherInfinite?: boolean):
        Promise<void>
    {
        const event = await verifyNext(ctx, "activateFieldEffect");
        if (dexutil.isWeatherType(event.effect))
        {
            ctx.state.status.weather.start(weatherSource, event.effect,
                weatherInfinite);
        }
        else ctx.state.status[event.effect][event.start ? "start" : "end"]();
        await consume(ctx);
    },
    async activateItem(...[ctx, on = "turn", ...args]:
            Parameters<typeof activateItem>): ReturnType<typeof activateItem>
    {
        // if done, permHalt or reject
        // if type doesn't match, throw or reject?
        const event = await verifyNext(ctx, "activateItem");
        return await activateItem(
        {
            ...ctx,
            logger: ctx.logger.addPrefix(`Item(${event.monRef}, ` +
                `${event.item}, on-${on}): `)
        },
            on, ...args);
    },
    async activateStatusEffect(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "activateStatusEffect");
        const mon = ctx.state.teams[event.monRef].active;
        // TODO: some way to fully reduce this switch statement to indirection?
        switch (event.effect)
        {
            case "aquaRing": case "attract": case "curse": case "flashFire":
            case "focusEnergy": case "imprison": case "ingrain":
            case "leechSeed": case "mudSport": case "nightmare":
            case "powerTrick": case "substitute": case "suppressAbility":
            case "torment": case "waterSport":
            // singlemove
            case "destinyBond": case "grudge": case "rage":
            // singleturn
            case "focus": case "magicCoat": case "roost": case "snatch":
                // TODO: if substitute, remove partial trapping (implicit?)
                mon.volatile[event.effect] = event.start;
                break;
            case "bide": case "confusion": case "charge": case "magnetRise":
            case "embargo": case "healBlock": case "slowStart": case "taunt":
            case "uproar": case "yawn":
                mon.volatile[event.effect][event.start ? "start" : "end"]();
                break;
            case "encore":
                if (event.start)
                {
                    if (!mon.volatile.lastMove)
                    {
                        throw new Error("Can't Encore if lastMove is null");
                    }
                    mon.volatile.encoreMove(mon.volatile.lastMove);
                }
                else mon.volatile.removeEncore();
                break;
            case "endure": case "protect": // stall
                mon.volatile.stall(event.start);
                break;
            case "foresight": case "miracleEye":
                mon.volatile.identified = event.start ? event.effect : null;
                break;
            default:
                if (dexutil.isMajorStatus(event.effect))
                {
                    // afflict status
                    if (event.start) mon.majorStatus.afflict(event.effect);
                    // cure status (assert mentioned status)
                    else mon.majorStatus.assert(event.effect).cure();
                }
                else
                {
                    throw new Error(
                        `Invalid status effect '${event.effect}' with ` +
                        `start=${event.start}`);
                }
        }
        await consume(ctx);
        // see if the target pokemon can use its ability to cure itself
        // TODO: implement status berries and other on-status effects before
        //  handling onStatus abilities
        /*if (event.start)
        {
            return await ability.onStatus(ctx, {[event.monRef]: true},
                event.effect);
        }*/
    },
    async activateTeamEffect(ctx: ParserContext<"gen4">,
        source: Pokemon | null = null): Promise<void>
    {
        const event = await verifyNext(ctx, "activateTeamEffect");
        const ts = ctx.state.teams[event.teamRef].status;
        switch (event.effect)
        {
            case "healingWish": case "lunarDance":
                ts[event.effect] = event.start;
                break;
            case "lightScreen": case "reflect":
                // start should normally be handled under a MoveContext
                if (event.start) ts[event.effect].start(source);
                else ts[event.effect].reset();
                break;
            case "luckyChant": case "mist": case "safeguard": case "tailwind":
            case "wish":
                if (event.start) ts[event.effect].start();
                else ts[event.effect].end();
                break;
            case "spikes": case "stealthRock": case "toxicSpikes":
                if (event.start) ++ts[event.effect];
                else ts[event.effect] = 0;
                break;
        }
        await consume(ctx);
    },
    async block(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "block");
        if (event.effect === "substitute" &&
            !ctx.state.teams[event.monRef].active.volatile.substitute)
        {
            throw new Error("Substitute blocked an effect but no Substitute " +
                "exists");
        }
        await consume(ctx);
    },
    async boost(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "boost");
        const {boosts} = ctx.state.teams[event.monRef].active.volatile;
        if (event.set) boosts[event.stat] = event.amount;
        else boosts[event.stat] += event.amount;
        await consume(ctx);
    },
    async changeType(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "changeType");
        ctx.state.teams[event.monRef].active.volatile
            .changeTypes(event.newTypes);
        await consume(ctx);
    },
    async clause(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "clause");
        await consume(ctx);
    },
    async clearAllBoosts(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "clearAllBoosts");
        for (const side of Object.keys(ctx.state.teams) as Side[])
        {
            for (const stat of dexutil.boostKeys)
            {
                ctx.state.teams[side].active.volatile.boosts[stat] = 0;
            }
        }
        await consume(ctx);
    },
    async clearNegativeBoosts(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "clearNegativeBoosts");
        const boosts = ctx.state.teams[event.monRef].active.volatile.boosts;
        for (const stat of dexutil.boostKeys)
        {
            if (boosts[stat] < 0) boosts[stat] = 0;
        }
        await consume(ctx);
    },
    async clearPositiveBoosts(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "clearPositiveBoosts");
        const boosts = ctx.state.teams[event.monRef].active.volatile.boosts;
        for (const stat of dexutil.boostKeys)
        {
            if (boosts[stat] > 0) boosts[stat] = 0;
        }
        await consume(ctx);
    },
    async copyBoosts(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "copyBoosts");
        const from = ctx.state.teams[event.from].active.volatile.boosts;
        const to = ctx.state.teams[event.to].active.volatile.boosts;
        for (const stat of dexutil.boostKeys) to[stat] = from[stat];
        await consume(ctx);
    },
    async countStatusEffect(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "countStatusEffect");
        ctx.state.teams[event.monRef].active.volatile[event.effect] =
            event.amount;
        await consume(ctx);
    },
    async crit(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "crit");
        await consume(ctx);
    },
    async cureTeam(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "cureTeam");
        ctx.state.teams[event.teamRef].cure();
        await consume(ctx);
    },
    async disableMove(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "disableMove");
        ctx.state.teams[event.monRef].active.volatile
            .disableMove(event.move);
        await consume(ctx);
    },
    async fail(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "fail");
        await consume(ctx);
    },
    async faint(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "faint");
        ctx.state.teams[event.monRef].active.faint();
        await consume(ctx);
    },
    async fatigue(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "fatigue");
        ctx.state.teams[event.monRef].active.volatile.lockedMove.reset();
        await consume(ctx);
    },
    async feint(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "feint");
        ctx.state.teams[event.monRef].active.volatile.feint();
        await consume(ctx);
    },
    async formChange(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "formChange");
        const mon = ctx.state.teams[event.monRef].active;
        mon.formChange(event.species, event.level, event.perm);

        // set other details just in case
        // TODO: should gender also be in the traits object?
        mon.gender = event.gender;
        mon.hp.set(event.hp, event.hpMax);
        await consume(ctx);
    },
    async futureMove(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "futureMove");
        if (event.start)
        {
            // starting a future move mentions the user
            ctx.state.teams[event.monRef].status
                .futureMoves[event.move].start(/*restart*/false);
        }
        else
        {
            // ending a future move mentions the target before
            //  taking damage
            ctx.state.teams[otherSide(event.monRef)].status
                .futureMoves[event.move].end();
        }
        await consume(ctx);
    },
    async halt(...[ctx, ...args]: Parameters<typeof halt>):
        ReturnType<typeof halt>
    {
        const event = await verifyNext(ctx, "halt");
        return await halt(
        {
            ...ctx,
            logger: ctx.logger.addPrefix(`Halt(${event.reason}): `)
        },
            ...args);
    },
    async hitCount(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "hitCount");
        await consume(ctx);
    },
    async immune(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "immune");
        await consume(ctx);
    },
    async inactive(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "inactive");
        const mon = ctx.state.teams[event.monRef].active;
        if (event.move) mon.moveset.reveal(event.move);

        switch (event.reason)
        {
            case "imprison":
                // opponent's imprison caused the pokemon to be prevented from
                //  moving, so the revealed move can be revealed for both sides
                if (!event.move) break;
                ctx.state.teams[otherSide(event.monRef)].active.moveset
                    .reveal(event.move);
                break;
            case "truant":
                mon.volatile.activateTruant();
                // fallthrough: truant and recharge turns overlap
            case "recharge":
                mon.volatile.mustRecharge = false;
                break;
            case "slp":
                mon.majorStatus.assert("slp").tick(mon.ability);
                break;
        }

        // consumed an action this turn
        mon.inactive();
        await consume(ctx);
    },
    async initOtherTeamSize(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "initOtherTeamSize");
        ctx.state.teams.them.size = event.size;
        await consume(ctx);
    },
    async initTeam(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "initTeam");
        const team = ctx.state.teams.us;
        team.size = event.team.length;
        for (const data of event.team)
        {
            // initial revealed pokemon can't be null, since we already
            //  set the teamsize
            const mon = team.reveal(data)!;
            mon.baseTraits.stats.hp.set(data.hpMax);
            for (const stat in data.stats)
            {
                // istanbul ignore if
                if (!data.stats.hasOwnProperty(stat)) continue;
                mon.baseTraits.stats[stat as dexutil.StatExceptHP]
                    .set(data.stats[stat as dexutil.StatExceptHP]);
            }
            mon.baseTraits.ability.narrow(data.baseAbility);
            // TODO: handle case where there's no item? change typings or
            //  default to "none"
            mon.setItem(data.item);

            if (data.hpType) mon.hpType.narrow(data.hpType);
            if (data.happiness) mon.happiness = data.happiness;
        }
        await consume(ctx);
    },
    async invertBoosts(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "invertBoosts");
        const boosts = ctx.state.teams[event.monRef].active.volatile.boosts;
        for (const stat of dexutil.boostKeys) boosts[stat] = -boosts[stat];
        await consume(ctx);
    },
    async lockOn(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "lockOn");
        ctx.state.teams[event.monRef].active.volatile.lockOn(
            ctx.state.teams[event.target].active.volatile);
        await consume(ctx);
    },
    async mimic(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "mimic");
        ctx.state.teams[event.monRef].active.mimic(event.move);
        await consume(ctx);
    },
    async miss(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "miss");
        await consume(ctx);
    },
    async modifyPP(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "modifyPP");
        const move = ctx.state.teams[event.monRef].active.moveset.reveal(
            event.move);
        if (event.amount === "deplete") move.pp = 0;
        else move.pp += event.amount;
        await consume(ctx);
    },
    async mustRecharge(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "mustRecharge");
        // TODO: imply this in useMove event
        ctx.state.teams[event.monRef].active.volatile.mustRecharge = true;
        await consume(ctx);
    },
    async noTarget(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "noTarget");
        await consume(ctx);
    },
    async postTurn(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "postTurn");
        ctx.state.postTurn();
        await consume(ctx);
    },
    async prepareMove(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "prepareMove");
        ctx.state.teams[event.monRef].active.volatile.twoTurn
            .start(event.move);
        await consume(ctx);
    },
    async preTurn(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "preTurn");
        ctx.state.preTurn();
        await consume(ctx);
    },
    async reenableMoves(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "reenableMoves");
        ctx.state.teams[event.monRef].active.volatile.enableMoves();
        await consume(ctx);
    },
    async removeItem(...[ctx, on = null, ...args]:
        Parameters<typeof removeItem>): ReturnType<typeof removeItem>
    {
        const event = await verifyNext(ctx, "removeItem");
        return await removeItem(
        {
            ...ctx,
            logger: ctx.logger.addPrefix(`RemoveItem(${event.monRef}, ` +
                `consumed=${event.consumed}, on-${on}): `)
        },
            on, ...args);
    },
    async resetWeather(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "resetWeather");
        ctx.state.status.weather.reset();
        await consume(ctx);
    },
    async resisted(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "resisted");
        await consume(ctx);
    },
    async restoreMoves(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "restoreMoves");
        const moveset = ctx.state.teams[event.monRef].active.moveset;
        for (const move of moveset.moves.values()) move.pp = move.maxpp;
        await consume(ctx);
    },
    async revealItem(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "revealItem");
        ctx.state.teams[event.monRef].active
            .setItem(event.item, event.gained);
        await consume(ctx);
    },
    async revealMove(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "revealMove");
        ctx.state.teams[event.monRef].active.moveset.reveal(event.move);
        await consume(ctx);
    },
    async setThirdType(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "setThirdType");
        ctx.state.teams[event.monRef].active.volatile.addedType =
            event.thirdType;
        await consume(ctx);
    },
    async sketch(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "sketch");
        ctx.state.teams[event.monRef].active.sketch(event.move);
        await consume(ctx);
    },
    async superEffective(ctx: ParserContext<"gen4">): Promise<void>
    {
        await verifyNext(ctx, "superEffective");
        await consume(ctx);
    },
    async swapBoosts(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "swapBoosts");
        const v1 = ctx.state.teams[event.monRef1].active.volatile.boosts;
        const v2 = ctx.state.teams[event.monRef2].active.volatile.boosts;
        for (const stat of event.stats)
        {
            [v1[stat], v2[stat]] = [v2[stat], v1[stat]];
        }
        await consume(ctx);
    },
    async switchIn(...[ctx, ...args]: Parameters<typeof switchIn>):
        ReturnType<typeof switchIn>
    {
        const event = await verifyNext(ctx, "switchIn");
        return await switchIn(
        {
            ...ctx,
            // TODO: add log prefix indicator for drag/self-switch?
            logger: ctx.logger.addPrefix(`Switch(${event.monRef}): `)
        },
            ...args);
    },
    async takeDamage(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "takeDamage");
        const mon = ctx.state.teams[event.monRef].active;
        mon.hp.set(event.hp);
        await consume(ctx);
    },
    async transform(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "transform");
        ctx.state.teams[event.source].active.transform(
            ctx.state.teams[event.target].active);
        await consume(ctx);
    },
    async trap(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "trap");
        ctx.state.teams[event.by].active.volatile.trap(
            ctx.state.teams[event.target].active.volatile);
        await consume(ctx);
    },
    async updateFieldEffect(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "updateFieldEffect");
        // currently only applies to weather
        const weather = ctx.state.status.weather;
        if (weather.type !== event.effect)
        {
            throw new Error(`Weather is '${weather.type}' but ticked ` +
                `weather is '${event.effect}'`);
        }
        weather.tick();
        await consume(ctx);
    },
    async updateMoves(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "updateMoves");
        const mon = ctx.state.teams[event.monRef].active;

        // infer moveset
        for (const data of event.moves)
        {
            const move = mon.moveset.reveal(data.id, data.maxpp);
            if (data.pp != null) move.pp = data.pp;
        }
        await consume(ctx);
    },
    async updateStatusEffect(ctx: ParserContext<"gen4">): Promise<void>
    {
        const event = await verifyNext(ctx, "updateStatusEffect");
        ctx.state.teams[event.monRef].active.volatile[event.effect].tick();
        // TODO: if confusion, be sure to handle inactivity properly if damaged,
        //  as well as handle focussash interactions with that
        await consume(ctx);
    },
    async useMove(...[ctx, called = false, ...args]:
            Parameters<typeof useMove>): ReturnType<typeof useMove>
    {
        const event = await verifyNext(ctx, "useMove");
        let calledStr = "";
        if (called === "bounced") calledStr = ", bounced";
        else if (called) calledStr = ", called";

        return await useMove(
        {
            ...ctx,
            logger: ctx.logger.addPrefix(`Move(${event.monRef}, ` +
                `${event.move}${calledStr}): `)
        },
            called, ...args);
    }
} as const;

const handlers2 =
{
    async '|-boost|'(ctx: ParserContext<"gen4">): Promise<void>
    {
    }
} as const;

/** Dispatches event handler. */
export const dispatch =
    createDispatcher(handlers2, event => Protocol.key(event.args));
