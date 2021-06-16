import { ParserContext } from "../../formats";
import { init } from "./init";
import { turnLoop } from "./turnLoop";

/** Main entry point for the gen4 parser. */
export async function main(ctx: ParserContext<"gen4">)
{
    await init(ctx);
    await turnLoop(ctx);
}
