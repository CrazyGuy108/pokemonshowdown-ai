/**
 * Checks whether `x` is a subset of `y` or whether they're independent.
 * @param x First set.
 * @param y Second set.
 * @param negative Whether to flip the boolean result.
 * @returns `true` if `y` is a subset of `x`, or `false` if `x` and `y` are
 * independent, otherwise `null`.
 */
function subsetOrIndependent(x: Set<string>, y: Iterable<string>,
    negative: boolean): boolean | null
{
    if (x.size <= 0) return false;
    let subset = true;
    let independent = true;
    for (const z of y)
    {
        if (x.has(z)) independent = false;
        else subset = false;
    }
    if (subset) return !negative;
    if (independent) return negative;
    return null;
}
