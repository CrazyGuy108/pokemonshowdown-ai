/** @file Handles parsing a player's main action. */
import { SideID } from "@pkmn/types";
import { BattleAgent } from "../../../agent";
import { BattleParserContext, consume, eventLoop, peek, unordered } from
    "../../../parser";
import { moveAction } from "./move";
import { switchAction, SwitchActionResult } from "./switch";

/** Parses each player's main actions for this turn. */
export async function parsePlayerActions(ctx: BattleParserContext<"gen4">)
{
    // shared state used to track whether each pokemon has spent their action
    //  for this turn
    const actioned: {[S in SideID]?: true} = {};

    return await unordered.expectUnordered(ctx,
        (Object.entries(ctx.state.teams) as [SideID, any][])
            .map(([side]) => playerAction(side, actioned)),
        filter);
}

/**
 * Creates an UnorderedDeadline parser for a player's main action for this turn.
 * @param side Player's side.
 * @param actioned Map of Pokemon reference to whether they've spent their
 * action for this turn.
 */
const playerAction = (side: SideID, actioned: {[S in SideID]?: true}) =>
    unordered.createUnorderedDeadline(
        async function parsePlayerAction(ctx, accept)
        {
            if (actioned[side])
            {
                accept();
                return;
            }

            const [ok, res] = await unordered.expectOneOf<
                    "gen4", BattleAgent<"gen4">, [], SwitchActionResult | void>(
                // TODO: action parser for inactivity
                ctx, [moveAction(side), switchAction(side)]);
            if (ok) accept();
            // switch was intercepted by another pokemon, should also count as
            //  their action for this turn
            if (res && res.intercepted) actioned[res.intercepted] = true;
        },
        () => { throw new Error(`Expected ${side} action`); });

/** Consumes ignored events until the end of player actions. */
async function filter(ctx: BattleParserContext<"gen4">, accept: () => void)
{
    await eventLoop(ctx,
        async function filterLoop(_ctx)
        {
            const event = await peek(ctx);
            switch (event.args[0])
            {
                // terminating events
                // TODO: is this necessary?
                case "win": case "tie":
                    accept();
                    // fallthrough
                // allowed events
                case "move": // TODO
                    break;
                default:
                    await consume(ctx);
            }
        });
}
