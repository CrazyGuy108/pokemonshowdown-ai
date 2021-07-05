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
    side: SideID, accept?: () => void, intercept?: SideID): Promise<void>
{
    // accept cb gets consumed if one of the optional pre-move effects accept
    // once it gets called the first time, subsequent uses of this value should
    //  be ignored since we'd now be committing to this pathway
    accept &&= function moveActionAccept()
    {
        const a = accept!;
        accept = undefined;
        a();
    };

    // expect any pre-move effects, e.g. pursuit or custapberry
    const preMoveRes = await parsePreMove(ctx, side, accept);
    if (preMoveRes === "inactive") return;

    // expect the actual move
    await parseMove(ctx, side, preMoveRes, accept);
}

/**
 * Parses any pre-move effects.
 * @param side Pokemon reference who is using the move.
 * @param accept Callback to accept this pathway.
 * @param intercept If this move choice is intercepting a switch, specifies the
 * Pokemon that would be interrupted.
 * @returns Either, the {@link dex.Move} that's being used if it was revealed
 * before the initial `|move|` event, `"inactive"` if the move action was
 * canceled, or otherwise undefined.
 */
async function parsePreMove(ctx: BattleParserContext<"gen4">, side: SideID,
    accept?: () => void, intercept?: SideID):
    Promise<dex.Move | "inactive" | undefined>
{
    accept &&= function preMoveAccept()
    {
        const a = accept!;
        accept = undefined;
        a();
    };

    // expect switch interception effect if we're allowed to
    let move: dex.Move | undefined;
    if (intercept)
    {
        const committed = !accept;
        move = await parseIntercept(ctx, intercept, accept);
        if (!move && committed)
        {
            throw new Error("Expected event to interrupt switch-in for " +
                intercept);
        }
    }
    else
    {
        // custapberry can only activate if we're not intercepting a switch
        // TODO
    }

    // TODO: pre-move inactivity checks
    // TODO: confirm order
    // slp/par/frz
    // attract
    // confusion

    return move;
}

/**
 * Parses an event that signals a switch interruption, e.g. pursuit.
 * @param intercept Pokemon reference whose switch action is being interrupted.
 * @param accept Callback to accept this pathway.
 * @returns The {@link dex.Move} that's being used, or undefined if the event
 * wasn't found.
 */
async function parseIntercept(ctx: BattleParserContext<"gen4">,
    intercept: SideID, accept?: () => void): Promise<dex.Move | undefined>
{
    const event = await tryVerify(ctx, "|-activate|");
    if (!event) return;
    const [_, identStr, effectStr] = event.args;
    if (!identStr) return;
    const ident = Protocol.parsePokemonIdent(identStr);
    if (ident.player !== intercept) return;
    const effect = Protocol.parseEffect(effectStr, toIdName);
    if (effect.type !== "move") return;

    const move = dex.getMove(effect.name);
    if (!move?.data.flags?.interceptSwitch) return;

    accept?.();
    const mon = ctx.state.getTeam(ident.player).active;
    mon.moveset.reveal(move.data.name);
    await consume(ctx);
    return move;
}

/**
 * Parses a single `|move|` event and its implications.
 * @param side Pokemon reference that should be using the move.
 * @param move Optional move to expect.
 * @param accept Optional callback to accept this pathway.
 */
export async function parseMove(ctx: BattleParserContext<"gen4">, side?: SideID,
    move?: dex.Move | "recharge", accept?: () => void): Promise<void>
{
    const event = await verify(ctx, "|move|");
    const [_, identStr, moveName] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    const moveId = toIdName(moveName);

    if (side && side !== ident.player)
    {
        if (accept) return;
        throw new Error(`Expected move for ${side} but got ${ident.player}`);
    }

    const cmp = move === "recharge" ? move : move?.data.name;
    if (cmp && cmp !== moveId)
    {
        if (accept) return;
        throw new Error(`Expected move '${cmp}' but got '${moveId}'`);
    }

    // fill in missing move arg
    if (!move)
    {
        if (moveId === "recharge") move = "recharge";
        else
        {
            const m = dex.getMove(moveId);
            if (!m)
            {
                if (accept) return;
                throw new Error(`Unknown move '${moveId}'`);
            }
            move = m;
        }
    }

    accept?.();
    await consume(ctx);
    await parseMoveEffects(ctx, ident.player, move);
}

/** Parses effects from a move. */
async function parseMoveEffects(ctx: BattleParserContext<"gen4">,
    side: SideID, move: dex.Move | "recharge"): Promise<void>
{

    // TODO
}
