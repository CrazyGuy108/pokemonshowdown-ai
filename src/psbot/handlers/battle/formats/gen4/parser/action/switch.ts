/** @file Handles parsing for events related to switch-ins. */
import { Protocol } from "@pkmn/protocol";
import { SideID } from "@pkmn/types";
import { Event } from "../../../../../../parser";
import { BattleParserContext, consume, tryVerify, unordered, verify } from
    "../../../../parser";
import { Pokemon } from "../../state/Pokemon";
import { SwitchOptions } from "../../state/Team";
import { ActionResult } from "./action";
import { interceptSwitch, MoveResult } from "./move";

/** Result of {@link switchAction} and {@link selfSwitch}. */
export interface SwitchActionResult extends ActionResult
{
    /** Pokemon that was switched in, or undefined if not accepted. */
    mon?: Pokemon;
}

/**
 * Creates an UnorderedDeadline parser for handling a switch choice.
 * @param side Player id.
 * @param reject Optional callback if this never happens.
 */
export function switchAction(side: SideID, reject?: () => void)
{
    return unordered.createUnorderedDeadline(
        (ctx, accept) => switchActionImpl(ctx, side, accept), reject);
}

/**
 * Parses a switch-in action by self-switch. Includes effects that could happen
 * before the main `|switch|` event.
 * @param side Player that should be making the switch action.
 */
export async function selfSwitch(ctx: BattleParserContext<"gen4">,
    side: SideID): Promise<SwitchActionResult>
{
    return await switchActionImpl(ctx, side);
}

/**
 * Parses multiple switch-ins, handling their effects after both sides have sent
 * out a switch-in.
 * @returns The Pokemon that were switched in.
 */
export async function multipleSwitchIns(ctx: BattleParserContext<"gen4">):
    Promise<Pokemon[]>
{
    const mons =
        (await unordered.all(ctx,
                (["p1", "p2"] as SideID[]).map(unorderedSwitchEvent)))
            .filter(mon => mon) as Pokemon[];
    await multipleSwitchEffects(ctx, mons);
    return mons;
}

const unorderedSwitchEvent = (side: SideID) =>
    unordered.createUnorderedDeadline(
        (ctx, accept) => switchEvent(ctx, side, accept),
        () => { throw new Error(`Expected |switch| event for '${side}'`); });

/** Parses switch effects for multiple switch-ins.  */
async function multipleSwitchEffects(ctx: BattleParserContext<"gen4">,
    mons: readonly Pokemon[])
{
    return await unordered.all(ctx, mons.map(unorderedSwitchEffects));
}

const unorderedSwitchEffects = (mon: Pokemon) =>
    unordered.createUnorderedDeadline(
        async function multipleSwitchEffectsParser(ctx, accept)
        {
            return await switchEffects(ctx, mon, accept);
        },
        function multipleSwitchEffectsReject()
        {
            throw new Error(`Expected switch effects for ` +
                `'${mon.team!.side}': ${mon.species}`);
        });

/**
 * Parses a switch-in action, either by player choice or by self-switch.
 * Includes effects that could happen before the main `|switch|` event.
 * @param side Player that should be making the switch action.
 * @param accept Callback to accept this pathway.
 */
async function switchActionImpl(ctx: BattleParserContext<"gen4">,
    side: SideID, accept?: () => void): Promise<SwitchActionResult>
{
    const res: SwitchActionResult = {actioned: {[side]: true}};
    // accept cb gets consumed if one of the optional pre-switch effects accept
    // once it gets called the first time, subsequent uses of this value should
    //  be ignored since we'd now be committing to this pathway
    accept &&= function switchActionAccept()
    {
        const a = accept!;
        accept = undefined;
        a();
    };

    const interceptRes = await preSwitch(ctx, side, accept);
    if (interceptRes) Object.assign(res.actioned, interceptRes.actioned);

    // expect the actual switch-in
    const mon = await (accept ?
            switchIn(ctx, side, accept) : switchIn(ctx, side));
    if (mon) res.mon = mon;
    return res;
}

/**
 * Parses any pre-switch effects.
 * @param side Pokemon reference who is switching out.
 * @param accept Callback to accept this pathway.
 * @returns The result of a switch-interception move action, if found.
 */
async function preSwitch(ctx: BattleParserContext<"gen4">, side: SideID,
    accept?: () => void): Promise<MoveResult>
{
    accept &&= function preSwitchAccept()
    {
        const a = accept!;
        accept = undefined;
        a();
    };

    // parse a possible switch-intercepting move, e.g. pursuit
    let intercepting: SideID | undefined = side === "p1" ? "p2" : "p1";
    const committed = !accept;
    const moveRes = await interceptSwitch(ctx, intercepting, side, accept);
    // opponent used up their action interrupting our switch
    if (!committed && !accept)
    {
        // NOTE: switch continues even if target faints
        // TODO: what if user faints, or more pre-switch effects are pending?
    }
    else intercepting = undefined;

    // TODO: other pre-switch effects, e.g. naturalcure ability

    return moveRes;
}

/**
 * Parses a single `|switch|`/`|drag|` event and its implications.
 * @param side Player that should be making the switch action.
 * @param accept Callback to accept this pathway.
 * @returns The Pokemon that was switched in, or null if not accepted.
 */
export async function switchIn(ctx: BattleParserContext<"gen4">,
    side: SideID, accept: () => void): Promise<Pokemon | null>;
/**
 * Parses a single `|switch|`/`|drag|` event and its implications.
 * @param side Player that should be making the switch action. Omit to skip this
 * verification step.
 * @returns The Pokemon that was switched in.
 */
export async function switchIn(ctx: BattleParserContext<"gen4">,
    side?: SideID): Promise<Pokemon>;
export async function switchIn(ctx: BattleParserContext<"gen4">,
    side?: SideID, accept?: () => void): Promise<Pokemon | null>
{
    const mon = await switchEvent(ctx, side, accept);
    if (mon) await switchEffects(ctx, mon);
    return mon;
}

/**
 * Parses initial `|switch|`/`|drag|` event and returns the switched-in Pokemon
 * obj.
 * @param sideId Player that should be making the switch action.
 * @param accept Optional accept cb. If not provided, this function will throw
 * on an invalid initial switch event.
 * @returns The Pokemon that was switched in, or null if invalid event and
 * `accept` was specified.
 */
async function switchEvent(ctx: BattleParserContext<"gen4">,
    side?: SideID, accept?: () => void): Promise<Pokemon | null>
{
    let event: Event<"|switch|" | "|drag|">;
    if (accept)
    {
        const ev = await tryVerify(ctx, "|switch|", "|drag|")
        if (!ev) return null;
        event = ev;
    }
    else event = await verify(ctx, "|switch|", "|drag|");
    const [_, identStr, detailsStr, healthStr] = event.args;

    const ident = Protocol.parsePokemonIdent(identStr);
    if (side && ident.player !== side)
    {
        if (accept) return null;
        throw new Error(`Expected switch-in for '${side}' but got ` +
            `'${ident.player}'`);
    }
    const data = Protocol.parseDetails(ident.name, identStr, detailsStr);
    const health = Protocol.parseHealth(healthStr);

    ctx =
    {
        ...ctx,
        logger: ctx.logger.addPrefix("Switch(" +
            `${ident.player}${ident.position}): `)
    };

    const options: SwitchOptions =
    {
        species: data.name, level: data.level, gender: data.gender ?? "N",
        hp: health?.hp ?? 0, hpMax: health?.maxhp ?? 0
    };
    const team = ctx.state.getTeam(ident.player);
    const mon = team.switchIn(options);
    if (!mon)
    {
        throw new Error(`Could not switch in '${identStr}': ` +
            `Team '${ident.player}' was too full (size=${team.size})`);
    }
    accept?.();
    await consume(ctx);
    return mon;
}

/**
 * Parses any effects that should happen after a switch-in.
 * @param mon Pokemon that was switched in.
 * @param accept Optional accept cb.
 */
async function switchEffects(ctx: BattleParserContext<"gen4">,
    mon: Pokemon, accept?: () => void): Promise<void>
{

    // TODO
    accept?.();
}
