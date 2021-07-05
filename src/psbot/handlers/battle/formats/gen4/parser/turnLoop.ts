import { BattleParserContext, consume, verify } from "../../../parser";
import { playerActions } from "./action/action";
import { multipleSwitchIns } from "./action/switch";
import { ignoredEvents } from "./base";

/** Parses each turn of the battle until game over.  */
export async function turnLoop(ctx: BattleParserContext<"gen4">): Promise<void>
{
    // initial switch-ins happen on turn 1
    await turn1(ctx);

    // actual turn loop
    let num = 1;
    while (!await turn(ctx, ++num));
}

/** Parses the first turn and its initial switch-ins. */
async function turn1(ctx: BattleParserContext<"gen4">): Promise<void>
{
    await multipleSwitchIns(ctx);
    await turnEvent(ctx, /*num*/ 1);
}

/** Parses a full turn. Returns `true` on game over. */
async function turn(ctx: BattleParserContext<"gen4">, num: number):
    Promise<boolean>
{
    // TODO: game-over detection

    await ignoredEvents(ctx);
    await preTurn(ctx);

    await ignoredEvents(ctx);
    await playerActions(ctx);

    await ignoredEvents(ctx);
    await residual(ctx);

    await turnEvent(ctx, num);
    await postTurn(ctx);
    return false;
}

/** Handles pre-turn effects before any actions are taken. */
async function preTurn(ctx: BattleParserContext<"gen4">): Promise<void>
{
    ctx.state.preTurn();
    // TODO: quickclaw, others?
}

/** Handles residual effects at the end of the turn. */
async function residual(ctx: BattleParserContext<"gen4">): Promise<void>
{
    // TODO: residual effects
}

/** Parses `|turn|` event to end the current turn. */
async function turnEvent(ctx: BattleParserContext<"gen4">, num: number):
    Promise<void>
{
    const event = await verify(ctx, "|turn|");
    if (event.args[1] !== "1")
    {
        throw new Error(`Expected |turn|${num} event`);
    }

    await consume(ctx);
}

/** Handles post-turn effects. */
async function postTurn(ctx: BattleParserContext<"gen4">): Promise<void>
{
    ctx.state.postTurn();
    // TODO: halt choice
}
