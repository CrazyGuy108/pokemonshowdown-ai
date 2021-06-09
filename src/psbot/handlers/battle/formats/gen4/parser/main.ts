import { baseEventLoop } from "../../../../../../battle/parser/helpers";
import { Agent, Parser } from "../../FormatType";
import { dispatch } from "./base";

/** Main entry point for the gen4 parser. */
export const main: Parser<"gen4", Agent<"gen4">, [], void> =
    baseEventLoop(dispatch);
