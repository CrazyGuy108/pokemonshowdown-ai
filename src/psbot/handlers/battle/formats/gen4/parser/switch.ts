/** @file Handles parsing for events related to switch-ins. */
import { Protocol } from "@pkmn/protocol";
import { SideID } from "@pkmn/types";
import { BattleParserContext, consume, unordered, verify } from
    "../../../parser";
import { Pokemon } from "../state/Pokemon";
import { SwitchOptions } from "../state/Team";
import { parseMoveAction } from "./move";

/** Result of {@link switchAction} and {@link parseSelfSwitch}. */
export interface SwitchActionResult
{
    /** Pokemon that was switched in, or undefined if not accepted. */
    mon?: Pokemon;
    /** Optional Pokemon reference that interrupted the switch-in. */
    intercepted?: SideID;
}

/**
 * Creates an UnorderedDeadline parser for handling a switch choice.
 * @param side Player id.
 * @param reject Optional callback if this never happens.
 */
export function switchAction(side: SideID, reject?: () => void)
{
    return unordered.createUnorderedDeadline(
        (ctx, accept) => parseSwitchAction(ctx, side, accept), reject);
}

/**
 * Parses multiple switch-ins, handling their effects after both sides have sent
 * out a switch-in.
 * @returns The Pokemon that were switched in.
 */
export async function parseMultipleSwitchIns(ctx: BattleParserContext<"gen4">):
    Promise<Pokemon[]>
{
    const mons =
        (await unordered.expectUnordered(ctx,
            [switchEventInf("p1"), switchEventInf("p2")]))
        .filter(mon => mon) as Pokemon[];
    await parseMultipleSwitchEffects(ctx, mons);
    return mons;
}

const switchEventInf = (side: SideID) =>
    unordered.createUnorderedDeadline(
        (ctx, accept) => parseSwitchEvent(ctx, side, accept),
        () => { throw new Error(`Expected |switch| event for '${side}'`); });

/** Parses switch effects for multiple switch-ins.  */
async function parseMultipleSwitchEffects(ctx: BattleParserContext<"gen4">,
    mons: readonly Pokemon[])
{
    return await unordered.expectUnordered(ctx, mons.map(switchEffectsInf));
}

const switchEffectsInf = (mon: Pokemon) =>
    unordered.createUnorderedDeadline(
        async function turn1SwitchEffectsParser(ctx, accept)
        {
            return await parseSwitchEffects(ctx, mon, accept);
        },
        function turn1SwitchEffectsReject()
        {
            throw new Error(`Expected switch effects for ` +
                `'${mon.team!.side}': ${mon.species}`);
        });

/**
 * Parses a switch-in action, either by player choice or self-switch. Includes
 * effects that could happen before the main `|switch|` event.
 * @param side Player that should be making the switch action.
 * @param accept Callback to accept this pathway.
 */
async function parseSwitchAction(ctx: BattleParserContext<"gen4">,
    side: SideID, accept: () => void): Promise<SwitchActionResult>
{
    // accept cb gets consumed if one of the optional pre-switch effects accept
    let innerAccept: (() => void) | undefined =
        function() { innerAccept = undefined; accept(); };

    // expect a switch-intercepting move, e.g. pursuit
    let intercepted: SideID | undefined = side === "p1" ? "p2" : "p1";
    await parseMoveAction(ctx, intercepted, innerAccept, side);
    if (!innerAccept)
    {
        // opponent used up their action interrupting our switch
        // NOTE: switch continues if target faints
        // TODO: what if user faints, or more pre-switch effects are pending?
    }
    else intercepted = undefined;

    // expect any pre-switch effects, e.g. naturalcure ability
    // TODO

    // expect the actual switch-in
    const mon = await parseSwitch(ctx, side, innerAccept);
    return {...mon && {mon}, ...intercepted && {intercepted}};
}

/**
 * Parses a switch-in action by self-switch. Includes effects that could happen
 * before the main `|switch|` event.
 * @param side Player that should be making the switch action.
 */
export async function parseSelfSwitch(ctx: BattleParserContext<"gen4">,
    side: SideID): Promise<SwitchActionResult>
{
    let accepted = false;
    const res = await parseSwitchAction(ctx, side, () => accepted = true);
    if (!res.mon || !accepted)
    {
        throw new Error(`Expected |switch| event for '${side}'`);
    }
    return res;
}

/**
 * Parses a single `|switch|`/`|drag|` event and its implications.
 * @param side Player that should be making the switch action.
 * @param accept Callback to accept this pathway.
 * @returns The Pokemon that was switched in, or null if not accepted.
 */
export async function parseSwitch(ctx: BattleParserContext<"gen4">,
    side: SideID, accept: () => void): Promise<Pokemon | null>;
/**
 * Parses a single `|switch|`/`|drag|` event and its implications.
 * @param side Player that should be making the switch action. Omit to skip this
 * verification step.
 * @returns The Pokemon that was switched in.
 */
export async function parseSwitch(ctx: BattleParserContext<"gen4">,
    side?: SideID): Promise<Pokemon>;
export async function parseSwitch(ctx: BattleParserContext<"gen4">,
    side?: SideID, accept?: () => void): Promise<Pokemon | null>
{
    const mon = await parseSwitchEvent(ctx, side, accept);
    if (mon) await parseSwitchEffects(ctx, mon);
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
async function parseSwitchEvent(ctx: BattleParserContext<"gen4">,
    side?: SideID, accept?: () => void): Promise<Pokemon | null>
{
    const event = await verify(ctx, "|switch|", "|drag|");
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
        throw new Error(`Couldn't switch in '${identStr}': ` +
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
async function parseSwitchEffects(ctx: BattleParserContext<"gen4">,
    mon: Pokemon, accept?: () => void): Promise<void>
{

    // TODO
    accept?.();
}
