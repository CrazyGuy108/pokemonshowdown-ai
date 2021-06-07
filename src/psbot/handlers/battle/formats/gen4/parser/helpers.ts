import * as dex from "../dex/dex";
import * as dexutil from "../dex/dex-util";
import { Pokemon } from "../state/Pokemon";
import { SubReason } from "./EventInference";

// TODO: make these SubReasons into classes?

/**
 * SubReason value that asserts that the inference is dependent on random
 * factors outside what can be deduced.
 */
export const chanceReason: SubReason =
    // TODO: what should delay() do?
    {assert() {}, reject() {}, delay() { return () => {}; }};

/**
 * Creates a SubReason that asserts that the move being used by the given
 * pokemon is of one of the specified type(s).
 * @param move Move to track.
 * @param user Move user to track.
 * @param types Set of possible move types. Will be owned by this function.
 * @param negative Whether to flip the assertion.
 */
export function moveIsType(move: dex.Move, user: Pokemon,
    types: Set<dexutil.Type>, negative?: boolean): SubReason
{
    const {hpType, item} = user; // snapshot in case user changes
    return {
        assert: () => move.assertTypes(types, {hpType, item}, negative),
        reject: () => move.assertTypes(types, {hpType, item}, !negative),
        delay: cb => move.onUpdateTypes(types, {hpType, item},
            negative ? held => cb(!held) : cb)
    };
}

/**
 * Creates a SubReason that asserts that the holder isn't the same type as the
 * move being used against it.
 */
export function diffMoveType(mon: Pokemon, hitBy: dexutil.MoveAndUser):
    SubReason
{
    return moveIsType(hitBy.move, hitBy.user, new Set(mon.types),
        /*negative*/ true);
}

/** Creates a SubReason that asserts that the pokemon has the given ability. */
export function hasAbility(mon: Pokemon, abilities: Set<string>,
    negative?: boolean): SubReason
{
    const {ability} = mon.traits; // snapshot in case traits changes
    return {
        // TODO: guard against overnarrowing? need a better framework for error
        //  handling/logging
        assert: () => negative ? ability.remove(abilities)
            : ability.narrow(abilities),
        reject: () => negative ? ability.narrow(abilities)
            : ability.remove(abilities),
        delay: cb => ability.onUpdate(abilities,
            negative ? kept => cb(!kept) : cb)
    };
}

/** Klutz check wrapped in a bounds check. */
export function cantHaveKlutz(mon: Pokemon): Set<SubReason> | null
{
    const klutz = checkKlutz(mon);
    if (klutz.size <= 0) return new Set();
    if (klutz.size >= mon.traits.ability.size) return null;
    return new Set([hasAbility(mon, klutz, /*negative*/ true)]);
}

/**
 * Checks for item-ignoring abilities.
 * @returns A Set of possible item-ignoring abilities (empty if none are
 * possible).
 */
export function checkKlutz(mon: Pokemon): Set<string>
{
    if (mon.volatile.suppressAbility) return new Set();

    const {ability} = mon.traits;
    const abilities = new Set<string>();
    for (const n of ability.possibleValues)
    {
        if (ability.map[n].flags?.ignoreItem) abilities.add(n);
    }
    return abilities;
}

/**
 * Creates a SubReason that asserts that the pokemon has the given item.
 * @param mon Potential item holder.
 * @param items Item names to track.
 * @param negative Whether to flip the assertion.
 */
export function hasItem(mon: Pokemon, items: Set<string>, negative?: boolean):
    SubReason
{
    const {item} = mon; // snapshot in case item changes
    return {
        assert: () => negative ? item.remove(items) : item.narrow(items),
        reject: () => negative ? item.narrow(items) : item.remove(items),
        delay: cb => item.onUpdate(items, negative ? kept => cb(!kept) : cb)
    };
}

/** Creates a SubReason that asserts that the opponent has a held item. */
export function opponentHasItem(opp: Pokemon): SubReason
{
    return hasItem(opp, new Set(["none"]), /*negative*/ true);
}

/**
 * Checks if a Pokemon has been reduced to 1 hp.
 * @returns A Set of assertions if it's possible to be at 1hp, or null if
 * it's not possible.
 */
export function isAt1HP(mon: Pokemon): Set<SubReason> | null
{
    const hpDisplay = mon.hp.current;

    // 0 hp
    if (hpDisplay <= 0) return null;
    // known hp
    if (!mon.hp.isPercent) return hpDisplay === 1 ? new Set() : null;

    // unknown %hp
    // look through each possible maxhp stat number to see if it's definite or
    //  possible that we're at 1 hp
    // TODO: what about pixel-based displays rather than percent?
    // note: pixel-accurate equation is pixels = floor(hp/maxhp * 48), with
    //  an additional check to force pixels=1 if hp>1 but the pixels round
    //  down to 0
    let result: Set<SubReason> | null = null;
    let guaranteed = true;
    const {max: maxhpHi, min: maxhpLo} = mon.traits.stats.hp;
    for (let i = maxhpLo; i <= maxhpHi; ++i)
    {
        // note: according to PS, percentage = ceil(hp/maxhp * 100), with an
        //  additional check to force percentage=99 if hp < maxhp but the
        //  percentage rounds up to 100
        // this value is the hpDisplay we should get at 1hp
        const minPercent = Math.ceil(100 / i);

        // verify that this hp stat is possible
        // TODO: use this to narrow/assert hp stat
        if (hpDisplay < minPercent) continue;

        // under 200 max hp, minPercent is guaranteed to map to 1hp only due to
        //  ceiling op
        // otherwise, multiple hp values could be represented by hpDisplay=1%
        if (i >= 200) guaranteed = false;

        // verify that the hp display is as expected for 1hp
        if (hpDisplay === minPercent) result ??= new Set();
        // if we really are at 1hp, then this hp stat is impossible
        else guaranteed = false;
    }

    // TODO: replace chanceReason with hp stat assertions
    if (result && !guaranteed) result.add(chanceReason);
    return result;
}
