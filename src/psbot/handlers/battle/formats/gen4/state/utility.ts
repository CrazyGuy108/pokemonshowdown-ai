/** @file Helper functions for BattleState classes. */

/**
 * Pluralizes the word "turns". For example, `pluralTurns(1)` returns `"1 turn"`
 * and `pluralTurns(3)` returns `"3 turns"`. When a turn limit is provided, the
 * turns are expressed as a fraction. Fractions always pluralize the
 * denominator instead of the numerator in order to mean "one out of three
 * turns", e.g. `pluralTurns(1, 3)` returns `"1/3 turns"`.
 * @param turns Number of turns.
 * @param limit Max number of turns. Omit or pass `null` to not have a fraction.
 */
export function pluralTurns(turns: number, limit?: number | null): string;
/**
 * Pluralizes the word "turns". For example, `pluralTurns("tox", 1)` returns
 * `"tox for 1 turn"`.
 * @param name Name of status.
 * @param turns Number of turns.
 * @param limit Max number of turns. Omit or pass `null` to not have a fraction.
 */
export function pluralTurns(name: string, turns: number, limit?: number | null):
    string;
// istanbul ignore next: only used in logging
export function pluralTurns(name: string | number, turns?: number | null,
    limit?: number | null): string
{
    let prefix = "";
    if (typeof name === "string") prefix = `${name} for `;
    else
    {
        // name is omitted, shift args to match first overload
        limit = turns;
        turns = name;
    }

    if (limit)
    {
        // add numerator
        prefix += turns + "/";
        // "turns" will bind to the denominator now
        turns = limit;
    }

    return `${prefix}${turns} turn${turns !== 1 ? "s" : ""}`;
}

// istanbul ignore next: only used in logging
/**
 * Converts a number to a string where positive numbers are preceded by a
 * `+` symbol.
 */
export function plus(n: number): string
{
    return (n > 0 ? "+" : "") + n;
}
