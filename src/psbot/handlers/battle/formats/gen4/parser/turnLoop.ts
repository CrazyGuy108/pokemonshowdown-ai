import { consume } from "../../../../../../battle/parser";
import { verifyNext } from "../../../helpers";
import { ParserContext } from "../../formats";
import { parseMultipleSwitchIns } from "./switch";

/** Parses each turn of the battle until game over.  */
export async function turnLoop(ctx: ParserContext<"gen4">)
{
    // initial switch-ins happen on turn 1
    await parseTurn1(ctx);

    // actual turn loop
    let num = 1;
    while (await parseTurn(ctx, ++num));
}

/** Parses the first turn and its initial switch-ins. */
async function parseTurn1(ctx: ParserContext<"gen4">)
{
    await parseMultipleSwitchIns(ctx);
    await parseTurnEvent(ctx, /*num*/ 1);
}

/** Parses any other turn. Returns `true` on game over. */
async function parseTurn(ctx: ParserContext<"gen4">, num: number):
    Promise<boolean>
{
    // TODO
    await parseTurnEvent(ctx, num);
    return false;
}

async function parseTurnEvent(ctx: ParserContext<"gen4">, num: number)
{
    const event = await verifyNext(ctx, "|turn|");
    if (event.args[1] !== "1")
    {
        throw new Error(`Expected |turn|${num} event`);
    }
    await consume(ctx);
}
