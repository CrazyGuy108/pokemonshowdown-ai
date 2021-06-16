/** @file Handles parsing for events related to switch-ins. */
import { Protocol } from "@pkmn/protocol";
import { SideID } from "@pkmn/types";
import { expectEvents } from "../../../../../../battle/parser/inference";
import { Event } from "../../../../../parser";
import { verifyNext } from "../../../helpers";
import { ParserContext } from "../../formats";
import { Pokemon } from "../state/Pokemon";
import { SwitchOptions } from "../state/Team";
import { singleCaseEventInference, singleEventInference,
    SingleEventInfPredicate } from "./helpers";

/**
 * Parses multiple switch-ins, handling their effects after both sides have sent
 * out a switch-in.
 */
export async function parseMultipleSwitchIns(ctx: ParserContext<"gen4">)
{
    const mons = (await expectEvents(ctx,
            [switchEventInf("p1"), switchEventInf("p2")]))
        .filter(mon => !!mon) as Pokemon[];
    // on-switch/on-start effects after both initial |switch| events
    await parseMultipleSwitchEffects(ctx, mons);
}

const switchEventInf = (side: SideID) =>
    singleEventInference(
        (event => event.args[0] === "switch" &&
                Protocol.parsePokemonIdent(event.args[1]).player === side) as
            SingleEventInfPredicate<Event<"|switch|">>,
        parseSwitchEvent);

/** Parses switch effects for multiple switch-ins.  */
async function parseMultipleSwitchEffects(ctx: ParserContext<"gen4">,
    mons: readonly Pokemon[])
{
    await expectEvents(ctx, mons.map(switchEffectsInf));
}

const switchEffectsInf = (mon: Pokemon) =>
    singleCaseEventInference(
        async function turn1SwitchEffectsParser(ctx, accept)
        {
            // TODO: lookahead to verify that we can parse
            accept();
            await parseSwitchEffects(ctx, mon);
        });

/** Parses single `|switch|` event and its implications. */
export async function parseSwitch(ctx: ParserContext<"gen4">)
{
    const event = await verifyNext(ctx, "|switch|");
    const mon = await parseSwitchEvent(ctx, event);
    await parseSwitchEffects(ctx, mon);
}

/** Parses initial `|switch|` event and returns the switched-in Pokemon obj. */
async function parseSwitchEvent(ctx: ParserContext<"gen4">,
    event: Event<"|switch|">): Promise<Pokemon>
{
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
    return mon;
}

/** Parses any effects that should happen after a switch-in. */
async function parseSwitchEffects(ctx: ParserContext<"gen4">, mon: Pokemon)
{
    // TODO
}
