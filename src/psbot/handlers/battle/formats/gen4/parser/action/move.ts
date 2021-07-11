/** @file Handles parsing for events related to moves. */
import { Protocol } from "@pkmn/protocol";
import { SideID } from "@pkmn/types";
import { toIdName } from "../../../../../../helpers";
import { BattleParserContext, consume, tryVerify, unordered, verify } from
    "../../../../parser";
import * as dex from "../../dex";
import { ActionResult } from "./action";

/** Result of {@link moveAction} and {@link interceptSwitch}. */
export type MoveActionResult = ActionResult;

/**
 * Parses a possible move action by player choice. Includes effects that could
 * happen before the main `|move|` event.
 * @param side Player id.
 */
export async function moveAction(ctx: BattleParserContext<"gen4">,
    side: SideID, accept?: unordered.AcceptCallback):
    Promise<MoveActionResult>
{
    return await moveActionImpl(ctx, side, accept);
}

/**
 * Parses a possible move action that would interrupt a switch-in, e.g. pursuit.
 * @param intercepting Pokemon reference who is doing the interruption.
 * @param intercepted Pokemon reference who was trying to switch out.
 * @param accept Callback to accept this pathway. If omitted, then we are
 * already committed.
 */
export async function interceptSwitch(ctx: BattleParserContext<"gen4">,
    intercepting: SideID, intercepted: SideID,
    accept?: unordered.AcceptCallback): Promise<MoveActionResult>
{
    return await moveActionImpl(ctx, intercepting, accept, intercepted);
}

/**
 * Parses a move action by player choice. Includes effects that could happen
 * before the main `|move|` event.
 * @param side Player that should be making the move action.
 * @param accept Callback to accept this pathway.
 * @param intercept If this move choice is intercepting a switch, specifies the
 * Pokemon being interrupted.
 */
async function moveActionImpl(ctx: BattleParserContext<"gen4">,
    side: SideID, accept?: unordered.AcceptCallback, intercept?: SideID):
    Promise<MoveActionResult>
{
    const res: MoveActionResult = {};
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
    const preMoveRes = await preMove(ctx, side, accept, intercept);
    if (!preMoveRes)
    {
        if (accept) return res;
        // should never happen
        throw new Error("Expected pre-move effects but they didn't happen");
    }
    res.actioned = {[side]: true};
    if (preMoveRes !== "inactive")
    {
        // parse the actual move
        const move = preMoveRes === "move" ? undefined : preMoveRes;
        await useMove(ctx, side, move, accept);
    }
    return res;
}

/**
 * Parses any pre-move effects.
 * @param side Pokemon reference who is using the move.
 * @param accept Callback to accept this pathway.
 * @param intercept If this move choice is intercepting a switch, specifies the
 * Pokemon that would be interrupted.
 * @returns If a move is expected, either `"move"` or the specific
 * {@link dex.Move} that's being used. If the move action was canceled, returns
 * `"inactive"`. Otherwise undefined.
 */
async function preMove(ctx: BattleParserContext<"gen4">, side: SideID,
    accept?: unordered.AcceptCallback, intercept?: SideID):
    Promise<dex.Move | "move" | "inactive" | undefined>
{
    let res: dex.Move | "move" | "inactive" | undefined;
    accept &&= function preMoveAccept()
    {
        const a = accept!;
        accept = undefined;
        a();
    };

    // expect switch interception effect if we're allowed to
    if (intercept)
    {
        res = await interceptSwitchEvent(ctx, intercept, accept);
        if (!res)
        {
            if (accept) return;
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
    // TODO: confirm order?
    // flinching (if not intercepting)
    // recharging (if not intercepting?)
    // slp/par/frz
    // attract
    // confusion

    return res ?? "move";
}

/**
 * Parses an event that signals a switch interruption, e.g. pursuit.
 * @param intercept Pokemon reference whose switch action is being interrupted.
 * @param accept Callback to accept this pathway.
 * @returns The {@link dex.Move} that's being used, or undefined if the event
 * wasn't found.
 */
async function interceptSwitchEvent(ctx: BattleParserContext<"gen4">,
    intercept: SideID, accept?: unordered.AcceptCallback):
    Promise<dex.Move | undefined>
{
    const event = await tryVerify(ctx, "|-activate|");
    if (!event) return;
    const [, identStr, effectStr] = event.args;
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
export async function useMove(ctx: BattleParserContext<"gen4">, side?: SideID,
    move?: dex.Move | "recharge", accept?: unordered.AcceptCallback):
    Promise<void>
{
    const event = await verify(ctx, "|move|");
    const [, identStr, moveName] = event.args;
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
    await moveEffects(ctx, ident.player, move);
}

/** Parses effects from a move. */
async function moveEffects(ctx: BattleParserContext<"gen4">, side: SideID,
    move: dex.Move | "recharge"): Promise<void>
{
    const mon = ctx.state.getTeam(side).active;
    if (move === "recharge")
    {
        mon.volatile.mustRecharge = false;
        return;
    }

    // TODO
}
