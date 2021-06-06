import * as dex from "../dex";
import type { Pokemon, ReadonlyPokemon } from "../state/Pokemon";
import type { Side } from "../state/Side";
import type { SubParserConfig, SubParserResult } from "../../../../../../battle/parser/BattleParser";
import { consume, eventLoop, peek, verify } from "../../../../../../battle/parser/helpers";
import { handlers as base } from "./base";
import { createEventInference, EventInference, expectEvents, ExpectEventsResult,
    SubInference, SubReason } from "./EventInference";
import { hasAbility } from "./helpers";

/** Result from `expectAbilities()` and variants like `onStart()`. */
export type ExpectAbilitiesResult = ExpectEventsResult<AbilityResult>;

/**
 * Expects an on-`switchOut` ability to activate.
 * @param eligible Eligible pokemon.
 */
export async function onSwitchOut(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>):
    Promise<ExpectAbilitiesResult>
{
    const pendingAbilities = getAbilities(cfg, eligible,
        (ability, mon) => ability.canSwitchOut(mon));

    return await expectAbilities(cfg, "switchOut", pendingAbilities,
        /*hitBy*/ undefined);
}

/**
 * Expects an on-`start` ability to activate.
 * @param eligible Eligible pokemon.
 */
export async function onStart(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>):
    Promise<ExpectAbilitiesResult>
{
    const pendingAbilities = getAbilities(cfg, eligible,
        (ability, mon) => ability.canStart(mon));

    return await expectAbilities(cfg, "start", pendingAbilities,
        /*hitBy*/ undefined);
}

// TODO: allow for other non-move effects (e.g. abilities/items)
/**
 * Expects an on-`block` ability to activate on a certain blockable effect.
 * @param eligible Eligible pokemon.
 * @param userRef Pokemon reference using the `hitByMove`.
 * @param hitByMove Move by which the eligible pokemon are being hit.
 */
export async function onBlock(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>,
    hitBy: dexutil.MoveAndUserRef): Promise<ExpectAbilitiesResult>
{
    // if move user ignores the target's abilities, then this function can't be
    //  called
    const user = cfg.state.teams[hitBy.userRef].active;
    if (ignoresTargetAbility(user)) return {results: []};

    const moveTypes = hitBy.move.getPossibleTypes(user);
    // only the main status effects can be visibly blocked by an ability
    const status = hitBy.move.getMainStatusEffects("hit", user.types);

    const pendingAbilities = getAbilities(cfg, eligible,
        // block move's main status effect
        ability => ability.canBlockStatusEffect(status,
                cfg.state.status.weather.type) ??
            // block move based on its type
            ability.canBlockMoveType(moveTypes, hitBy.move, user) ??
            // block move based on damp, etc
            ability.canBlockEffect(hitBy.move.data.flags?.explosive));

    return await expectAbilities(cfg, "block", pendingAbilities, hitBy);
}

// TODO: refactor hitByMove to support other unboost sources, e.g. intimidate
/**
 * Expects an on-`tryUnboost` ability to activate on a certain unboost effect.
 * @param eligible Eligible pokemon.
 * @param userRef Pokemon reference using the `hitByMove`.
 * @param hitByMove Move by which the eligible pokemon are being hit.
 */
export async function onTryUnboost(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>,
    hitBy: dexutil.MoveAndUserRef): Promise<ExpectAbilitiesResult>
{
    // if move user ignores the target's abilities, then this function can't be
    //  called
    const user = cfg.state.teams[hitBy.userRef].active;
    if (ignoresTargetAbility(user)) return {results: []};

    const boostEffect = hitBy.move.getBoostEffects("hit", user.types);
    let {boosts} = boostEffect;
    if (boostEffect.set) boosts = {};

    const pendingAbilities = getAbilities(cfg, eligible,
        ability => ability.canBlockUnboost(boosts));

    return await expectAbilities(cfg, "tryUnboost", pendingAbilities, hitBy);
}

/** Checks if a pokemon's ability definitely ignores the target's abilities. */
function ignoresTargetAbility(mon: ReadonlyPokemon): boolean
{
    if (!mon.volatile.suppressAbility)
    {
        const userAbility = mon.traits.ability;
        if ([...userAbility.possibleValues]
            .every(n => userAbility.map[n].flags?.ignoreTargetAbility))
        {
            return true;
        }
    }
    return false;
}

/**
 * Expects an on-`status` ability to activate after afflicting a status
 * condition.
 * @param eligible Eligible pokemon with the status.
 * @param statusType Status that was afflicted.
 * @param hitByMove Move by which the eligible pokemon are being hit.
 */
export async function onStatus(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>,
    statusType: dexutil.StatusType, hitBy?: dexutil.MoveAndUserRef):
    Promise<ExpectAbilitiesResult>
{
    const pendingAbilities = getAbilities(cfg, eligible,
        (ability, mon) => ability.canStatus(mon, statusType));

    return await expectAbilities(cfg, "status", pendingAbilities, hitBy);
}

/**
 * Expects an on-`moveDamage` ability (or variants of this condition) to
 * activate.
 * @param eligible Eligible pokemon.
 * @param qualifier The qualifier of which effects the ability may activate.
 * @param userRef Pokemon reference using the `hitByMove`.
 * @param hitByMove Move by which the eligible pokemon are being hit.
 */
export async function onMoveDamage(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>,
    qualifier: "damage" | "contact" | "contactKO",
    hitBy: dexutil.MoveAndUserRef): Promise<ExpectAbilitiesResult>
{
    let on: dexutil.AbilityOn;
    switch (qualifier)
    {
        case "damage": on = "moveDamage"; break;
        case "contact": on = "moveContact"; break;
        case "contactKO": on = "moveContactKO"; break;
    }

    const user = cfg.state.teams[hitBy.userRef].active;
    const hitByArg: dexutil.MoveAndUser = {move: hitBy.move, user};
    const pendingAbilities = getAbilities(cfg, eligible,
        (ability, mon) => ability.canMoveDamage(mon, on, hitByArg));

    return await expectAbilities(cfg, on, pendingAbilities, hitBy);
}

/**
 * Expects an on-`moveDrain` ability to activate.
 * @param eligible Eligible pokemon.
 * @param hitByMove Move by which the eligible pokemon are being hit.
 */
export async function onMoveDrain(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>,
    hitBy: dexutil.MoveAndUserRef): Promise<ExpectAbilitiesResult>
{
    const pendingAbilities = getAbilities(cfg, eligible,
        ability => ability.canMoveDrain());

    return await expectAbilities(cfg, "moveDrain", pendingAbilities, hitBy);
}

/**
 * Filters out ability possibilities that don't match the given predicate.
 * @param monRefs Eligible ability holders.
 * @param f Callback for filtering eligible abilities. Should return a set of
 * reasons that prove the ability should activate, or null if it definitely
 * shouldn't.
 * @returns An object mapping the given `monRefs` keys to Maps of ability
 * possibility name to a SubInference modeling the restrictions on each ability
 * possibility.
 */
function getAbilities(cfg: SubParserConfig,
    monRefs: {readonly [S in Side]?: any},
    f: (ability: dex.Ability, mon: Pokemon, monRef: Side) =>
        Set<SubReason> | null):
    {[S in Side]?: Map<string, SubInference>}
{
    const result: {[S in Side]?: Map<string, SubInference>} = {};
    for (const monRef in monRefs)
    {
        if (!monRefs.hasOwnProperty(monRef)) continue;
        // can't activate ability if suppressed
        const mon = cfg.state.teams[monRef as Side].active;
        if (mon.volatile.suppressAbility) continue;

        // put the callback through each possible ability
        const inferences = new Map<string, SubInference>();
        for (const name of mon.traits.ability.possibleValues)
        {
            const cbResult = f(dex.getAbility(mon.traits.ability.map[name]),
                    mon, monRef as Side);
            if (!cbResult) continue;
            cbResult.add(hasAbility(mon, new Set([name])));
            inferences.set(name, {reasons: cbResult});
        }
        if (inferences.size > 0) result[monRef as Side] = inferences;
    }
    return result;
}

/**
 * Expects an ability activation.
 * @param on Context in which the ability would activate.
 * @param pendingAbilities Eligible ability possibilities.
 * @param hitByMove Move that the eligible ability holders were hit by, if
 * applicable.
 */
async function expectAbilities(cfg: SubParserConfig, on: dexutil.AbilityOn,
    pendingAbilities:
        {readonly [S in Side]?: ReadonlyMap<string, SubInference>},
    hitBy?: dexutil.MoveAndUserRef): Promise<ExpectAbilitiesResult>
{
    const inferences: EventInference<AbilityResult>[] = [];
    for (const monRef in pendingAbilities)
    {
        if (!pendingAbilities.hasOwnProperty(monRef)) continue;
        const abilities = pendingAbilities[monRef as Side]!;
        inferences.push(createEventInference(new Set(abilities.values()),
            async function expectAbilitiesTaker(_cfg, accept)
            {
                const event = await peek(_cfg);
                if (event.type !== "activateAbility") return {};
                if (event.monRef !== monRef) return {};

                // match pending ability possibilities with current item event
                const inf = abilities.get(event.ability);
                if (!inf) return {};

                // indicate accepted event
                accept(inf);
                return await activateAbility(cfg, on, hitBy);
            }));
    }
    return await expectEvents(cfg, inferences);
}

/** Context for handling ability activation. */
interface AbilityContext
{
    /** Parser state. */
    readonly cfg: SubParserConfig;
    /** Ability holder. */
    readonly holder: Pokemon;
    /** Ability holder Pokemon reference. */
    readonly holderRef: Side;
    /** Ability data. */
    readonly ability: dex.Ability;
    /** Circumstances in which the ability is activating. */
    readonly on: dexutil.AbilityOn | null;
    /** Move+user-ref that the ability holder was hit by, if applicable. */
    readonly hitBy?: dexutil.MoveAndUserRef;
}

// TODO: make this generic based on activateAbility()'s 'on' argument
/** Result from handling an ActivateAbility event. */
export interface AbilityResult extends SubParserResult
{
    // on-block
    /**
     * Whether the ability is the source of an immunity to the move on
     * `block`.
     */
    immune?: true;
    /** Whether the ability caused the move to fail on `block`. */
    failed?: true;
    /** Status effects being blocked for the ability holder. */
    blockStatus?: {readonly [T in dexutil.StatusType]?: true};

    // on-tryUnboost
    /** Unboost effects being blocked for the ability holder. */
    blockUnboost?: {readonly [T in dexutil.BoostName]?: true};

    // on-moveDrain
    /** Whether an invertDrain ability is activating on `damage`. */
    invertDrain?: true;
}

// TODO: refactor MoveAndUserRef to be a generic effect source obj for handling
//  other effect sources e.g. intimidate
/**
 * Handles events within the context of an ability activation. Returns the last
 * event that it didn't handle.
 * @param on Context in which the ability is activating.
 * @param hitBy Move+user that the ability holder was hit by, if applicable.
 */
export async function activateAbility(cfg: SubParserConfig,
    on: dexutil.AbilityOn | null = null, hitBy?: dexutil.MoveAndUserRef):
    Promise<AbilityResult>
{
    const initialEvent = await verify(cfg, "activateAbility");

    const ability = dex.getAbility(initialEvent.ability);
    if (!ability) throw new Error(`Unknown ability '${initialEvent.ability}'`);

    const ctx: AbilityContext =
    {
        cfg, holder: cfg.state.teams[initialEvent.monRef].active,
        holderRef: initialEvent.monRef, ability, on, ...hitBy && {hitBy}
    };

    // infer ability being activated
    ctx.holder.setAbility(ctx.ability.data.name);

    // handle supported ability effects
    const baseResult = await dispatchEffects(ctx);

    // handle other ability effects (TODO: support)
    const result = await eventLoop(cfg, async function abilityLoop(_cfg)
    {
        const event = await peek(_cfg);
        switch (event.type)
        {
            case "activateFieldEffect": // weather ability
                if (event.start && dexutil.isWeatherType(event.effect) &&
                    weatherAbilities[event.effect] === ctx.ability.data.name)
                {
                    // fill in infinite duration (gen3-4) and source
                    return await base.activateFieldEffect(_cfg, ctx.holder,
                        /*weatherInfinite*/ true);
                }
                break;
        }
        return {};
    });
    return {...baseResult, ...result};
}

/**
 * Dispatches the effects of an ability. Assumes that the initial
 * activateAbility event hasn't been consumed or fully verified yet.
 * @param ctx Ability SubParser context.
 */
async function dispatchEffects(ctx: AbilityContext): Promise<AbilityResult>
{
    switch (ctx.on)
    {
        case "switchOut":
            return await ctx.ability.onSwitchOut(ctx.cfg, ctx.holderRef);
        case "start":
            return await ctx.ability.onStart(ctx.cfg, ctx.holderRef);
        case "block":
            return await ctx.ability.onBlock(ctx.cfg, ctx.holderRef,
                ctx.hitBy);
        case "tryUnboost":
            return await ctx.ability.onTryUnboost(ctx.cfg, ctx.holderRef);
        case "status":
            return await ctx.ability.onStatus(ctx.cfg, ctx.holderRef);
        case "moveContactKO": case "moveContact": case "moveDamage":
            return await ctx.ability.onMoveDamage(ctx.cfg, ctx.on,
                ctx.holderRef, ctx.hitBy);
        case "moveDrain":
            return await ctx.ability.onMoveDrain(ctx.cfg, ctx.holderRef,
                ctx.hitBy?.userRef);
        default:
            // TODO: throw once parsers can fully track ability activation
            await consume(ctx.cfg);
            return {};
    }
}

// TODO: track weather in AbilityData

// TODO: move to dex ability effects
/** Maps weather type to the ability that can cause it. */
const weatherAbilities: {readonly [T in dexutil.WeatherType]: string} =
{
    Hail: "snowwarning", RainDance: "drizzle", Sandstorm: "sandstream",
    SunnyDay: "drought"
};
