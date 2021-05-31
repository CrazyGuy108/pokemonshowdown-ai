import * as dex from "../dex/dex";
import { Side } from "../state/Side";
import { SubParserConfig, SubParserResult } from "../../../../../../battle/parser/BattleParser";
import { consume, tryPeek, verify } from "../../../../../../battle/parser/helpers";
import * as ability from "./activateAbility";
import { SuccessResult } from "./parsers";
import { useMove } from "./useMove";

/**
 * Expects a switch-in from a Pokemon slot while watching for pre-switch effects
 * like pursuit and naturalcure.
 */
export async function expectSwitch(cfg: SubParserConfig, monRef: Side):
    Promise<SuccessResult>
{
    const mon = cfg.state.teams[monRef].active;
    if (mon && !mon.fainted)
    {
        // possible pursuit move by opponent
        const event = await tryPeek(cfg);
        if (!event) return {permHalt: true};
        if (event.type === "useMove")
        {
            // TODO: should these be error logs instead?
            if (event.monRef === monRef)
            {
                throw new Error(`Pokemon '${monRef}' was expected to switch ` +
                    "out");
            }
            if (!dex.moves[event.move]?.flags?.interceptSwitch)
            {
                throw new Error(`Move '${event.move}' cannot be used to ` +
                    "intercept a switch-out");
            }
            // TODO: signal intercept
            await useMove(cfg);
        }

        // possible naturalcure by target
        await ability.onSwitchOut(cfg, {[monRef]: true});
    }

    // switch-in
    const next = await tryPeek(cfg);
    if (!next) return {permHalt: true};
    if (next.type !== "switchIn" || next.monRef !== monRef) return {};
    return {...await switchIn(cfg), success: true};
}

/** Handles events within the context of a switch-in. */
export async function switchIn(cfg: SubParserConfig): Promise<SubParserResult>
{
    // TODO: switch ctx, on-start abilities
    const event = await verify(cfg, "switchIn");
    cfg.state.teams[event.monRef].switchIn(event);
    await consume(cfg);
    return {};
}
