/** @file Handles parsing for events related to moves. */
import { Protocol } from "@pkmn/protocol";
import { SideID } from "@pkmn/types";
import { toIdName } from "../../../../../helpers";
import { BattleParserContext, consume, tryVerify, unordered, verify } from
    "../../../parser";
import * as dex from "../dex";

/**
 * Creates an UnorderedDeadline parser for handling a move choice.
 * @param side Player id.
 * @param reject Optional callback if this never happens.
 */
export function moveAction(side: SideID, reject?: () => void)
{
    return unordered.createUnorderedDeadline(
        (ctx, accept) => parseMoveAction(ctx, side, accept), reject);
}

/**
 * Parses a move action by player choice. Includes effects that could happen
 * before the main `|move|` event.
 * @param side Player that should be making the move action.
 * @param accept Callback to accept this pathway.
 * @param intercept If this move choice is intercepting a switch, specifies the
 * Pokemon being interrupted.
 */
export async function parseMoveAction(ctx: BattleParserContext<"gen4">,
    side: SideID, accept: () => void, intercept?: SideID): Promise<void>
{
    // accept cb gets consumed if one of the optional pre-move effects accept
    // once it gets called the first time, subsequent uses of this value should
    //  be ignored since we'd now be committing to this pathway
    let innerAccept: (() => void) | undefined =
        function() { innerAccept = undefined; accept(); };

    // expect switch interception effect if specified
    let interceptMove: dex.Move | undefined;
    if (intercept)
    {
        interceptMove = await parseInterception(ctx, intercept, innerAccept);
    }

    // expect any pre-move effects, e.g. custapberry/quickclaw
    // TODO: can these still happen for intercepts?
    await parsePreMove(ctx, side, innerAccept);

    // expect the actual move
    return await parseMove(ctx, interceptMove, innerAccept);
}

/**
 * Parses an event that signals a move interruption.
 * @param intercept Pokemon reference whose switch action is being intercepted.
 * @param accept Callback to accept this pathway.
 * @returns The {@link dex.Move} that's being used, or null if the event wasn't
 * found.
 */
async function parseInterception(ctx: BattleParserContext<"gen4">,
    intercept: SideID, accept: () => void): Promise<dex.Move | undefined>
{
    const event = await tryVerify(ctx, "|-activate|");
    if (!event) return;

    const [_, identStr, effectStr] = event.args;
    if (!identStr) return;
    const ident = Protocol.parsePokemonIdent(identStr);
    if (ident.player !== intercept) return;
    const mon = ctx.state.getTeam(ident.player).active;

    const effect = Protocol.parseEffect(effectStr, toIdName);
    if (effect.type !== "move") return;
    const move = dex.getMove(effect.name);
    if (!move?.data.flags?.interceptSwitch) return;

    accept();
    mon.moveset.reveal(move.data.name);
    await consume(ctx);
    return move;
}

/**
 * Parses any pre-move effects, e.g. custapberry/quickclaw.
 * @param side Pokemon reference who is using the move.
 * @param accept Callback to accept this pathway.
 */
async function parsePreMove(ctx: BattleParserContext<"gen4">,
    side: SideID, accept?: () => void): Promise<void>
{
    // TODO
}

/**
 * Parses a single `|move|` event and its implications.
 * @param move Optional move to expect.
 * @param accept Optional callback to accept this pathway.
 */
export async function parseMove(ctx: BattleParserContext<"gen4">,
    move?: dex.Move, accept?: () => void): Promise<void>
{
    await verify(ctx, "|move|");
    // TODO
    await consume(ctx);
}
