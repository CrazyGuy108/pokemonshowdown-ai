/** @file Factored out code between `activateItem.ts` and `removeItem.ts`. */
// TODO: combine the two above mentioned files?
import * as dexutil from "../../dex/dex-util";
import { Pokemon } from "../../state/Pokemon";
import { Side } from "../../state/Side";
import { ParserState } from "../BattleParser";
import { SubInference, SubReason } from "./EventInference";

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
export function getItems(pstate: ParserState,
    monRefs: Partial<Readonly<Record<Side, any>>>,
    f: (data: dexutil.ItemData, mon: Pokemon) => Set<SubReason> | null):
    {[S in Side]?: Map<string, SubInference>}
{
    const result: {[S in Side]?: Map<string, SubInference>} = {};
    for (const monRef in monRefs)
    {
        if (!monRefs.hasOwnProperty(monRef)) continue;
        // can't activate item if suppressed by embargo status
        const mon = pstate.state.teams[monRef as Side].active;
        if (mon.volatile.embargo.isActive) continue;

        const inferences = new Map<string, SubInference>();
        for (const name of mon.item.possibleValues)
        {
            const cbResult = f(mon.item.map[name], mon);
            if (!cbResult) continue;
            cbResult.add(hasItem(mon, name));
            inferences.set(name, {reasons: cbResult});
        }

        if (inferences.size > 0) result[monRef as Side] = inferences;
    }
    return result;
}

/** Creates a SubReason that asserts that the pokemon has the given item. */
export function hasItem(mon: Pokemon, itemName: string): SubReason
{
    const {item} = mon; // snapshot in case item changes
    return {
        assert: () => item.narrow(itemName),
        reject: () => item.remove(itemName),
        delay(cb: (held: boolean) => void): () => void
        {
            // TODO: PossibilityClass should track this behavior
            // early return: already disproven
            if (!item.isSet(itemName))
            {
                cb(/*held*/ false);
                return () => {};
            }

            let cancel = false;
            // TODO: call then cb sooner
            item.then(n =>
            {
                if (cancel) return;
                cb(n === itemName);
            });
            // TODO: returned callback should actually cancel cb
            return () => cancel = true;
        }
    };
}

/**
 * Creates a SubReason that asserts that the pokemon's ability shouldn't come
 * from the given set of abilities. Assumes that ability-ignoring effects have
 * already been taken into account.
 */
export function cantHaveAbilities(mon: Pokemon,
    abilities: ReadonlySet<string>): SubReason
{
    const {traits} = mon; // snapshot in case traits change
    return {
        assert: () => traits.ability.remove(abilities),
        reject: () => traits.ability.narrow(abilities),
        delay(cb: (held: boolean) => void): () => void
        {
            let cancel = false;
            // TODO: call then cb sooner
            traits.ability.then(n =>
            {
                if (cancel) return;
                cb(!abilities.has(n));
            });
            // TODO: returned callback should actually cancel cb
            return () => cancel = true;
        }
    };
}