import { BattleParserContext, consume, verify } from "../../../parser";
import { parsePlayerActions } from "./action";
import { consumeIgnoredEvents } from "./base";
import { parseMultipleSwitchIns } from "./switch";

/** Parses each turn of the battle until game over.  */
export async function turnLoop(ctx: BattleParserContext<"gen4">)
{
    // initial switch-ins happen on turn 1
    await parseTurn1(ctx);

    // actual turn loop
    let num = 1;
    while (!await parseTurn(ctx, ++num));
}

/** Parses the first turn and its initial switch-ins. */
async function parseTurn1(ctx: BattleParserContext<"gen4">)
{
    await parseMultipleSwitchIns(ctx);
    await parseTurnEvent(ctx, /*num*/ 1);
}

/** Parses a full turn. Returns `true` on game over. */
async function parseTurn(ctx: BattleParserContext<"gen4">, num: number):
    Promise<boolean>
{
    // TODO: game-over detection
    await consumeIgnoredEvents(ctx);
    await parsePlayerActions(ctx);

    await consumeIgnoredEvents(ctx);
    // TODO: end of turn effects

    await parseTurnEvent(ctx, num);
    return false;
}

async function parseTurnEvent(ctx: BattleParserContext<"gen4">, num: number)
{
    const event = await verify(ctx, "|turn|");
    if (event.args[1] !== "1")
    {
        throw new Error(`Expected |turn|${num} event`);
    }
    await consume(ctx);
}
