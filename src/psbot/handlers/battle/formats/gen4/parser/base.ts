import { Protocol } from "@pkmn/protocol";
import { BoostID, SideID } from "@pkmn/types";
import { toIdName } from "../../../../../helpers";
import { BattleParserContext, consume, createDispatcher, EventHandlerMap,
    verify } from "../../../parser";
import * as dex from "../dex";
import { handleAbilitySuffix, parseAbility } from "./ability";
import { parseMove } from "./move";
import { parseSwitch } from "./switch";

/**
 * BattleParser handlers for each event type. Larger handler functions are moved
 * to a separate file.
 */
const handlers =
{
    async "|init|"(ctx: BattleParserContext<"gen4">)
    {
        // optional room initializer
        const event = await verify(ctx, "|init|");
        if (event.args[1] !== "battle")
        {
            throw new Error("Expected room type 'battle' but got " +
                `'${event.args[1]}'`)
        }
        await consume(ctx);
    },
    async "|move|"(ctx: BattleParserContext<"gen4">)
    {
        return await parseMove(ctx);
    },
    async "|switch|"(ctx: BattleParserContext<"gen4">)
    {
        return await parseSwitch(ctx);
    },
    async "|drag|"(ctx: BattleParserContext<"gen4">)
    {
        return await parseSwitch(ctx);
    },
    async "|detailschange|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|detailschange|");
        const [_, identStr, detailsStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        const details = Protocol.parseDetails(ident.name, identStr, detailsStr);

        const mon = ctx.state.getTeam(ident.player).active;
        mon.formChange(details.speciesForme, details.level, /*perm*/ true);
        mon.gender = details.gender;

        await consume(ctx);
    },
    async "|cant|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|cant|");
        const [_, identStr, reason, moveStr] = event.args;

        // should already be handled by previous |move| event
        if (reason === "Focus Punch") return;

        const ident = Protocol.parsePokemonIdent(identStr);
        const moveName = moveStr && toIdName(moveStr);
        const mon = ctx.state.getTeam(ident.player).active;

        switch (reason)
        {
            case "imprison":
                // opponent's imprison caused the pokemon to be prevented from
                //  moving, so the revealed move can be revealed for both sides
                if (!moveName) break;
                ctx.state.getTeam(ident.player === "p1" ? "p2" : "p1").active
                    .moveset.reveal(moveName);
                break;
            case "recharge":
                mon.volatile.mustRecharge = false;
                break;
            case "slp":
                mon.majorStatus.assert("slp").tick(mon.ability);
                break;
            default:
                handleAbilitySuffix(ctx, event);
        }

        mon.inactive();
        if (moveName) mon.moveset.reveal(moveName);

        await consume(ctx);
    },
    async "|faint|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|faint|");
        const [_, identStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        ctx.state.getTeam(ident.player).active.faint();
        await consume(ctx);
    },
    async "|-formechange|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-formechange|");
        const [_, identStr, speciesForme] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);

        const mon = ctx.state.getTeam(ident.player).active;
        mon.formChange(speciesForme, mon.traits.stats.level, /*perm*/ false);

        await consume(ctx);
    },
    async "|-block|"(ctx: BattleParserContext<"gen4">)
    {
        await verify(ctx, "|-block|");
        // TODO?
        await consume(ctx);
    },
    async "|-damage|"(ctx: BattleParserContext<"gen4">)
    {
        return await handlers.handleDamage(ctx);
    },
    async "|-heal|"(ctx: BattleParserContext<"gen4">)
    {
        return await handlers.handleDamage(ctx, /*heal*/ true);
    },
    async handleDamage(ctx: BattleParserContext<"gen4">, heal?: boolean)
    {
        const event = await verify(ctx, heal ? "|-heal|" : "|-damage|");
        const [_, identStr, healthStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        const health = Protocol.parseHealth(healthStr);
        ctx.state.getTeam(ident.player).active.hp
            .set(health?.hp ?? 0, health?.maxhp ?? 0);
        await consume(ctx);
    },
    async "|-sethp|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-sethp|");
        const [_, identStr1, healthStr1, identStr2, healthNumStr2] = event.args;

        const ident1 = Protocol.parsePokemonIdent(identStr1);
        const mon1 = ctx.state.getTeam(ident1.player).active;

        if (!identStr2 || !healthNumStr2)
        {
            // only one hp to set, so healthStr1 is an HPStatus strr
            const health1 = Protocol.parseHealth(
                    healthStr1 as Protocol.PokemonHPStatus);
            mon1.hp.set(health1?.hp ?? 0, health1?.maxhp ?? 0);
        }
        else
        {
            // two hp numbers to set
            const healthNum1 = Number(healthStr1);
            if (isNaN(healthNum1))
            {
                throw new Error(`Invalid health number '${healthStr1}'`);
            }
            mon1.hp.set(healthNum1);

            const ident2 = Protocol.parsePokemonIdent(identStr2);
            const mon2 = ctx.state.getTeam(ident2.player).active;
            const healthNum2 = Number(healthNumStr2);
            if (isNaN(healthNum2))
            {
                throw new Error(`Invalid health number '${healthNumStr2}'`);
            }
            mon2.hp.set(healthNum2);
        }

        await consume(ctx);
    },
    async "|-status|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-status|");
        const [_, identStr, statusName] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        ctx.state.getTeam(ident.player).active.majorStatus.afflict(statusName);
        await consume(ctx);
    },
    async "|-curestatus|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-curestatus|");
        const [_, identStr, statusName] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        ctx.state.getTeam(ident.player).active.majorStatus
            .assert(statusName).cure();
        await consume(ctx);
    },
    async "|-cureteam|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-cureteam|");
        const [_, identStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        ctx.state.getTeam(ident.player).cure();
        await consume(ctx);
    },
    async "|-boost|"(ctx: BattleParserContext<"gen4">)
    {
        return await handlers.handleBoost(ctx);
    },
    async "|-unboost|"(ctx: BattleParserContext<"gen4">)
    {
        return await handlers.handleBoost(ctx, /*flip*/ true);
    },
    async handleBoost(ctx: BattleParserContext<"gen4">, flip?: boolean)
    {
        const event = await verify(ctx, flip ? "|-boost|" : "|-unboost|");
        const [_, identStr, stat, numStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        const num = Number(numStr);
        if (isNaN(num))
        {
            throw new Error(`Invalid ${flip ? "un" : ""}boost num '${numStr}'`);
        }
        ctx.state.getTeam(ident.player).active.volatile.boosts[stat] +=
            flip ? -num : num;
        await consume(ctx);
    },
    async "|-setboost|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-setboost|");
        const [_, identStr, stat, numStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        const num = Number(numStr);
        if (isNaN(num))
        {
            throw new Error(`Invalid setboost num '${numStr}'`);
        }
        ctx.state.getTeam(ident.player).active.volatile.boosts[stat] = num;
        await consume(ctx);
    },
    async "|-swapboost|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-swapboost|");
        const [_, identStr1, identStr2, statsStr] = event.args;
        const ident1 = Protocol.parsePokemonIdent(identStr1);
        const ident2 = Protocol.parsePokemonIdent(identStr2);
        const stats = (statsStr?.split(", ") ?? dex.boostKeys) as BoostID[];

        const boosts1 = ctx.state.getTeam(ident1.player).active.volatile.boosts;
        const boosts2 = ctx.state.getTeam(ident2.player).active.volatile.boosts;

        for (const stat of stats)
        {
            [boosts1[stat], boosts2[stat]] = [boosts2[stat], boosts1[stat]];
        }

        await consume(ctx);
    },
    async "|-invertboost|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-invertboost|");
        const [_, identStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);

        const boosts = ctx.state.getTeam(ident.player).active.volatile.boosts;
        for (const stat of dex.boostKeys) boosts[stat] = -boosts[stat];

        await consume(ctx);
    },
    async "|-clearboost|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-clearboost|");
        const [_, identStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);

        const boosts = ctx.state.getTeam(ident.player).active.volatile.boosts;
        for (const stat of dex.boostKeys) boosts[stat] = 0;

        await consume(ctx);
    },
    async "|-clearallboost|"(ctx: BattleParserContext<"gen4">)
    {
        await verify(ctx, "|-clearallboost|");

        for (const sideId in ctx.state.teams)
        {
            if (!ctx.state.teams.hasOwnProperty(sideId)) continue;
            const team = ctx.state.teams[sideId as SideID];
            if (!team) continue;
            const boosts = team.active.volatile.boosts;
            for (const stat of dex.boostKeys) boosts[stat] = 0;
        }

        await consume(ctx);
    },
    async "|-clearpositiveboost|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-clearpositiveboost|");
        const [_, identStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);

        const boosts = ctx.state.getTeam(ident.player).active.volatile.boosts;
        for (const stat of dex.boostKeys)
        {
            if (boosts[stat] > 0) boosts[stat] = 0;
        }

        await consume(ctx);
    },
    async "|-clearnegativeboost|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-clearpositiveboost|");
        const [_, identStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);

        const boosts = ctx.state.getTeam(ident.player).active.volatile.boosts;
        for (const stat of dex.boostKeys)
        {
            if (boosts[stat] < 0) boosts[stat] = 0;
        }

        await consume(ctx);
    },
    async "|-copyboost|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-copyboost|");
        const [_, identStr1, identStr2, statsStr] = event.args;
        const ident1 = Protocol.parsePokemonIdent(identStr1);
        const ident2 = Protocol.parsePokemonIdent(identStr2);
        const stats = (statsStr?.split(", ") ?? dex.boostKeys) as BoostID[];

        const boosts1 = ctx.state.getTeam(ident1.player).active.volatile.boosts;
        const boosts2 = ctx.state.getTeam(ident2.player).active.volatile.boosts;
        for (const stat of stats) boosts2[stat] = boosts1[stat];

        await consume(ctx);
    },
    async "|-weather|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-weather|");
        const [_, weatherStr] = event.args;
        if (event.kwArgs.upkeep)
        {
            if (ctx.state.status.weather.type !== weatherStr)
            {
                throw new Error("Weather is " +
                    `'${ctx.state.status.weather.type}' but ticked weather ` +
                    `is '${weatherStr}'`);
            }
            ctx.state.status.weather.tick();
        }
        else
        {
            // TODO: how to handle dense events while still preserving expect
            //  functionality?
            // TODO: fully implement turn loop first
            if (event.kwArgs.from?.startsWith("ability: "))
            {
                // TODO
            }

            ctx.state.status.weather.start(/*source*/ null,
                weatherStr as dex.WeatherType | "none");
        }

        await consume(ctx);
    },
    async "|-fieldstart|"(ctx: BattleParserContext<"gen4">)
    {
        return await handlers.updateFieldEffect(ctx, /*start*/ true);
    },
    async "|-fieldend|"(ctx: BattleParserContext<"gen4">)
    {
        return await handlers.updateFieldEffect(ctx, /*start*/ false);
    },
    async updateFieldEffect(ctx: BattleParserContext<"gen4">, start: boolean)
    {
        const event = await verify(ctx,
            start ? "|-fieldstart|" : "|-fieldend|");
        const [_, effectStr] = event.args;
        switch (effectStr)
        {
            case "move: Gravity":
                ctx.state.status.gravity[start ? "start" : "end"]();
                break;
            case "move: Trick Room":
                ctx.state.status.trickRoom[start ? "start" : "end"]();
                break;
        }
        await consume(ctx);
    },
    async "|-sidestart|"(ctx: BattleParserContext<"gen4">)
    {
        return await handlers.handleSideCondition(ctx, /*start*/ true);
    },
    async "|-sideend|"(ctx: BattleParserContext<"gen4">)
    {
        return await handlers.handleSideCondition(ctx, /*start*/ false);
    },
    async function handleSideCondition(ctx: BattleParserContext<"gen4">,
        start: boolean)
    {
        const event = await verify(ctx, start ? "|-sidestart|" : "|-sideend|");
        const [_, identStr, effect] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        const ts = ctx.state.getTeam(ident.player).status;
        switch (effect)
        {
            case "move: Light Screen": case "Light Screen":
                // TODO: source pokemon param
                if (start) ts.lightScreen.start();
                else ts.lightScreen.end();
                break;
            case "move: Reflect": case "Reflect":
                // TODO: source pokemon param
                if (start) ts.reflect.start();
                else ts.reflect.end();
                break;
            case "move: Lucky Chant": case "Lucky Chant":
                ts.luckyChant[start ? "start" : "end"]();
                break;
            case "move: Mist": case "Mist":
                ts.mist[start ? "start" : "end"]();
                break;
            case "move: Safeguard": case "Safeguard":
                ts.safeguard[start ? "start" : "end"]();
                break;
            case "move: Spikes": case "Spikes":
                if (start) ++ts.spikes;
                else ts.spikes = 0;
                break;
            case "move: Stealth Rock": case "Stealth Rock":
                if (start) ++ts.stealthRock;
                else ts.stealthRock = 0;
                break;
            case "move: Tailwind": case "Tailwind":
                ts.tailwind[start ? "start" : "end"]();
                break;
            case "move: Toxic Spikes": case "Toxic Spikes":
                if (start) ++ts.toxicSpikes;
                else ts.toxicSpikes = 0;
                break;
        }
        await consume(ctx);
    },
    async "|-start|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-start|");
        // TODO
        await consume(ctx);
    },
    async "|-end|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-end|");
        // TODO
        await consume(ctx);
    },
    async "|-item|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-item|");
        // TODO
        await consume(ctx);
    },
    async "|-enditem|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-enditem|");
        // TODO
        await consume(ctx);
    },
    async "|-ability|"(ctx: BattleParserContext<"gen4">)
    {
        await parseAbility(ctx);
    },
    async "|-endability|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-endability|");
        // TODO
        await consume(ctx);
    },
    async "|-transform|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-transform|");
        const [_, identSourceStr, identTargetStr] = event.args;
        const identSource = Protocol.parsePokemonIdent(identSourceStr);
        const identTarget = Protocol.parsePokemonIdent(identTargetStr);
        ctx.state.getTeam(identSource.player).active.transform(
            ctx.state.getTeam(idenetTarget.player).active);
        await consume(ctx);
    },
    async "|-mega|"(ctx: BattleParserContext<"gen4">)
    {
        throw new Error("Unsupported event type '|-mega|'");
    },
    async "|-primal|"(ctx: BattleParserContext<"gen4">)
    {
        throw new Error("Unsupported event type '|-primal|'");
    },
    async "|-burst|"(ctx: BattleParserContext<"gen4">)
    {
        throw new Error("Unsupported event type '|-burst|'");
    },
    async "|-zpower|"(ctx: BattleParserContext<"gen4">)
    {
        throw new Error("Unsupported event type '|-zpower|'");
    },
    async "|-zbroken|"(ctx: BattleParserContext<"gen4">)
    {
        throw new Error("Unsupported event type '|-zbroken|'");
    },
    async "|-activate|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-activate|");
        // TODO
        await consume(ctx);
    },
    async "|-fieldactivate|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-fieldactivate|");
        // TODO
        await consume(ctx);
    },
    async "|-center|"(ctx: BattleParserContext<"gen4">)
    {
        throw new Error("Unsupported event type '|-center|'");
    },
    async "|-combine|"(ctx: BattleParserContext<"gen4">)
    {
        throw new Error("Unsupported event type '|-combine|'");
    },
    async "|-waiting|"(ctx: BattleParserContext<"gen4">)
    {
        throw new Error("Unsupported event type '|-waiting|'");
    },
    async "|-prepare|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-prepare|");
        const [_, identStr, moveName] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        const moveId = toIdName(moveName);
        if (!dex.isTwoTurnMove(moveId))
        {
            throw new Error(`Move '${moveId}' is not a two-turn move`);
        }
        ctx.state.getTeam(ident.player).active.volatile.twoTurn.start(moveId);
        await consume(ctx);
    },
    async "|-mustrecharge|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-mustrecharge|");
        const [_, identStr] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        // TODO: this should already be implied by |move| effects
        ctx.state.getTeam(ident.player).active.volatile.mustRecharge = true;
        await consume(ctx);
    },
    async "|-singlemove|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-singlemove|");
        const [_, identStr, moveName] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        const v = ctx.state.getTeam(ident.player).active.volatile;
        switch (moveName)
        {
            case "Destiny Bond": v.destinyBond = true; break;
            case "Grudge": v.grudge = true; break;
            case "Rage": v.rage = true; break;
        }
        await consume(ctx);
    },
    async "|-singleturn|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|-singleturn|");
        const [_, identStr, effect] = event.args;
        const ident = Protocol.parsePokemonIdent(identStr);
        const v = ctx.state.getTeam(ident.player).active.volatile;
        switch (effect)
        {
            case "move: Endure": case "Endure":
            case "move: Protect": case "Protect":
                v.stall(/*flag*/ true);
                break;
            case "move: Focus Punch": case "Focus Punch":
                v.focus = true;
                break;
            case "move: Magic Coat": case "Magic Coat":
                v.magicCoat = true;
                break;
            case "move: Roost": case "Roost":
                v.roost = true;
                break;
            case "move: Snatch": case "Snatch":
                v.roost = true;
                break;
        }
        await consume(ctx);
    },
    async "|-candynamax|"(ctx: BattleParserContext<"gen4">)
    {
        throw new Error("Unsupported event type '|-candynamax|'");
    },
    async "|updatepoke|"(ctx: BattleParserContext<"gen4">)
    {
        throw new Error("Unsupported event type '|updatepoke|'");
    },
    async "|-swapsideconditions|"(ctx: BattleParserContext<"gen4">)
    {
        throw new Error("Unsupported event type '|-swapsideconditions|'");
    }
} as const;

type Writable<T> = {-readonly [U in keyof T]: T[U]};

// fill in parsers for ignored events
const allHandlers: Writable<EventHandlerMap<"gen4">> = {...handlers};
for (const key in Protocol.ARGS)
{
    if (!Protocol.ARGS.hasOwnProperty(key)) continue;
    if (allHandlers.hasOwnProperty(key)) continue;
    const parser =
        async function(ctx: BattleParserContext<"gen4">)
        {
            await verify(ctx, key as Protocol.ArgName);
            await consume(ctx);
        };
    parser.name = key;
    allHandlers[key as Protocol.ArgName] = parser;
}

/** Dispatches event handler. */
export const dispatch = createDispatcher(allHandlers);
