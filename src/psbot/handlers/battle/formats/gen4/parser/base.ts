import { Protocol } from "@pkmn/protocol";
import { BoostID, SideID } from "@pkmn/types";
import { toIdName } from "../../../../../helpers";
import { Event } from "../../../../../parser";
import { BattleAgent } from "../../../agent";
import { baseEventLoop, BattleParserContext, consume, dispatcher,
    EventHandlerMap, tryPeek, verify } from "../../../parser";
import * as dex from "../dex";
import { useMove } from "./action/move";
import { switchIn } from "./action/switch";
import { abilityEvent } from "./effect/ability";

/** Private mapped type for {@link handlersImpl}. */
type HandlersImpl<T> =
    {-readonly [U in keyof T]: T[U] | "default" | "unsupported"};

/** Private mapped type for {@link handlersImpl} and {@link handlers}. */
type HandlerMap = EventHandlerMap<"gen4", BattleAgent<"gen4">, [], void>;

/**
 * BattleParser handlers for each event type. Larger handler functions or
 * parsers that take additional args are moved to a separate file.
 *
 * If an entry is specified but set to `"default"`, a default handler will be
 * assigned to it, making it an event that shouldn't be ignored but has no
 * special behavior implemented by its handler. Similarly, setting it to
 * `"unsupported"` will be replaced by a parser that always throws.
 */
const handlersImpl: HandlersImpl<HandlerMap> = {};
handlersImpl["|turn|"] = "default";
// TODO: game-over handler?
handlersImpl["|win|"] = "default";
handlersImpl["|tie|"] = "default";
handlersImpl["|move|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await useMove(ctx);
};
handlersImpl["|switch|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await switchIn(ctx);
};
handlersImpl["|drag|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await switchIn(ctx);
};
handlersImpl["|detailschange|"] = async function(
    ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|detailschange|");
    const [, identStr, detailsStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    const details = Protocol.parseDetails(ident.name, identStr, detailsStr);

    const mon = ctx.state.getTeam(ident.player).active;
    mon.formChange(details.speciesForme, details.level, /*perm*/ true);
    mon.gender = details.gender;

    await consume(ctx);
};
handlersImpl["|cant|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|cant|");
    const [, identStr, reason, moveStr] = event.args;

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
            // TODO: ability suffix?
    }

    mon.inactive();
    if (moveName) mon.moveset.reveal(moveName);

    await consume(ctx);
};
handlersImpl["|faint|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|faint|");
    const [, identStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    ctx.state.getTeam(ident.player).active.faint();
    await consume(ctx);
};
handlersImpl["|-formechange|"] = async function(
    ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-formechange|");
    const [, identStr, speciesForme] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);

    const mon = ctx.state.getTeam(ident.player).active;
    mon.formChange(speciesForme, mon.traits.stats.level, /*perm*/ false);

    await consume(ctx);
};
handlersImpl["|-block|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await verify(ctx, "|-block|");
    // TODO?
    await consume(ctx);
};
handlersImpl["|-damage|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await handleDamage(ctx);
};
handlersImpl["|-heal|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await handleDamage(ctx, /*heal*/ true);
};
async function handleDamage(ctx: BattleParserContext<"gen4">,
    heal?: boolean)
{
    const event = await verify(ctx, heal ? "|-heal|" : "|-damage|");
    const [, identStr, healthStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    const health = Protocol.parseHealth(healthStr);
    ctx.state.getTeam(ident.player).active.hp
        .set(health?.hp ?? 0, health?.maxhp ?? 0);
    await consume(ctx);
}
handlersImpl["|-sethp|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-sethp|");
    const [, identStr1, healthStr1, identStr2, healthNumStr2] = event.args;

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
};
handlersImpl["|-status|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-status|");
    const [, identStr, statusName] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    ctx.state.getTeam(ident.player).active.majorStatus.afflict(statusName);
    await consume(ctx);
};
handlersImpl["|-curestatus|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-curestatus|");
    const [, identStr, statusName] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    ctx.state.getTeam(ident.player).active.majorStatus
        .assert(statusName).cure();
    await consume(ctx);
};
handlersImpl["|-cureteam|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-cureteam|");
    const [, identStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    ctx.state.getTeam(ident.player).cure();
    await consume(ctx);
};
handlersImpl["|-boost|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await handleBoost(ctx);
};
handlersImpl["|-unboost|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await handleBoost(ctx, /*flip*/ true);
};
async function handleBoost(ctx: BattleParserContext<"gen4">, flip?: boolean)
{
    const event = await verify(ctx, flip ? "|-boost|" : "|-unboost|");
    const [, identStr, stat, numStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    const num = Number(numStr);
    if (isNaN(num))
    {
        throw new Error(`Invalid ${flip ? "un" : ""}boost num '${numStr}'`);
    }
    ctx.state.getTeam(ident.player).active.volatile.boosts[stat] +=
        flip ? -num : num;
    await consume(ctx);
}
handlersImpl["|-setboost|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-setboost|");
    const [, identStr, stat, numStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    const num = Number(numStr);
    if (isNaN(num))
    {
        throw new Error(`Invalid setboost num '${numStr}'`);
    }
    ctx.state.getTeam(ident.player).active.volatile.boosts[stat] = num;
    await consume(ctx);
};
handlersImpl["|-swapboost|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-swapboost|");
    const [, identStr1, identStr2, statsStr] = event.args;
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
};
handlersImpl["|-invertboost|"] = async function(
    ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-invertboost|");
    const [, identStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);

    const boosts = ctx.state.getTeam(ident.player).active.volatile.boosts;
    for (const stat of dex.boostKeys) boosts[stat] = -boosts[stat];

    await consume(ctx);
};
handlersImpl["|-clearboost|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-clearboost|");
    const [, identStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);

    const boosts = ctx.state.getTeam(ident.player).active.volatile.boosts;
    for (const stat of dex.boostKeys) boosts[stat] = 0;

    await consume(ctx);
};
handlersImpl["|-clearallboost|"] = async function(
    ctx: BattleParserContext<"gen4">)
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
};
handlersImpl["|-clearpositiveboost|"] = async function(
    ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-clearpositiveboost|");
    const [, identStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);

    const boosts = ctx.state.getTeam(ident.player).active.volatile.boosts;
    for (const stat of dex.boostKeys)
    {
        if (boosts[stat] > 0) boosts[stat] = 0;
    }

    await consume(ctx);
};
handlersImpl["|-clearnegativeboost|"] = async function(
    ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-clearpositiveboost|");
    const [, identStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);

    const boosts = ctx.state.getTeam(ident.player).active.volatile.boosts;
    for (const stat of dex.boostKeys)
    {
        if (boosts[stat] < 0) boosts[stat] = 0;
    }

    await consume(ctx);
};
handlersImpl["|-copyboost|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-copyboost|");
    const [, identStr1, identStr2, statsStr] = event.args;
    const ident1 = Protocol.parsePokemonIdent(identStr1);
    const ident2 = Protocol.parsePokemonIdent(identStr2);
    const stats = (statsStr?.split(", ") ?? dex.boostKeys) as BoostID[];

    const boosts1 = ctx.state.getTeam(ident1.player).active.volatile.boosts;
    const boosts2 = ctx.state.getTeam(ident2.player).active.volatile.boosts;
    for (const stat of stats) boosts2[stat] = boosts1[stat];

    await consume(ctx);
};
handlersImpl["|-weather|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-weather|");
    const [, weatherStr] = event.args;
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
};
handlersImpl["|-fieldstart|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await updateFieldEffect(ctx, /*start*/ true);
};
handlersImpl["|-fieldend|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await updateFieldEffect(ctx, /*start*/ false);
};
async function updateFieldEffect(ctx: BattleParserContext<"gen4">,
    start: boolean)
{
    const event = await verify(ctx,
        start ? "|-fieldstart|" : "|-fieldend|");
    const [, effectStr] = event.args;
    const effect = Protocol.parseEffect(effectStr, toIdName);
    switch (effect.name)
    {
        case "gravity":
            ctx.state.status.gravity[start ? "start" : "end"]();
            break;
        case "trickroom":
            ctx.state.status.trickRoom[start ? "start" : "end"]();
            break;
    }
    await consume(ctx);
}
handlersImpl["|-sidestart|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await handleSideCondition(ctx, /*start*/ true);
};
handlersImpl["|-sideend|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await handleSideCondition(ctx, /*start*/ false);
};
async function handleSideCondition(ctx: BattleParserContext<"gen4">,
    start: boolean)
{
    const event = await verify(ctx, start ? "|-sidestart|" : "|-sideend|");
    const [, sideStr, effectStr] = event.args;
    // parsePokemonIdent supports side identifiers
    const side = Protocol.parsePokemonIdent(
        sideStr as any as Protocol.PokemonIdent).player;
    const effect = Protocol.parseEffect(effectStr, toIdName);
    const ts = ctx.state.getTeam(side).status;
    switch (effect.name)
    {
        case "lightscreen":
            // TODO: source pokemon param
            if (start) ts.lightScreen.start();
            else ts.lightScreen.reset();
            break;
        case "reflect":
            // TODO: source pokemon param
            if (start) ts.reflect.start();
            else ts.reflect.reset();
            break;
        case "luckychant": ts.luckyChant[start ? "start" : "end"](); break;
        case "mist": ts.mist[start ? "start" : "end"](); break;
        case "safeguard": ts.safeguard[start ? "start" : "end"](); break;
        case "spikes":
            if (start) ++ts.spikes;
            else ts.spikes = 0;
            break;
        case "stealthrock":
            if (start) ++ts.stealthRock;
            else ts.stealthRock = 0;
            break;
        case "tailwind": ts.tailwind[start ? "start" : "end"](); break;
        case "toxicspikes":
            if (start) ++ts.toxicSpikes;
            else ts.toxicSpikes = 0;
            break;
    }
    await consume(ctx);
}
handlersImpl["|-start|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-start|");
    const [, identStr, effectStr, other] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    const effect = Protocol.parseEffect(effectStr, toIdName);
    const mon = ctx.state.getTeam(ident.player).active;
    switch (effect.name)
    {
        case "flashfire": mon.volatile.flashfire = true; break;
        case "typeadd":
            mon.volatile.addedType = other?.toLowerCase() as dex.Type ?? "???";
            break;
        case "typechange":
            // set types
            // format: |-start|<ident>|typechange|Type1/Type2
            if (other)
            {
                const types = other.split("/").map(toIdName) as dex.Type[];
                if (types.length > 2)
                {
                    // TODO: throw?
                    ctx.logger.error(`Too many types given: '${other}'`);
                    types.splice(2);
                }
                else if (types.length === 1) types.push("???");
                mon.volatile.changeTypes(types as [dex.Type, dex.Type]);
            }
            else mon.volatile.changeTypes(["???", "???"]);
            break;
        default:
            if (effect.name.startsWith("perish"))
            {
                mon.volatile.perish = parseInt(
                    effect.name.substr("perish".length), 10);
            }
            else if (effect.name.startsWith("stockpile"))
            {
                mon.volatile.stockpile = parseInt(
                    effect.name.substr("stockpile".length), 10);
            }
            else
            {
                handleStartEndTrivial(ctx, event, ident.player, effect.name,
                    other);
            }
    }
    await consume(ctx);
};
handlersImpl["|-end|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-end|");
    const [, identStr, effectStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    const effect = Protocol.parseEffect(effectStr, toIdName);
    const v = ctx.state.getTeam(ident.player).active.volatile;
    switch (effect.name)
    {
        case "stockpile": v.stockpile = 0; break;
        default:
            handleStartEndTrivial(ctx, event, ident.player, effect.name);
    }
    await consume(ctx);
};
function handleStartEndTrivial(ctx: BattleParserContext<"gen4">,
    event: Event<"|-start|" | "|-end|">, side: SideID, effectId: string,
    other?: string)
{
    const team = ctx.state.getTeam(side);
    const v = team.active.volatile;
    const start = event.args[0] === "-start";
    switch (effectId)
    {
        case "aquaring": v.aquaring = start; break;
        case "attract": v.attract = start; break;
        case "bide": v.bide[start ? "start" : "end"](); break;
        case "confusion":
            v.confusion[start ? "start" : "end"]();
            if (start && (event as Event<"|-start|">).kwArgs.fatigue)
            {
                v.lockedMove.reset();
            }
            break;
        case "curse": v.curse = start; break;
        case "disable":
            if (start)
            {
                if (!other) break;
                v.disableMove(toIdName(other))
            }
            else v.enableMoves();
            break;
        case "embargo": v.embargo[start ? "start" : "end"](); break;
        case "encore":
            if (start)
            {
                if (!v.lastMove)
                {
                    throw new Error("Can't Encore if lastMove is null");
                }
                v.encoreMove(v.lastMove);
            }
            else v.removeEncore();
            break;
        case "focusenergy": v.focusenergy = start; break;
        case "foresight": v.identified = start ? "foresight" : null; break;
        case "healblock": v.healblock[start ? "start" : "end"](); break;
        case "imprison": v.imprison = start; break;
        case "ingrain": v.ingrain = start; break;
        case "leechseed": v.leechseed = start; break;
        case "magnetrise": v.magnetrise[start ? "start" : "end"](); break;
        case "miracleeye": v.identified = start ? "miracleEye" : null; break;
        case "mudsport": v.mudsport = start; break;
        case "nightmare": v.nightmare = start; break;
        case "powertrick": v.powertrick = start; break;
        case "slowstart": v.slowstart[start ? "start" : "end"](); break;
        case "substitute": v.substitute = start; break;
        case "taunt": v.taunt[start ? "start" : "end"](); break;
        case "torment": v.torment = start; break;
        case "uproar":
            if (start && (event as Event<"|-start|">).kwArgs.upkeep)
            {
                v.uproar.tick();
            }
            else v.uproar[start ? "start" : "end"]();
            break;
        case "watersport": v.watersport = start; break;
        case "yawn": v.yawn[start ? "start" : "end"](); break;
        default:
            if (dex.isFutureMove(effectId))
            {
                if (start)
                {
                    team.status.futureMoves[effectId].start(/*restart*/ false);
                }
                else team.status.futureMoves[effectId].end();
            }
            else
            {
                ctx.logger.debug(
                    `Ignoring ${start ? "start" : "end"} '${effectId}'`);
            }
    }
}
handlersImpl["|-item|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-item|");
    // TODO
    await consume(ctx);
};
handlersImpl["|-enditem|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-enditem|");
    const [, identStr, itemName] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    const itemId = toIdName(itemName);

    const mon = ctx.state.getTeam(ident.player).active;
    const from = Protocol.parseEffect(event.kwArgs.from);

    // item-removal and steal-eat moves effectively delete the item
    let consumed: boolean | string;
    if (from.name === "stealeat" || dex.itemRemovalMoves.includes(from.name))
    {
        consumed = false;
    }
    // in most other(?) cases the item can be restored via Recycle
    else consumed = itemId;

    // likely consuming the status, not the actual berry
    if (itemId === "micleberry" && !event.kwArgs.eat)
    {
        await consume(ctx);
        return;
    }

    // TODO: item removal effects
    await consume(ctx);
};
handlersImpl["|-ability|"] = async function(ctx: BattleParserContext<"gen4">)
{
    await abilityEvent(ctx);
};
handlersImpl["|-endability|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-endability|");
    const [, identStr, abilityName] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    const mon = ctx.state.getTeam(ident.player).active;
    // reveal ability if specified
    if (abilityName && abilityName !== "none") mon.setAbility(abilityName);
    // event typically caused by gastro acid move
    mon.volatile.suppressAbility = true;
    await consume(ctx);
};
handlersImpl["|-transform|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-transform|");
    const [, identSourceStr, identTargetStr] = event.args;
    const identSource = Protocol.parsePokemonIdent(identSourceStr);
    const identTarget = Protocol.parsePokemonIdent(identTargetStr);
    ctx.state.getTeam(identSource.player).active.transform(
        ctx.state.getTeam(identTarget.player).active);
    await consume(ctx);
};
handlersImpl["|-mega|"] = "unsupported";
handlersImpl["|-primal|"] = "unsupported";
handlersImpl["|-burst|"] = "unsupported";
handlersImpl["|-zpower|"] = "unsupported";
handlersImpl["|-zbroken|"] = "unsupported";
handlersImpl["|-activate|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-activate|");
    const [, identStr, effectStr, other1, other2] = event.args;
    if (!identStr)
    {
        await consume(ctx);
        return;
    }
    const ident = Protocol.parsePokemonIdent(identStr);
    const effect = Protocol.parseEffect(effectStr, toIdName);
    const mon = ctx.state.getTeam(ident.player).active;
    const v = mon.volatile;
    switch (effect.name)
    {
        case "forewarn":
        {
            if (!other1) break;
            // reveal move from other side or specified target
            const side = event.kwArgs.of ?
                Protocol.parsePokemonIdent(event.kwArgs.of).player
                : ident.player === "p1" ? "p2" : "p1";
            const moveName = toIdName(other1);
            ctx.state.getTeam(side).active.moveset.reveal(moveName)
            break;
        }
        case "bide": v.bide.tick(); break;
        case "charge": v.charge.start(); break;
        // effect was used to block another effect, no further action needed
        case "endure": case "mist": case "protect": case "safeguard": break;
        case "feint": v.feint(); break;
        case "grudge":
            if (other1) mon.moveset.reveal(toIdName(other1)).pp = 0;
            break;
        case "leppaberry":
            if (other1) mon.moveset.reveal(toIdName(other1)).pp += 10;
            break;
        case "lockon": case "mindreader":
        {
            // activate effect from other side or specified target
            const targetSide = event.kwArgs.of ?
                Protocol.parsePokemonIdent(event.kwArgs.of).player
                : ident.player === "p1" ? "p2" : "p1";
            v.lockOn(ctx.state.getTeam(targetSide).active.volatile);
            break;
        }
        case "mimic":
        {
            if (!other1) break;
            // TODO: get last event
            const last = {} as Event | null;
            // use last (move) event to see whether this is actually Sketch or
            //  Mimic
            if (last?.args[0] !== "move" || last.args[1] !== event.args[1])
            {
                throw new Error("Don't know how Mimic was caused");
            }
            if (last.args[2] === "Mimic") mon.mimic(toIdName(other1));
            else if (last.args[2] === "Sketch") mon.sketch(toIdName(other1));
            else
            {
                throw new Error(`Unknown Mimic-like move '${last.args[2]}'`);
            }
            break;
        }
        case "spite":
        {
            if (!other1 || !other2) break;
            const amount = Number(other2);
            if (isNaN(amount) || !isFinite(amount)) break;
            mon.moveset.reveal(toIdName(other1)).pp -= amount;
            break;
        }
        case "substitute":
            if (!v.substitute)
            {
                // TODO: log?
                throw new Error("Substitute blocked an effect but no " +
                    "Substitute exists");
            }
            // effect was used to block another effect, no further action needed
            break;
        case "trapped":
            ctx.state.getTeam(ident.player === "p1" ? "p2" : "p1").active
                .volatile.trap(v);
            break;
        default:
            ctx.logger.debug(`Ignoring activate '${effect.name}'`);
    }
    await consume(ctx);
};
handlersImpl["|-fieldactivate|"] = async function(
    ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-fieldactivate|");
    // TODO
    await consume(ctx);
};
handlersImpl["|-center|"] = "unsupported";
handlersImpl["|-combine|"] = "unsupported";
handlersImpl["|-waiting|"] = "unsupported";
handlersImpl["|-prepare|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-prepare|");
    const [, identStr, moveName] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    const moveId = toIdName(moveName);
    if (!dex.isTwoTurnMove(moveId))
    {
        throw new Error(`Move '${moveId}' is not a two-turn move`);
    }
    ctx.state.getTeam(ident.player).active.volatile.twoTurn.start(moveId);
    await consume(ctx);
};
handlersImpl["|-mustrecharge|"] = async function(
    ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-mustrecharge|");
    const [, identStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    // TODO: this should already be implied by |move| effects
    ctx.state.getTeam(ident.player).active.volatile.mustRecharge = true;
    await consume(ctx);
};
handlersImpl["|-singlemove|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-singlemove|");
    const [, identStr, moveName] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    const v = ctx.state.getTeam(ident.player).active.volatile;
    switch (moveName)
    {
        case "Destiny Bond": v.destinybond = true; break;
        case "Grudge": v.grudge = true; break;
        case "Rage": v.rage = true; break;
    }
    await consume(ctx);
};
handlersImpl["|-singleturn|"] = async function(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-singleturn|");
    const [, identStr, effectStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    const effect = Protocol.parseEffect(effectStr, toIdName);
    const v = ctx.state.getTeam(ident.player).active.volatile;
    switch (effect.name)
    {
        case "endure": case "protect": v.stall(/*flag*/ true); break;
        case "focuspunch": v.focus = true; break;
        case "magiccoat": v.magiccoat = true; break;
        case "roost": v.roost = true; break;
        case "snatch": v.roost = true; break;
    }
    await consume(ctx);
};
handlersImpl["|-candynamax|"] = "unsupported";
handlersImpl["|updatepoke|"] = "unsupported";
handlersImpl["|-swapsideconditions|"] = "unsupported";

/** Checks whether an event can be safely ignored based on its key. */
export function isAllowedKey(key?: string): boolean
{
    return !!key && handlersImpl.hasOwnProperty(key);
}

/**
 * Parser that consumes an ignored event so it doesn't mess with other parsers.
 */
async function ignoredEvent(ctx: BattleParserContext<"gen4">)
{
    const event = await tryPeek(ctx);
    if (!event) return;
    const key = Protocol.key(event.args);
    if (!key || !handlersImpl.hasOwnProperty(key)) return;
    await consume(ctx);
}

/**
 * Parser that consumes any ignored events so they don't mess with other
 * parsers.
 */
export const ignoredEvents = baseEventLoop(ignoredEvent);

/** Handlers for all {@link Protocol.ArgName event types}. */
export const handlers: Required<HandlerMap> =
    // this Object.assign expression is so that the function names appear as if
    //  they were defined directly as properties of this object so that stack
    //  traces make more sense
    Object.assign({},
        handlersImpl,
        // fill in unimplemented handlers
        ...(Object.keys(Protocol.ARGS) as Protocol.ArgName[])
            .map(key =>
                !handlersImpl.hasOwnProperty(key) ||
                    handlersImpl[key] === "default" ?
                {
                    // default parser just consumes the event
                    async [key](ctx: BattleParserContext<"gen4">)
                    {
                        await defaultParser(ctx, key);
                    }
                }
                : handlersImpl[key] === "unsupported" ?
                {
                    // unsupported parser throws an error
                    async [key](ctx: BattleParserContext<"gen4">)
                    {
                        await unsupportedParser(ctx, key);
                    }
                }
                // handler already implemented, don't override it
                : undefined));

async function defaultParser(ctx: BattleParserContext<"gen4">,
    key: Protocol.ArgName)
{
    await verify(ctx, key);
    await consume(ctx);
}

async function unsupportedParser(ctx: BattleParserContext<"gen4">,
    key: Protocol.ArgName)
{
    throw new Error(`Unsupported event type '${key}'`);
}

/** Dispatches base event handler. */
export const dispatch = dispatcher(handlers);
