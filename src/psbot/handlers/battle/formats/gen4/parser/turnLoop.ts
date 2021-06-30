import { BattleParserContext, consume, verify } from "../../../parser";
import { parsePlayerActions } from "./action";
import { parseMultipleSwitchIns } from "./switch";

/** Parses each turn of the battle until game over.  */
export async function turnLoop(ctx: BattleParserContext<"gen4">)
{
    // initial switch-ins happen on turn 1
    await parseTurn1(ctx);

    // actual turn loop
    let num = 1;
    while (await parseTurn(ctx, ++num));
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
    // alternate switch/move expects for each side
        // only one switch/move though, so do nested unordered deadline

    await parsePlayerActions(ctx);

    // NOTE: need early return whenever game-over is detected
    // should ignore/skip done events and other unnecessary stuff
    // (done)
    // 2 move/switch (including pre-effects)
        // all effects/implications, including self-switch
        // TODO: need all events that can happen first
    // (done)
    // end of turn effects
    // upkeep
    // optional switch-in:
        // (done)
        // switch (including pre-effects)
        // more optional switch-ins
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
