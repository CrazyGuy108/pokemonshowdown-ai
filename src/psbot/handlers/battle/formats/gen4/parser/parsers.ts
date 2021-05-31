/** @file SubParsers used to expect specific kinds of events. */
import * as dexutil from "../dex/dex-util";
import { Pokemon, ReadonlyPokemon } from "../state/Pokemon";
import { Side } from "../state/Side";
import * as events from "../../../../../../battle/parser/BattleEvent";
import { SubParserConfig, SubParserResult } from "../../../../../../battle/parser/BattleParser";
import { eventLoop, hasStatus, matchBoost, matchPercentDamage, peek, tryPeek }
    from "../../../../../../battle/parser/helpers";
import { handlers as base } from "./base";
import { consumeOnUpdate } from "./removeItem";

/** Checks if items should activate. */
export async function update(cfg: SubParserConfig): Promise<SubParserResult>
{
    // TODO: also check abilities? in what order?
    const updateResult = await consumeOnUpdate(cfg, {us: true, them: true});
    return {...updateResult.permHalt && {permHalt: true}};
}

/** SubParserResult that includes a success indicator. */
export interface SuccessResult extends SubParserResult
{
    /** Whether the effect was successfully consumed. */
    success?: true;
}

/**
 * SuccessResult that includes a silent success indicator, meaning the effect
 * that was attempted to be consumed couldn't warrant an explicit game event.
 */
export interface SilentSuccessResult extends SubParserResult
{
    /**
     * Whether the effect was successfully consumed, or `"silent"` if it
     * consumed no events.
     */
    success?: true | "silent";
}

/** Result from `boost()`. */
export interface BoostResult extends SubParserResult
{
    /** Boosts that weren't consumed. */
    remaining: Partial<Record<dexutil.BoostName, number>>;
    /** Whether all consumed boosts were silently consumed. */
    allSilent?: true;
}

/**
 * Expects a boost effect.
 * @param targetRef Pokemon reference that's supposed to receive the boosts.
 * @param boosts Object describing the boosts.
 * @param set Whether to set (true) or add (false) the boosts.
 * @param silent Whether to silently consume saturated boosts (e.g. +1 when
 * already at +6).
 * @param lastEvent Last unconsumed event if any.
 */
export async function boost(cfg: SubParserConfig, targetRef: Side,
    boosts: Partial<dexutil.BoostTable<number>>, set?: boolean,
    silent?: boolean): Promise<BoostResult>
{
    const target = cfg.state.teams[targetRef].active;
    const table = {...boosts};
    let allSilent = true;

    const result = await eventLoop(cfg,
        async function expectBoostLoop(_cfg)
        {
            const event = await peek(_cfg);
            if (event.type !== "boost") return {};
            if (event.monRef !== targetRef) return {};
            if (!event.set === set) return {};
            if (!table.hasOwnProperty(event.stat)) return {};
            if (!matchBoost(!!set, table[event.stat]!, event.amount,
                ...set ? [] : [target.volatile.boosts[event.stat]]))
            {
                return {};
            }

            delete table[event.stat];
            allSilent = false;
            return await base.boost(_cfg);
        });

    // remove boosts that can't be fulfilled due to saturation
    //  (e.g. boosting when already at at +6)
    // TODO: should something similar to this be done for set as well?
    if (silent && !set)
    {
        for (const b in table)
        {
            if (!table.hasOwnProperty(b)) continue;
            if (matchBoost(!!set, table[b as dexutil.BoostName]!, 0,
                target.volatile.boosts[b as dexutil.BoostName]))
            {
                delete table[b as dexutil.BoostName];
            }
        }
    }

    return {...result, remaining: table, ...allSilent && {allSilent: true}};
}

/** Result from `boostOne()`. */
export interface BoostOneResult extends SubParserResult
{
    /** If successful, provides the stat that was boosted. */
    success?: dexutil.BoostName;
}

/**
 * Expects one of the given stats to be boosted.
 * @param targetRef Target pokemon reference.
 * @param possibleBoosts Table of possible boosts.
 */
export async function boostOne(cfg: SubParserConfig, targetRef: Side,
    possibleBoosts: Partial<dexutil.BoostTable<number>>):
    Promise<BoostOneResult>
{
    const next = await tryPeek(cfg);
    if (next?.type !== "boost" || next.monRef !== targetRef || next.set ||
        possibleBoosts[next.stat] !== next.amount)
    {
        return {}; // fail
    }

    return {...await base.boost(cfg), success: next.stat};
}

/**
 * Expects a countable status effect to be started or updated.
 * @param source Source Pokemon reference.
 * @param effectType Effect type being expected.
 */
export async function countStatus(cfg: SubParserConfig, source: Side,
    effectType: dexutil.CountableStatusType): Promise<SuccessResult>
{
    switch (effectType)
    {
        case "perish":
        {
            // consume perish song events for each target
            // TODO: a better solution would be to use the
            //  `|-fieldactivate|` event (#138) then let the
            //  countStatusEffect events (sent on PS only) pass through
            let success: boolean | undefined;
            const mentioned = new Set<Side>();
            const result = await eventLoop(cfg,
                async function countStatusLoop(_cfg)
                {
                    const event = await peek(_cfg);
                    if (event.type !== "countStatusEffect") return {};
                    if (event.effect !== effectType) return {};
                    // if the pokemon was mentioned again, then we're getting
                    //  into end-of-turn events
                    if (mentioned.has(event.monRef)) return {};
                    mentioned.add(event.monRef);
                    success ||= true;
                    return await base.countStatusEffect(_cfg);
                });
            return {...result, ...success && {success}};
        }
        case "stockpile":
        {
            const next = await tryPeek(cfg);
            if (next?.type !== "countStatusEffect") return {};
            if (next.monRef !== source) return {};
            if (next.effect !== effectType) return {};
            return {...await base.countStatusEffect(cfg), success: true};
        }
    }
}

/**
 * Expects a damage event.
 * @param monRef Pokemon to be damaged.
 * @param from Effect being referenced.
 * @param sign Sign of expected damage number.
 */
export async function damage(cfg: SubParserConfig, monRef: Side,
    from: events.TakeDamage["from"] | null, sign: number):
    Promise<SilentSuccessResult>
{
    // saturated hp can't be damaged/healed further
    const mon = cfg.state.teams[monRef].active;
    if (mon.hp.current <= 0 && sign < 0 ||
        mon.hp.current >= mon.hp.max && sign > 0)
    {
        return {success: "silent"};
    }

    const next = await tryPeek(cfg);
    if (next?.type !== "takeDamage") return {};
    if (next.monRef !== monRef) return {};
    if ((next.from ?? null) !== (from ?? null)) return {};
    // make sure damage matches sign
    const diff = next.hp - mon.hp.current;
    if (diff && Math.sign(diff) !== sign) return {};
    return {...await base.takeDamage(cfg), success: true};
}

/** Result from `faint()`. */
export interface FaintResult extends SubParserResult
{
    /** Whether the effect was successfully consumed. */
    success?: true;
}

/** Expects a faint event for the given pokemon reference. */
export async function faint(cfg: SubParserConfig, monRef: Side):
    Promise<FaintResult>
{
    const next = await tryPeek(cfg);
    if (next?.type !== "faint") return {};
    if (next.monRef !== monRef) return {};
    return {...await base.faint(cfg), success: true};
}

/**
 * Expects a field effect to be started.
 * @param source Pokemon that originated the effect.
 * @param effectType Effect type being expected.
 * @param toggle Whether the effect can be toggled.
 */
export async function fieldEffect(cfg: SubParserConfig, source: Pokemon | null,
    effectType: dexutil.FieldEffectType, toggle?: boolean):
    Promise<SuccessResult>
{
    // TODO: silently pass without event if effect already present
    const next = await tryPeek(cfg);
    if (next?.type !== "activateFieldEffect") return {};
    if (!next.start && !toggle) return {};
    if (next.effect !== effectType) return {};
    return {...await base.activateFieldEffect(cfg, source), success: true};
}

/**
 * Expects a percentDamage effect.
 * @param targetRef Target pokemon reference.
 * @param percent Percent damage to deal to the target. Positive heals, negative
 * damages.
 */
export async function percentDamage(cfg: SubParserConfig, targetRef: Side,
    percent: number): Promise<SilentSuccessResult>
{
    const target = cfg.state.teams[targetRef].active;
    // effect would do nothing
    if (matchPercentDamage(percent, target.hp.current, target.hp.max))
    {
        return {success: "silent"};
    }

    const next = await tryPeek(cfg);
    if (next?.type !== "takeDamage") return {};
    if (next.monRef !== targetRef) return {};
    if (next.from) return {};

    async function good(): Promise<SilentSuccessResult>
    {
        return {...await base.takeDamage(cfg), success: true};
    }

    if (percent < 0 && next.hp <= target.hp.current) return await good();
    if (percent > 0 && next.hp >= target.hp.current) return await good();
    // istanbul ignore next: should never happen, but can recover
    if (percent === 0 && next.hp === target.hp.current) return await good();
    return {};
}

/** Result from `status()`. */
export interface StatusResult extends SubParserResult
{
    /** Status type that was consumed, or `true` if silently consumed. */
    success?: true | dexutil.StatusType;
}

/**
 * Expects a status effect.
 * @param targetRef Target pokemon reference.
 * @param statusTypes Possible statuses to afflict.
 */
export async function status(cfg: SubParserConfig, targetRef: Side,
    statusTypes: readonly dexutil.StatusType[]): Promise<StatusResult>
{
    return await statusImpl(cfg, targetRef, statusTypes, /*consume*/ true);
}

/**
 * Expects a status effect event but doesn't consume it. This is used when
 * further verifications/assertions need to happen before the status event can
 * be accepted.
 * @param targetRef Target pokemon reference.
 * @param statusTypes Possible statuses to afflict.
 */
export async function peekStatus(cfg: SubParserConfig, targetRef: Side,
    statusTypes: readonly dexutil.StatusType[]): Promise<StatusResult>
{
    return await statusImpl(cfg, targetRef, statusTypes, /*consume*/ false);
}

/**
 * Implementation of `status()`/`peekStatus()`.
 * @param targetRef Target pokemon reference.
 * @param statusTypes Possible statuses to afflict.
 * @param consume Whether to handle/consume the event after verification within
 * this call.
 */
async function statusImpl(cfg: SubParserConfig, targetRef: Side,
    statusTypes: readonly dexutil.StatusType[], consume: boolean):
    Promise<StatusResult>
{
    const target = cfg.state.teams[targetRef].active;
    // effect would do nothing
    if (statusTypes.every(s => cantStatus(target, s))) return {success: true};

    const next = await tryPeek(cfg);
    switch (next?.type)
    {
        case "activateStatusEffect":
            if (!next.start) break;
            if (next.monRef !== targetRef) break;
            if (!statusTypes.includes(next.effect)) break;
            return {
                ...consume && await base.activateStatusEffect(cfg),
                success: next.effect
            };
        case "clause":
            // ps-specific clause mod is blocking an effect
            if (!statusTypes.includes(next.clause)) break;
            return {...consume && await base.clause(cfg), success: next.clause};
    }
    return {};
}

/** Checks whether the pokemon can't be afflicted by the given status. */
function cantStatus(mon: ReadonlyPokemon, statusType: dexutil.StatusType):
    boolean
{
    switch (statusType)
    {
        case "aquaRing": case "attract": case "curse": case "flashFire":
        case "focusEnergy": case "imprison": case "ingrain":
        case "leechSeed": case "mudSport": case "nightmare":
        case "powerTrick": case "substitute": case "suppressAbility":
        case "torment": case "waterSport":
        case "destinyBond": case "grudge": case "rage": // singlemove
        case "magicCoat": case "roost": case "snatch": // singleturn
            return mon.volatile[statusType];
        case "bide": case "confusion": case "charge": case "magnetRise":
        case "embargo": case "healBlock": case "slowStart": case "taunt":
        case "uproar": case "yawn":
            return mon.volatile[statusType].isActive;
        case "encore":
            return mon.volatile[statusType].ts.isActive;
        case "endure": case "protect": // stall
            return mon.volatile.stalling;
        case "foresight": case "miracleEye":
            return mon.volatile.identified === statusType;
        default:
            if (dexutil.isMajorStatus(statusType))
            {
                return !!mon.majorStatus.current;
            }
            // istanbul ignore next: should never happen
            throw new Error(`Invalid status effect '${statusType}'`);
    }
}

/** Result from `cure()`. */
export interface CureResult extends SubParserResult
{
    /**
     * Whether the call was successful. `true` if fully consumed, `"silent"` if
     * no statuses to cure, or `Set<StatusType>` if some statuses were not
     * cured.
     */
    ret: true | "silent" | Set<dexutil.StatusType>;
}

/**
 * Expects some statuses to be cured.
 * @param targetRef Target pokemon reference.
 * @param statuses Statuses to cure.
 */
export async function cure(cfg: SubParserConfig, targetRef: Side,
    statuses: readonly dexutil.StatusType[]): Promise<CureResult>
{
    // only need to care about the curable statuses the target has
    const target = cfg.state.teams[targetRef].active;
    statuses = statuses.filter(s => hasStatus(target, s));

    // no statuses to cure
    if (statuses.length <= 0) return {ret: "silent"};

    // look for cure events
    const pendingCures = new Set(statuses);
    while (pendingCures.size > 0)
    {
        const next = await tryPeek(cfg);
        if (next?.type !== "activateStatusEffect" || next.start ||
            next.monRef !== targetRef ||
            !pendingCures.has(next.effect))
        {
            return {ret: pendingCures}; // fail/partial
        }
        pendingCures.delete(next.effect);
        await base.activateStatusEffect(cfg);
    }
    return {ret: true}; // success
}

/**
 * Expects a swap-boost effect.
 * @param source Source Pokemon reference.
 * @param target Target Pokemon reference.
 * @param boosts Boosts to swap.
 */
export async function swapBoosts(cfg: SubParserConfig, source: Side,
    target: Side, boosts: Partial<dexutil.BoostTable<boolean>>):
    Promise<SuccessResult>
{
    // can't swap with self
    if (source === target) return {};

    // expect swapBoosts event
    const next = await tryPeek(cfg);
    if (next?.type !== "swapBoosts") return {};
    if (((next.monRef1 !== source || next.monRef2 !== target) &&
        (next.monRef1 !== target || next.monRef2 !== source)))
    {
        return {};
    }

    // make sure boosts match up
    const table = {...boosts};
    for (const b of next.stats)
    {
        // reject if too many stats
        if (!table.hasOwnProperty(b)) return {};
        delete table[b];
    }
    // reject if not enough stats
    if (Object.keys(table).length > 0) return {};

    return {...await base.swapBoosts(cfg), success: true};
}

/**
 * Expects a team effect to be started.
 * @param source Pokemon that originated the effect.
 * @param teamRef Target team reference.
 * @param effectType Effect type being expected.
 */
export async function teamEffect(cfg: SubParserConfig, source: Pokemon | null,
    teamRef: Side, effectType: dexutil.TeamEffectType):
    Promise<SuccessResult>
{
    // TODO: silently pass without event if effect already present
    const next = await tryPeek(cfg);
    if (next?.type !== "activateTeamEffect") return {};
    if (!next.start) return {};
    if (next.teamRef !== teamRef) return {};
    if (next.effect !== effectType) return {};
    return {...await base.activateTeamEffect(cfg, source), success: true};
}
