/** @file Factored out code between `activateItem.ts` and `removeItem.ts`. */
// TODO: combine the two above mentioned files?
import * as dex from "../dex/dex";
import { Pokemon } from "../state/Pokemon";
import { Side } from "../state/Side";
import { SubParserConfig } from "../../../../../../battle/parser/BattleParser";
import { SubInference, SubReason } from "./EventInference";
import { hasItem } from "./helpers";

/**
 * Filters out item possibilities that don't match the given predicate.
 * @param monRefs Eligible item holders.
 * @param f Callback for filtering eligible items. Should return a set of
 * reasons that prove the item should activate, or null if it definitely
 * shouldn't.
 * @returns An object mapping the given `monRefs` keys to Maps of item
 * possibility name to a SubInference modeling the restrictions on each item
 * possibility.
 */
export function getItems(cfg: SubParserConfig,
    monRefs: Partial<Readonly<Record<Side, any>>>,
    f: (item: dex.Item, mon: Pokemon) => Set<SubReason> | null):
    {[S in Side]?: Map<string, SubInference>}
{
    const result: {[S in Side]?: Map<string, SubInference>} = {};
    for (const monRef in monRefs)
    {
        if (!monRefs.hasOwnProperty(monRef)) continue;
        // can't activate item if suppressed by embargo status
        const mon = cfg.state.teams[monRef as Side].active;
        if (mon.volatile.embargo.isActive) continue;

        const inferences = new Map<string, SubInference>();
        for (const name of mon.item.possibleValues)
        {
            const cbResult = f(dex.getItem(mon.item.map[name]), mon);
            if (!cbResult) continue;
            cbResult.add(hasItem(mon, new Set([name])));
            inferences.set(name, {reasons: cbResult});
        }

        if (inferences.size > 0) result[monRef as Side] = inferences;
    }
    return result;
}
