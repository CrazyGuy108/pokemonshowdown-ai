import { baseEventLoop } from "../../../../../../battle/parser";
import { ParserContext } from "../../formats";
import { dispatch } from "./base";
import { init } from "./init";

const turnLoop = baseEventLoop(dispatch);

/** Main entry point for the gen4 parser. */
export async function main(ctx: ParserContext<"gen4">)
{
    // initial events
    await init(ctx);
    // TODO: turn1 switch-ins, turn loop
    await turnLoop(ctx);
}
