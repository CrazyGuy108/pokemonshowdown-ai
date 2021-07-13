/** @file Parsers and helper functions related to damaging events. */
import { Protocol } from "@pkmn/protocol";
import { SideID } from "@pkmn/types";
import { Event } from "../../../../../../parser";
import { BattleParserContext, tryVerify } from "../../../../parser";
import { ReadonlyPokemon } from "../../state/Pokemon";
import { dispatch } from "../base";

/**
 * Expects a percentDamage effect.
 * @param side Target pokemon reference.
 * @param percent Percent damage to deal to the target. Positive heals, negative
 * damages.
 * @param pred Optional additional custom check on the event before it can be
 * parsed. If it returns `false` then the event won't be parsed.
 * @returns `true` if the effect was parsed, `"silent"` if the effect is a
 * no-op, or `undefined` if the effect wasn't parsed.
 */
export async function percentDamage(ctx: BattleParserContext<"gen4">,
    side: SideID, percent: number,
    pred?: (event: Event<"|-damage|" | "|-heal|">) => boolean):
    Promise<true | "silent" | undefined>
{
    const mon = ctx.state.getTeam(side).active;
    // effect would do nothing
    if (isPercentDamageSilent(percent, mon.hp.current, mon.hp.max))
    {
        return "silent";
    }

    // parse event
    const event = await tryVerify(ctx, "|-damage|", "|-heal|");
    if (!event) return;
    if (!verifyPercentDamage(ctx, event, side, percent)) return;
    // TODO: also pass info that was parsed from the event?
    if (pred && !pred(event)) return;

    await dispatch(ctx);
    return true;
}

/**
 * Checks whether a percent-damage effect would be silent.
 * @param percent Percent damage.
 * @param hp Current hp.
 * @param hpMax Max hp.
 */
function isPercentDamageSilent(percent: number, hp: number, hpMax: number):
    boolean
{
    // can't heal when full or damage when fainted
    return (percent > 0 && hp >= hpMax) || (percent < 0 && hp <= 0);
}

/**
 * Verifies a percentDamage event.
 * @param event Event to verify.
 * @param side Pokemon reference that should receive the damage.
 * @param percent Percent damage to deal to the target. Positive heals, negative
 * damages.
 * @returns Whether the event matches the `percent` damage effect.
 */
function verifyPercentDamage(ctx: BattleParserContext<"gen4">,
    event: Event<"|-damage|" | "|-heal|">, side: SideID, percent: number):
    boolean
{
    const [, identStr, healthStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    if (ident.player !== side) return false;
    const health = Protocol.parseHealth(healthStr);
    if (!health) return false;
    const mon = ctx.state.getTeam(side).active;
    if (!checkPercentDamage(mon, percent, health.hp)) return false;
    return true;
}

/**
 * Verifies a percentDamage effect.
 * @param mon Target pokemon to receive the damage.
 * @param percent Percent damage to deal to the target. Positive heals, negative
 * damages.
 * @param newHp New hp number to check.
 * @returns `true` if `newHp` is valid for the given effect, `"silent"` if the
 * effect is a no-op, or `false` if the `newHp` number doesn't match the effect.
 */
function checkPercentDamage(mon: ReadonlyPokemon, percent: number,
    newHp: number): boolean
{
    // verify hp difference with respect to the sign of the percentage
    // could do actual percentage check with hp stat range, but not worth the
    //  effort due to all the corner cases that could come up and how few
    //  effects actually need to differentiate based on the percentage
    return (percent < 0 && newHp <= mon.hp.current) ||
        (percent > 0 && newHp >= mon.hp.current) ||
        // istanbul ignore next: should never happen, but can recover from it
        (percent === 0 && newHp === mon.hp.current);
}
