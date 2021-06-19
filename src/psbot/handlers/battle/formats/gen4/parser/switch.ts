/** @file Handles parsing for events related to switch-ins. */
import { Protocol } from "@pkmn/protocol";
import { SideID } from "@pkmn/types";
import { BattleParserContext, consume, peek, unordered, verify } from
    "../../../parser";
import { Pokemon } from "../state/Pokemon";
import { SwitchOptions } from "../state/Team";

/**
 * Parses multiple switch-ins, handling their effects after both sides have sent
 * out a switch-in.
 */
export async function parseMultipleSwitchIns(ctx: BattleParserContext<"gen4">)
{
    const mons =
        (await unordered.expectUnordered(ctx,
            [switchEventInf("p1"), switchEventInf("p2")]))
        .filter(mon => mon) as Pokemon[];
    // on-switch/on-start effects after both initial |switch| events
    return await parseMultipleSwitchEffects(ctx, mons);
}

const switchEventInf = (side: SideID) =>
    unordered.createUnorderedDeadline(
        async function switchEventParser(ctx, accept)
        {
            const event = await peek(ctx);
            if (event.args[0] !== "switch" ||
                Protocol.parsePokemonIdent(event.args[1]).player !== side)
            {
                return;
            }
            accept();
            return await parseSwitchEvent(ctx);
        },
        () => { throw new Error(`Expected |switch| event for '$[side}'`); });

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
            return await parseSwitchEffects(ctx, accept, mon);
        },
        () =>
        {
            throw new Error(`Expected switch effects for ` +
                `'${mon.team!.side}: ${mon.species}`);
        });

/** Parses single `|switch|` event and its implications. */
export async function parseSwitch(ctx: BattleParserContext<"gen4">)
{
    const mon = await parseSwitchEvent(ctx);
    return await parseSwitchEffects(ctx, /*accept*/ null, mon);
}

/** Parses initial `|switch|` event and returns the switched-in Pokemon obj. */
async function parseSwitchEvent(ctx: BattleParserContext<"gen4">):
    Promise<Pokemon>
{
    const event = await verify(ctx, "|switch|");
    const [_, identStr, detailsStr, healthStr] = event.args;

    const ident = Protocol.parsePokemonIdent(identStr);
    const data = Protocol.parseDetails(ident.name, identStr, detailsStr);
    const health = Protocol.parseHealth(healthStr);

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
    await consume(ctx);
    return mon;
}

/** Parses any effects that should happen after a switch-in. */
async function parseSwitchEffects(ctx: BattleParserContext<"gen4">,
    accept: (() => void) | null, mon: Pokemon)
{
    // TODO
    accept?.();
}
