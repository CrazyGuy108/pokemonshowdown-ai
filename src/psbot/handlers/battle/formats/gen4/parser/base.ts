import * as dexutil from "../dex/dex-util";
import { Pokemon } from "../state/Pokemon";
import { otherSide, Side } from "../state/Side";
import { SubParserConfig, SubParserResult } from "../../../../../../battle/parser/BattleParser";
import { consume, createDispatcher, verify } from "../../../../../../battle/parser/helpers";
import { activateAbility } from "./activateAbility";
import { activateItem } from "./activateItem";
import { halt } from "./halt";
import { removeItem } from "./removeItem";
import { switchIn } from "./switchIn";
import { useMove } from "./useMove";

/** Base handlers for each event. */
export const handlers =
{
    async activateAbility(...[cfg, ...args]:
            Parameters<typeof activateAbility>):
        ReturnType<typeof activateAbility>
    {
        const event = await verify(cfg, "activateAbility");
        return await activateAbility(
        {
            ...cfg,
            // TODO: should these functions add their own prefixes instead?
            logger: cfg.logger.addPrefix(`Ability(${event.monRef}, ` +
                `${event.ability}): `)
        },
            ...args);
    },
    async activateFieldEffect(cfg: SubParserConfig,
        weatherSource: Pokemon | null = null, weatherInfinite?: boolean):
        Promise<SubParserResult>
    {
        const event = await verify(cfg, "activateFieldEffect");
        if (dexutil.isWeatherType(event.effect))
        {
            cfg.state.status.weather.start(weatherSource, event.effect,
                weatherInfinite);
        }
        else cfg.state.status[event.effect][event.start ? "start" : "end"]();
        await consume(cfg);
        return {};
    },
    async activateItem(...[cfg, on = "turn", ...args]:
            Parameters<typeof activateItem>): ReturnType<typeof activateItem>
    {
        // if done, permHalt or reject
        // if type doesn't match, throw or reject?
        const event = await verify(cfg, "activateItem");
        return await activateItem(
        {
            ...cfg,
            logger: cfg.logger.addPrefix(`Item(${event.monRef}, ` +
                `${event.item}, on-${on}): `)
        },
            on, ...args);
    },
    async activateStatusEffect(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "activateStatusEffect");
        const mon = cfg.state.teams[event.monRef].active;
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
        await consume(cfg);
        // see if the target pokemon can use its ability to cure itself
        // TODO: implement status berries and other on-status effects before
        //  handling onStatus abilities
        /*if (event.start)
        {
            return await ability.onStatus(cfg, {[event.monRef]: true},
                event.effect);
        }*/
        return {};
    },
    async activateTeamEffect(cfg: SubParserConfig,
        source: Pokemon | null = null): Promise<SubParserResult>
    {
        const event = await verify(cfg, "activateTeamEffect");
        const ts = cfg.state.teams[event.teamRef].status;
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
        await consume(cfg);
        return {};
    },
    async block(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "block");
        if (event.effect === "substitute" &&
            !cfg.state.teams[event.monRef].active.volatile.substitute)
        {
            throw new Error("Substitute blocked an effect but no Substitute " +
                "exists");
        }
        await consume(cfg);
        return {};
    },
    async boost(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "boost");
        const {boosts} = cfg.state.teams[event.monRef].active.volatile;
        if (event.set) boosts[event.stat] = event.amount;
        else boosts[event.stat] += event.amount;
        await consume(cfg);
        return {};
    },
    async changeType(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "changeType");
        cfg.state.teams[event.monRef].active.volatile
            .changeTypes(event.newTypes);
        await consume(cfg);
        return {};
    },
    async clause(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "clause");
        await consume(cfg);
        return {};
    },
    async clearAllBoosts(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "clearAllBoosts");
        for (const side of Object.keys(cfg.state.teams) as Side[])
        {
            for (const stat of dexutil.boostKeys)
            {
                cfg.state.teams[side].active.volatile.boosts[stat] = 0;
            }
        }
        await consume(cfg);
        return {};
    },
    async clearNegativeBoosts(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "clearNegativeBoosts");
        const boosts = cfg.state.teams[event.monRef].active.volatile.boosts;
        for (const stat of dexutil.boostKeys)
        {
            if (boosts[stat] < 0) boosts[stat] = 0;
        }
        await consume(cfg);
        return {};
    },
    async clearPositiveBoosts(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "clearPositiveBoosts");
        const boosts = cfg.state.teams[event.monRef].active.volatile.boosts;
        for (const stat of dexutil.boostKeys)
        {
            if (boosts[stat] > 0) boosts[stat] = 0;
        }
        await consume(cfg);
        return {};
    },
    async copyBoosts(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "copyBoosts");
        const from = cfg.state.teams[event.from].active.volatile.boosts;
        const to = cfg.state.teams[event.to].active.volatile.boosts;
        for (const stat of dexutil.boostKeys) to[stat] = from[stat];
        await consume(cfg);
        return {};
    },
    async countStatusEffect(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "countStatusEffect");
        cfg.state.teams[event.monRef].active.volatile[event.effect] =
            event.amount;
        await consume(cfg);
        return {};
    },
    async crit(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "crit");
        await consume(cfg);
        return {};
    },
    async cureTeam(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "cureTeam");
        cfg.state.teams[event.teamRef].cure();
        await consume(cfg);
        return {};
    },
    async disableMove(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "disableMove");
        cfg.state.teams[event.monRef].active.volatile
            .disableMove(event.move);
        await consume(cfg);
        return {};
    },
    async fail(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "fail");
        await consume(cfg);
        return {};
    },
    async faint(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "faint");
        cfg.state.teams[event.monRef].active.faint();
        await consume(cfg);
        return {};
    },
    async fatigue(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "fatigue");
        cfg.state.teams[event.monRef].active.volatile.lockedMove.reset();
        await consume(cfg);
        return {};
    },
    async feint(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "feint");
        cfg.state.teams[event.monRef].active.volatile.feint();
        await consume(cfg);
        return {};
    },
    async formChange(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "formChange");
        const mon = cfg.state.teams[event.monRef].active;
        mon.formChange(event.species, event.level, event.perm);

        // set other details just in case
        // TODO: should gender also be in the traits object?
        mon.gender = event.gender;
        mon.hp.set(event.hp, event.hpMax);
        await consume(cfg);
        return {};
    },
    async futureMove(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "futureMove");
        if (event.start)
        {
            // starting a future move mentions the user
            cfg.state.teams[event.monRef].status
                .futureMoves[event.move].start(/*restart*/false);
        }
        else
        {
            // ending a future move mentions the target before
            //  taking damage
            cfg.state.teams[otherSide(event.monRef)].status
                .futureMoves[event.move].end();
        }
        await consume(cfg);
        return {};
    },
    async halt(...[cfg, ...args]: Parameters<typeof halt>):
        ReturnType<typeof halt>
    {
        const event = await verify(cfg, "halt");
        return await halt(
        {
            ...cfg,
            logger: cfg.logger.addPrefix(`Halt(${event.reason}): `)
        },
            ...args);
    },
    async hitCount(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "hitCount");
        await consume(cfg);
        return {};
    },
    async immune(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "immune");
        await consume(cfg);
        return {};
    },
    async inactive(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "inactive");
        const mon = cfg.state.teams[event.monRef].active;
        if (event.move) mon.moveset.reveal(event.move);

        switch (event.reason)
        {
            case "imprison":
                // opponent's imprison caused the pokemon to be prevented from
                //  moving, so the revealed move can be revealed for both sides
                if (!event.move) break;
                cfg.state.teams[otherSide(event.monRef)].active.moveset
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
        await consume(cfg);
        return {};
    },
    async initOtherTeamSize(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "initOtherTeamSize");
        cfg.state.teams.them.size = event.size;
        await consume(cfg);
        return {};
    },
    async initTeam(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "initTeam");
        const team = cfg.state.teams.us;
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
        await consume(cfg);
        return {};
    },
    async invertBoosts(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "invertBoosts");
        const boosts = cfg.state.teams[event.monRef].active.volatile.boosts;
        for (const stat of dexutil.boostKeys) boosts[stat] = -boosts[stat];
        await consume(cfg);
        return {};
    },
    async lockOn(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "lockOn");
        cfg.state.teams[event.monRef].active.volatile.lockOn(
            cfg.state.teams[event.target].active.volatile);
        await consume(cfg);
        return {};
    },
    async mimic(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "mimic");
        cfg.state.teams[event.monRef].active.mimic(event.move);
        await consume(cfg);
        return {};
    },
    async miss(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "miss");
        await consume(cfg);
        return {};
    },
    async modifyPP(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "modifyPP");
        const move = cfg.state.teams[event.monRef].active.moveset.reveal(
            event.move);
        if (event.amount === "deplete") move.pp = 0;
        else move.pp += event.amount;
        await consume(cfg);
        return {};
    },
    async mustRecharge(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "mustRecharge");
        // TODO: imply this in useMove event
        cfg.state.teams[event.monRef].active.volatile.mustRecharge = true;
        await consume(cfg);
        return {};
    },
    async noTarget(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "noTarget");
        await consume(cfg);
        return {};
    },
    async postTurn(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "postTurn");
        cfg.state.postTurn();
        await consume(cfg);
        return {};
    },
    async prepareMove(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "prepareMove");
        cfg.state.teams[event.monRef].active.volatile.twoTurn
            .start(event.move);
        await consume(cfg);
        return {};
    },
    async preTurn(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "preTurn");
        cfg.state.preTurn();
        await consume(cfg);
        return {};
    },
    async reenableMoves(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "reenableMoves");
        cfg.state.teams[event.monRef].active.volatile.enableMoves();
        await consume(cfg);
        return {};
    },
    async removeItem(...[cfg, on = null, ...args]:
        Parameters<typeof removeItem>): ReturnType<typeof removeItem>
    {
        const event = await verify(cfg, "removeItem");
        return await removeItem(
        {
            ...cfg,
            logger: cfg.logger.addPrefix(`RemoveItem(${event.monRef}, ` +
                `consumed=${event.consumed}, on-${on}): `)
        },
            on, ...args);
    },
    async resetWeather(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "resetWeather");
        cfg.state.status.weather.reset();
        await consume(cfg);
        return {};
    },
    async resisted(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "resisted");
        await consume(cfg);
        return {};
    },
    async restoreMoves(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "restoreMoves");
        const moveset = cfg.state.teams[event.monRef].active.moveset;
        for (const move of moveset.moves.values()) move.pp = move.maxpp;
        await consume(cfg);
        return {};
    },
    async revealItem(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "revealItem");
        cfg.state.teams[event.monRef].active
            .setItem(event.item, event.gained);
        await consume(cfg);
        return {};
    },
    async revealMove(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "revealMove");
        cfg.state.teams[event.monRef].active.moveset.reveal(event.move);
        await consume(cfg);
        return {};
    },
    async setThirdType(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "setThirdType");
        cfg.state.teams[event.monRef].active.volatile.addedType =
            event.thirdType;
        await consume(cfg);
        return {};
    },
    async sketch(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "sketch");
        cfg.state.teams[event.monRef].active.sketch(event.move);
        await consume(cfg);
        return {};
    },
    async superEffective(cfg: SubParserConfig): Promise<SubParserResult>
    {
        await verify(cfg, "superEffective");
        await consume(cfg);
        return {};
    },
    async swapBoosts(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "swapBoosts");
        const v1 = cfg.state.teams[event.monRef1].active.volatile.boosts;
        const v2 = cfg.state.teams[event.monRef2].active.volatile.boosts;
        for (const stat of event.stats)
        {
            [v1[stat], v2[stat]] = [v2[stat], v1[stat]];
        }
        await consume(cfg);
        return {};
    },
    async switchIn(...[cfg, ...args]: Parameters<typeof switchIn>):
        ReturnType<typeof switchIn>
    {
        const event = await verify(cfg, "switchIn");
        return await switchIn(
        {
            ...cfg,
            // TODO: add log prefix indicator for drag/self-switch?
            logger: cfg.logger.addPrefix(`Switch(${event.monRef}): `)
        },
            ...args);
    },
    async takeDamage(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "takeDamage");
        const mon = cfg.state.teams[event.monRef].active;
        mon.hp.set(event.hp);
        await consume(cfg);
        return {};
    },
    async transform(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "transform");
        cfg.state.teams[event.source].active.transform(
            cfg.state.teams[event.target].active);
        await consume(cfg);
        return {};
    },
    async trap(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "trap");
        cfg.state.teams[event.by].active.volatile.trap(
            cfg.state.teams[event.target].active.volatile);
        await consume(cfg);
        return {};
    },
    async updateFieldEffect(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "updateFieldEffect");
        // currently only applies to weather
        const weather = cfg.state.status.weather;
        if (weather.type !== event.effect)
        {
            throw new Error(`Weather is '${weather.type}' but ticked ` +
                `weather is '${event.effect}'`);
        }
        weather.tick();
        await consume(cfg);
        return {};
    },
    async updateMoves(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "updateMoves");
        const mon = cfg.state.teams[event.monRef].active;

        // infer moveset
        for (const data of event.moves)
        {
            const move = mon.moveset.reveal(data.id, data.maxpp);
            if (data.pp != null) move.pp = data.pp;
        }
        await consume(cfg);
        return {};
    },
    async updateStatusEffect(cfg: SubParserConfig): Promise<SubParserResult>
    {
        const event = await verify(cfg, "updateStatusEffect");
        cfg.state.teams[event.monRef].active.volatile[event.effect].tick();
        // TODO: if confusion, be sure to handle inactivity properly if damaged,
        //  as well as handle focussash interactions with that
        await consume(cfg);
        return {};
    },
    async useMove(...[cfg, called = false, ...args]:
            Parameters<typeof useMove>): ReturnType<typeof useMove>
    {
        const event = await verify(cfg, "useMove");
        let calledStr = "";
        if (called === "bounced") calledStr = ", bounced";
        else if (called) calledStr = ", called";

        return await useMove(
        {
            ...cfg,
            logger: cfg.logger.addPrefix(`Move(${event.monRef}, ` +
                `${event.move}${calledStr}): `)
        },
            called, ...args);
    }
} as const;

/** Dispatches event handler. */
export const dispatch = createDispatcher(handlers);
