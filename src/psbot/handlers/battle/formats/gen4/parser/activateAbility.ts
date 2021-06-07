import { Protocol } from "@pkmn/protocol";
import { consume, eventLoop, peek } from
    "../../../../../../battle/parser/helpers";
import { verifyNext } from "../../../helpers";
import { ParserContext } from "../../FormatType";
import * as dex from "../dex";
import { Pokemon, ReadonlyPokemon } from "../state/Pokemon";
import { Side } from "../state/Side";
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
export async function onSwitchOut(ctx: ParserContext<"gen4">,
    eligible: Partial<Readonly<Record<Side, true>>>):
    Promise<ExpectAbilitiesResult>
{
    const pendingAbilities = getAbilities(ctx, eligible,
        (ability, mon) => ability.canSwitchOut(mon));

    return await expectAbilities(ctx, "switchOut", pendingAbilities,
        /*hitBy*/ undefined);
}

/**
 * Expects an on-`start` ability to activate.
 * @param eligible Eligible pokemon.
 */
export async function onStart(ctx: ParserContext<"gen4">,
    eligible: Partial<Readonly<Record<Side, true>>>):
    Promise<ExpectAbilitiesResult>
{
    const pendingAbilities = getAbilities(ctx, eligible,
        (ability, mon) => ability.canStart(mon));

    return await expectAbilities(ctx, "start", pendingAbilities,
        /*hitBy*/ undefined);
}

// TODO: allow for other non-move effects (e.g. abilities/items)
/**
 * Expects an on-`block` ability to activate on a certain blockable effect.
 * @param eligible Eligible pokemon.
 * @param userRef Pokemon reference using the `hitByMove`.
 * @param hitByMove Move by which the eligible pokemon are being hit.
 */
export async function onBlock(ctx: ParserContext<"gen4">,
    eligible: Partial<Readonly<Record<Side, true>>>, hitBy: dex.MoveAndUserRef):
    Promise<ExpectAbilitiesResult>
{
    // if move user ignores the target's abilities, then this function can't be
    //  called
    const user = ctx.state.teams[hitBy.userRef].active;
    if (ignoresTargetAbility(user)) return {results: []};

    const moveTypes = hitBy.move.getPossibleTypes(user);
    // only the main status effects can be visibly blocked by an ability
    const status = hitBy.move.getMainStatusEffects("hit", user.types);

    const pendingAbilities = getAbilities(ctx, eligible,
        // block move's main status effect
        ability => ability.canBlockStatusEffect(status,
                ctx.state.status.weather.type) ??
            // block move based on its type
            ability.canBlockMoveType(moveTypes, hitBy.move, user) ??
            // block move based on damp, etc
            ability.canBlockEffect(hitBy.move.data.flags?.explosive));

    return await expectAbilities(ctx, "block", pendingAbilities, hitBy);
}

// TODO: refactor hitByMove to support other unboost sources, e.g. intimidate
/**
 * Expects an on-`tryUnboost` ability to activate on a certain unboost effect.
 * @param eligible Eligible pokemon.
 * @param userRef Pokemon reference using the `hitByMove`.
 * @param hitByMove Move by which the eligible pokemon are being hit.
 */
export async function onTryUnboost(ctx: ParserContext<"gen4">,
    eligible: Partial<Readonly<Record<Side, true>>>, hitBy: dex.MoveAndUserRef):
    Promise<ExpectAbilitiesResult>
{
    // if move user ignores the target's abilities, then this function can't be
    //  called
    const user = ctx.state.teams[hitBy.userRef].active;
    if (ignoresTargetAbility(user)) return {results: []};

    const boostEffect = hitBy.move.getBoostEffects("hit", user.types);
    let {boosts} = boostEffect;
    if (boostEffect.set) boosts = {};

    const pendingAbilities = getAbilities(ctx, eligible,
        ability => ability.canBlockUnboost(boosts));

    return await expectAbilities(ctx, "tryUnboost", pendingAbilities, hitBy);
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
export async function onStatus(ctx: ParserContext<"gen4">,
    eligible: Partial<Readonly<Record<Side, true>>>, statusType: dex.StatusType,
    hitBy?: dex.MoveAndUserRef): Promise<ExpectAbilitiesResult>
{
    const pendingAbilities = getAbilities(ctx, eligible,
        (ability, mon) => ability.canStatus(mon, statusType));

    return await expectAbilities(ctx, "status", pendingAbilities, hitBy);
}

/**
 * Expects an on-`moveDamage` ability (or variants of this condition) to
 * activate.
 * @param eligible Eligible pokemon.
 * @param qualifier The qualifier of which effects the ability may activate.
 * @param userRef Pokemon reference using the `hitByMove`.
 * @param hitByMove Move by which the eligible pokemon are being hit.
 */
export async function onMoveDamage(ctx: ParserContext<"gen4">,
    eligible: Partial<Readonly<Record<Side, true>>>,
    qualifier: "damage" | "contact" | "contactKO", hitBy: dex.MoveAndUserRef):
    Promise<ExpectAbilitiesResult>
{
    let on: dex.AbilityOn;
    switch (qualifier)
    {
        case "damage": on = "moveDamage"; break;
        case "contact": on = "moveContact"; break;
        case "contactKO": on = "moveContactKO"; break;
    }

    const user = ctx.state.teams[hitBy.userRef].active;
    const hitByArg: dex.MoveAndUser = {move: hitBy.move, user};
    const pendingAbilities = getAbilities(ctx, eligible,
        (ability, mon) => ability.canMoveDamage(mon, on, hitByArg));

    return await expectAbilities(ctx, on, pendingAbilities, hitBy);
}

/**
 * Expects an on-`moveDrain` ability to activate.
 * @param eligible Eligible pokemon.
 * @param hitByMove Move by which the eligible pokemon are being hit.
 */
export async function onMoveDrain(ctx: ParserContext<"gen4">,
    eligible: Partial<Readonly<Record<Side, true>>>, hitBy: dex.MoveAndUserRef):
    Promise<ExpectAbilitiesResult>
{
    const pendingAbilities = getAbilities(ctx, eligible,
        ability => ability.canMoveDrain());

    return await expectAbilities(ctx, "moveDrain", pendingAbilities, hitBy);
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
function getAbilities(ctx: ParserContext<"gen4">,
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
        const mon = ctx.state.teams[monRef as Side].active;
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
async function expectAbilities(ctx: ParserContext<"gen4">, on: dex.AbilityOn,
    pendingAbilities:
        {readonly [S in Side]?: ReadonlyMap<string, SubInference>},
    hitBy?: dex.MoveAndUserRef): Promise<ExpectAbilitiesResult>
{
    const inferences: EventInference<AbilityResult>[] = [];
    for (const monRef in pendingAbilities)
    {
        if (!pendingAbilities.hasOwnProperty(monRef)) continue;
        const abilities = pendingAbilities[monRef as Side]!;
        inferences.push(createEventInference(new Set(abilities.values()),
            async function expectAbilitiesTaker(_ctx, accept)
            {
                const event = await peek(_ctx);
                if (event.type !== "activateAbility") return {};
                if (event.monRef !== monRef) return {};

                // match pending ability possibilities with current item event
                const inf = abilities.get(event.ability);
                if (!inf) return {};

                // indicate accepted event
                accept(inf);
                return await activateAbility(ctx, on, hitBy);
            }));
    }
    return await expectEvents(ctx, inferences);
}

/** Context for handling ability activation. */
interface AbilityContext
{
    /** Parser state. */
    readonly ctx: ParserContext<"gen4">;
    /** Ability holder. */
    readonly holder: Pokemon;
    /** Ability holder Pokemon reference. */
    readonly holderRef: Side;
    /** Ability data. */
    readonly ability: dex.Ability;
    /** Circumstances in which the ability is activating. */
    readonly on: dex.AbilityOn | null;
    /** Move+user-ref that the ability holder was hit by, if applicable. */
    readonly hitBy?: dex.MoveAndUserRef;
}

// TODO: make this generic based on activateAbility()'s 'on' argument
/** Result from handling an ActivateAbility event. */
export interface AbilityResult
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
    blockStatus?: {readonly [T in dex.StatusType]?: true};

    // on-tryUnboost
    /** Unboost effects being blocked for the ability holder. */
    blockUnboost?: {readonly [T in dex.BoostName]?: true};

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
export async function activateAbility(ctx: ParserContext<"gen4">,
    on: dex.AbilityOn | null = null, hitBy?: dex.MoveAndUserRef):
    Promise<AbilityResult>
{
    const initialEvent = await verifyNext(ctx, "activateAbility");

    const ability = dex.getAbility(initialEvent.ability);
    if (!ability) throw new Error(`Unknown ability '${initialEvent.ability}'`);

    const actx: AbilityContext =
    {
        ctx, holder: ctx.state.teams[initialEvent.monRef].active,
        holderRef: initialEvent.monRef, ability, on, ...hitBy && {hitBy}
    };

    // infer ability being activated
    actx.holder.setAbility(actx.ability.data.name);

    // handle supported ability effects
    const baseResult = await dispatchEffects(actx);

    // handle other ability effects (TODO: support)
    await eventLoop(ctx, async function abilityLoop(_ctx)
    {
        const event = await peek(_ctx);
        switch (event.args[0])
        {
            case "-weather":
            {
                if (dex.isWeatherType(event.args[1]) &&
                    weatherAbilities[event.args[1] as dex.WeatherType] ===
                        actx.ability.data.name)
                {
                    // fill in infinite duration (gen3-4) and source
                    await base.activateFieldEffect(_ctx, actx.holder,
                        /*weatherInfinite*/ true);
                }
                break;
            }
        }
    });
    return {...baseResult};
}

/**
 * Dispatches the effects of an ability. Assumes that the initial
 * activateAbility event hasn't been consumed or fully verified yet.
 * @param ctx Ability SubParser context.
 */
async function dispatchEffects(actx: AbilityContext): Promise<AbilityResult>
{
    switch (actx.on)
    {
        case "switchOut":
            return await actx.ability.onSwitchOut(actx.ctx, actx.holderRef);
        case "start":
            return await actx.ability.onStart(actx.ctx, actx.holderRef);
        case "block":
            return await actx.ability.onBlock(actx.ctx, actx.holderRef,
                actx.hitBy);
        case "tryUnboost":
            return await actx.ability.onTryUnboost(actx.ctx, actx.holderRef);
        case "status":
            return await actx.ability.onStatus(actx.ctx, actx.holderRef);
        case "moveContactKO": case "moveContact": case "moveDamage":
            return await actx.ability.onMoveDamage(actx.ctx, actx.on,
                actx.holderRef, actx.hitBy);
        case "moveDrain":
            return await actx.ability.onMoveDrain(actx.ctx, actx.holderRef,
                actx.hitBy?.userRef);
        default:
            // TODO: throw once parsers can fully track ability activation
            await consume(actx.ctx);
            return {};
    }
}

// TODO: track weather in AbilityData

// TODO: move to dex ability effects
/** Maps weather type to the ability that can cause it. */
const weatherAbilities: {readonly [T in dex.WeatherType]: string} =
{
    Hail: "snowwarning", RainDance: "drizzle", Sandstorm: "sandstream",
    SunnyDay: "drought"
};
