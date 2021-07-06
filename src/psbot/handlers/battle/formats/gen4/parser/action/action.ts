/** @file Handles parsing a player's main action. */
import { Protocol } from "@pkmn/protocol";
import { SideID } from "@pkmn/types";
import { BattleParserContext, consume, eventLoop, peek, unordered } from
    "../../../../parser";
import { isAllowedKey } from "../base";
import { moveAction, MoveActionResult } from "./move";
import { switchAction, SwitchActionResult } from "./switch";

/** Required base result type for action parsers. */
export interface ActionResult
{
    /** Specifies the pokemon that took an action this turn. */
    actioned?: PlayerActionsState;
}

/** Specifies the pokemon that took an action this turn. */
type PlayerActionsState = {[S in SideID]?: true};

/** Parses each player's main actions for this turn. */
export async function playerActions(ctx: BattleParserContext<"gen4">)
{
    // shared state used to track whether each pokemon has spent their action
    //  for this turn
    const actioned: PlayerActionsState = {};

    const switchResults = await unordered.all(ctx,
        (Object.entries(ctx.state.teams) as [SideID, any][])
            .map(([side]) => playerSwitchAction(side, actioned)),
        filter);
    Object.assign(actioned, switchResults.map(res => res.actioned));

    const moveResults = await unordered.all(ctx,
        (Object.entries(ctx.state.teams) as [SideID, any][])
            .filter(([side]) => !actioned[side])
            .map(([side]) => playerMoveAction(side, actioned)),
        filter);
    Object.assign(actioned, moveResults.map(res => res.actioned));

    for (const side in actioned)
    {
        if (!actioned.hasOwnProperty(side)) continue;
        // TODO: throw/aggregate multiple errors?
        // TODO: don't throw if game-over
        throw new Error(`Expected ${side} player action`);
    }
}

const playerSwitchAction = (side: SideID, actioned: PlayerActionsState) =>
    unordered.createUnorderedDeadline(playerSwitchActionImpl,
        /*rejected*/ undefined, side, actioned);

async function playerSwitchActionImpl(ctx: BattleParserContext<"gen4">,
    accept: unordered.AcceptCallback, side: SideID,
    actioned: PlayerActionsState): Promise<SwitchActionResult>
{
    if (actioned[side])
    {
        accept();
        return {};
    }
    return await switchAction(ctx, side, accept);
}

const playerMoveAction = (side: SideID, actioned: PlayerActionsState) =>
    unordered.createUnorderedDeadline(playerMoveActionImpl,
        /*rejected*/ undefined, side, actioned);

async function playerMoveActionImpl(ctx: BattleParserContext<"gen4">,
    accept: unordered.AcceptCallback, side: SideID,
    actioned: PlayerActionsState): Promise<MoveActionResult>
{
    if (actioned[side])
    {
        accept();
        return {};
    }
    return await moveAction(ctx, side, accept);
}

/** Consumes ignored events until the end of player actions. */
async function filter(ctx: BattleParserContext<"gen4">,
    accept: unordered.AcceptCallback)
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
                default:
                    if (isAllowedKey(Protocol.key(event.args))) break;
                    await consume(ctx);
            }
        });
}
