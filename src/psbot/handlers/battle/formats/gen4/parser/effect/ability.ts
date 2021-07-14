/** @file Parsers related to ability activations. */
import { Protocol } from "@pkmn/protocol";
import { SideID } from "@pkmn/types";
import { toIdName } from "../../../../../../helpers";
import { Event } from "../../../../../../parser";
import { BattleAgent } from "../../../../agent";
import { BattleParserContext, consume, inference, unordered, verify } from
    "../../../../parser";
import * as dex from "../../dex";
import { AbilityBlockResult } from "../../dex/wrappers/Ability";
import { Pokemon, ReadonlyPokemon } from "../../state/Pokemon";
import { hasAbility } from "../reason/ability";

/** UnorderedDeadline type for ability onX() functions. */
type AbilityParser<TResult = dex.Ability> =
    unordered.UnorderedDeadline<"gen4", BattleAgent<"gen4">, TResult>;

// TODO: refactor/move to separate helper files?
/**
 * Creates an EventInference parser that expects an on-`switchOut` ability to
 * activate if possible.
 * @param side Pokemon reference who could have such an ability.
 */
export function onSwitchOut(ctx: BattleParserContext<"gen4">, side: SideID)
{
    const mon = ctx.state.getTeam(side).active;
    const abilities = getAbilities(mon, ability => ability.canSwitchOut(mon))
    return new inference.EventInference(new Set(abilities.values()),
        onSwitchOutImpl, side, abilities);
}

async function onSwitchOutImpl(ctx: BattleParserContext<"gen4">,
    accept: inference.AcceptCallback, side: SideID,
    abilities: Map<dex.Ability, inference.SubInference>)
{
    const parsers: AbilityParser[] = [];
    for (const ability of abilities.keys())
    {
        parsers.push(unordered.createUnorderedDeadline(onSwitchOutUnordered,
                /*reject*/ undefined, ability, side));
    }

    const [ok, acceptedAbility] = await unordered.oneOf(ctx, parsers);
    if (ok) accept(abilities.get(acceptedAbility!)!);
}

async function onSwitchOutUnordered(ctx: BattleParserContext<"gen4">,
    accept: unordered.AcceptCallback, ability: dex.Ability, side: SideID):
    Promise<dex.Ability>
{
    await ability.onSwitchOut(ctx, accept, side);
    return ability;
}

/**
 * Creates an EventInference parser that expects an on-`start` ability to
 * activate if possible.
 * @param side Pokemon reference who could have such an ability.
 */
export function onStart(ctx: BattleParserContext<"gen4">, side: SideID)
{
    const mon = ctx.state.getTeam(side).active;
    const abilities = getAbilities(mon, ability => ability.canStart(mon))
    return new inference.EventInference(new Set(abilities.values()),
        onStartImpl, side, abilities);
}

async function onStartImpl(ctx: BattleParserContext<"gen4">,
    accept: inference.AcceptCallback, side: SideID,
    abilities: Map<dex.Ability, inference.SubInference>): Promise<void>
{
    const parsers: AbilityParser[] = [];
    let trace: dex.Ability | undefined;
    for (const ability of abilities.keys())
    {
        if (ability.data.on?.start?.copyFoeAbility) // trace ability
        {
            // NOTE(gen4): traced ability is shown before trace ability itself
            // parse the possibly-traced ability first before seeing if it was
            //  traced
            // this handles ambiguous cases where a traced ability may be one of
            //  the holder's possible abilities that could activate on-start
            trace = ability;
            continue;
        }
        parsers.push(unordered.createUnorderedDeadline(onStartUnordered,
                /*reject*/ undefined, ability, side));
    }

    const [ok, acceptedAbility] = await unordered.oneOf(ctx, parsers);
    if (!ok) return;

    if (trace)
    {
        const traced = await trace.copyFoeAbility(ctx, side);
        if (traced)
        {
            ctx.state.getTeam(traced.side).active.setAbility(traced.ability);
            accept(abilities.get(trace)!);
            return;
        }
    }

    accept(abilities.get(acceptedAbility!)!);
}

async function onStartUnordered(ctx: BattleParserContext<"gen4">,
    accept: unordered.AcceptCallback, ability: dex.Ability, side: SideID):
    Promise<dex.Ability>
{
    await ability.onStart(ctx, accept, side);
    return ability;
}

/**
 * Creates an EventInference parser that expects an on-`block` ability to
 * activate if possible.
 * @param side Pokemon reference who could have such an ability.
 * @param hitBy Move+user ref that the holder is being hit by.
 */
export function onBlock(ctx: BattleParserContext<"gen4">, side: SideID,
    hitBy: dex.MoveAndUserRef)
{
    // if move user ignores the target's abilities, then this function can't be
    //  called
    // note: these types of abilities are always(?) made known when they're in
    //  effect
    // TODO: add a SubReason for this as a consistency check?
    const hitByUser = ctx.state.getTeam(hitBy.userRef).active;
    if (ignoresTargetAbility(hitByUser)) return null;

    const moveTypes = hitBy.move.getPossibleTypes(hitByUser);
    // only the main status effects can be visibly blocked by an ability
    const status = hitBy.move.getMainStatusEffects("hit", hitByUser.types);

    const mon = ctx.state.getTeam(side).active;
    const abilities = getAbilities(mon,
        // block move's main status effect
        ability => ability.canBlockStatusEffect(status,
                ctx.state.status.weather.type) ??
            // block move based on its type
            ability.canBlockMoveType(moveTypes, hitBy.move, hitByUser) ??
            // block move based on damp, etc
            ability.canBlockEffect(hitBy.move.data.flags?.explosive));
    return new inference.EventInference(new Set(abilities.values()),
        onBlockImpl, side, abilities, hitBy);
}

async function onBlockImpl(ctx: BattleParserContext<"gen4">,
    accept: inference.AcceptCallback, side: SideID,
    abilities: Map<dex.Ability, inference.SubInference>,
    hitBy: dex.MoveAndUserRef): Promise<AbilityBlockResult | undefined>
{
    const parsers: AbilityParser<[dex.Ability, AbilityBlockResult]>[] = [];
    for (const ability of abilities.keys())
    {
        parsers.push(unordered.createUnorderedDeadline(onBlockUnordered,
                /*reject*/ undefined, ability, side, hitBy));
    }

    const oneOfRes = await unordered.oneOf(ctx, parsers);
    if (oneOfRes[0])
    {
        const [acceptedAbility, blockResult] = oneOfRes[1];
        accept(abilities.get(acceptedAbility!)!);
        return blockResult;
    }
}

async function onBlockUnordered(ctx: BattleParserContext<"gen4">,
    accept: unordered.AcceptCallback, ability: dex.Ability, side: SideID,
    hitBy: dex.MoveAndUserRef): Promise<[dex.Ability, AbilityBlockResult]>
{
    return [ability, await ability.onBlock(ctx, accept, side, hitBy)];
}

// TODO: refactor hitBy to include other unboost effect sources, e.g. intimidate
/**
 * Creates an EventInference parser that expects an on-`tryUnboost` ability to
 * activate if possible.
 * @param side Pokemon reference who could have such an ability.
 * @param hitBy Move+user ref that the holder is being hit by.
 */
export function onTryUnboost(ctx: BattleParserContext<"gen4">, side: SideID,
    hitBy: dex.MoveAndUserRef)
{
    // if move user ignores the target's abilities, then this function can't be
    //  called
    // note: these types of abilities are always(?) made known when they're in
    //  effect
    // TODO: add a SubReason for this as a consistency check?
    const hitByUser = ctx.state.getTeam(hitBy.userRef).active;
    if (ignoresTargetAbility(hitByUser)) return null;

    const boostEffect = hitBy.move.getBoostEffects("hit", hitByUser.types);
    let {boosts} = boostEffect;
    if (boostEffect.set) boosts = {};

    const mon = ctx.state.getTeam(side).active;
    const abilities = getAbilities(mon,
        ability => ability.canBlockUnboost(boosts));
    return new inference.EventInference(new Set(abilities.values()),
        onTryUnboostImpl, side, abilities);
}

async function onTryUnboostImpl(ctx: BattleParserContext<"gen4">,
    accept: inference.AcceptCallback, side: SideID,
    abilities: Map<dex.Ability, inference.SubInference>):
    Promise<Partial<dex.BoostTable<true>> | undefined>
{
    const parsers:
        AbilityParser<[dex.Ability, Partial<dex.BoostTable<true>>]>[] = [];
    for (const ability of abilities.keys())
    {
        parsers.push(unordered.createUnorderedDeadline(onTryUnboostUnordered,
                /*reject*/ undefined, ability, side));
    }

    const oneOfRes = await unordered.oneOf(ctx, parsers);
    if (oneOfRes[0])
    {
        const [acceptedAbility, blockResult] = oneOfRes[1];
        accept(abilities.get(acceptedAbility!)!);
        return blockResult;
    }
}

async function onTryUnboostUnordered(ctx: BattleParserContext<"gen4">,
    accept: unordered.AcceptCallback, ability: dex.Ability, side: SideID):
    Promise<[dex.Ability, Partial<dex.BoostTable<true>>]>
{
    return [ability, await ability.onTryUnboost(ctx, accept, side)];
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
 * Creates an EventInference parser that expects an on-`status` ability to
 * activate if possible.
 * @param side Pokemon reference who could have such an ability.
 */
export function onStatus(ctx: BattleParserContext<"gen4">, side: SideID,
    statusType: dex.StatusType)
{
    const mon = ctx.state.getTeam(side).active;
    const abilities = getAbilities(mon,
        ability => ability.canStatus(mon, statusType));
    return new inference.EventInference(new Set(abilities.values()),
        onStatusImpl, side, abilities);
}

async function onStatusImpl(ctx: BattleParserContext<"gen4">,
    accept: inference.AcceptCallback, side: SideID,
    abilities: Map<dex.Ability, inference.SubInference>):
    Promise<void>
{
    const parsers: AbilityParser[] = [];
    for (const ability of abilities.keys())
    {
        parsers.push(unordered.createUnorderedDeadline(onStatusUnordered,
                /*reject*/ undefined, ability, side));
    }

    const [ok, acceptedAbility] = await unordered.oneOf(ctx, parsers);
    if (ok) accept(abilities.get(acceptedAbility!)!);
}

async function onStatusUnordered(ctx: BattleParserContext<"gen4">,
    accept: unordered.AcceptCallback, ability: dex.Ability, side: SideID):
    Promise<dex.Ability>
{
    await ability.onStatus(ctx, accept, side);
    return ability;
}

/**
 * Creates an EventInference parser that expects an on-`moveDamage` ability or
 * its variants to activate if possible.
 * @param side Pokemon reference who could have such an ability.
 * @param qualifier The qualifier of which effects the ability may activate.
 * @param hitBy Move+user ref the holder was hit by.
 */
export function onMoveDamage(ctx: BattleParserContext<"gen4">, side: SideID,
    qualifier: "damage" | "contact" | "contactKO", hitBy: dex.MoveAndUserRef)
{
    let on: dex.AbilityOn;
    switch (qualifier)
    {
        case "damage": on = "moveDamage"; break;
        case "contact": on = "moveContact"; break;
        case "contactKO": on = "moveContactKO"; break;
    }

    const mon = ctx.state.getTeam(side).active;
    const hitByUser = ctx.state.getTeam(hitBy.userRef).active;
    const hitByArg: dex.MoveAndUser = {move: hitBy.move, user: hitByUser};
    const abilities = getAbilities(mon,
        ability => ability.canMoveDamage(mon, on, hitByArg));

    return new inference.EventInference(new Set(abilities.values()),
        onMoveDamageImpl, abilities, on, side, hitBy);
}

async function onMoveDamageImpl(ctx: BattleParserContext<"gen4">,
    accept: inference.AcceptCallback,
    abilities: Map<dex.Ability, inference.SubInference>, on: dex.AbilityOn,
    side: SideID, hitBy: dex.MoveAndUserRef): Promise<void>
{
    const parsers: AbilityParser[] = [];
    for (const ability of abilities.keys())
    {
        parsers.push(unordered.createUnorderedDeadline(onMoveDamageUnordered,
                /*reject*/ undefined, ability, on, side, hitBy));
    }

    const [ok, acceptedAbility] = await unordered.oneOf(ctx, parsers);
    if (ok) accept(abilities.get(acceptedAbility!)!);
}

async function onMoveDamageUnordered(ctx: BattleParserContext<"gen4">,
    accept: unordered.AcceptCallback, ability: dex.Ability, on: dex.AbilityOn,
    side: SideID, hitBy: dex.MoveAndUserRef):
    Promise<dex.Ability>
{
    await ability.onMoveDamage(ctx, accept, on, side, hitBy);
    return ability;
}

// TODO: refactor hitBy to support non-move drain effects, e.g. leechseed
/**
 * Creates an EventInference parser that expects an on-`moveDrain` ability to
 * activate if possible (e.g. Liquid Ooze).
 * @param side Pokemon reference who could have such an ability.
 * @param hitBy Move+user ref the holder was hit by.
 */
export function onMoveDrain(ctx: BattleParserContext<"gen4">, side: SideID,
    hitBy: dex.MoveAndUserRef)
{
    const mon = ctx.state.getTeam(side).active;
    const abilities = getAbilities(mon, ability => ability.canMoveDrain());

    return new inference.EventInference(new Set(abilities.values()),
        onMoveDrainImpl, abilities, side, hitBy);
}

async function onMoveDrainImpl(ctx: BattleParserContext<"gen4">,
    accept: inference.AcceptCallback,
    abilities: Map<dex.Ability, inference.SubInference>, side: SideID,
    hitBy: dex.MoveAndUserRef): Promise<"invert" | undefined>
{
    const parsers: AbilityParser<[dex.Ability, "invert" | undefined]>[] = [];
    for (const ability of abilities.keys())
    {
        parsers.push(unordered.createUnorderedDeadline(onMoveDrainUnordered,
                /*reject*/ undefined, ability, side, hitBy));
    }

    const oneOfRes = await unordered.oneOf(ctx, parsers);
    if (oneOfRes[0])
    {
        const [acceptedAbility, res] = oneOfRes[1];
        accept(abilities.get(acceptedAbility!)!);
        return res;
    }
}

async function onMoveDrainUnordered(ctx: BattleParserContext<"gen4">,
    accept: unordered.AcceptCallback, ability: dex.Ability, side: SideID,
    hitBy: dex.MoveAndUserRef): Promise<[dex.Ability, "invert" | undefined]>
{
    return [
        ability, await ability.onMoveDrain(ctx, accept, side, hitBy.userRef)
    ];
}

/**
 * Searches for possible ability pathways based on the given predicate.
 * @param mon Pokemon to search.
 * @param prove Callback for filtering eligible abilities. Should return a set
 * of {@link inference.SubReason reasons} that would prove that the ability
 * could activate, or null if it can't.
 * @returns A Map of {@link dex.Ability} to a {@link inference.SubInference}
 * modeling its restrictions given by the predicate.
 */
function getAbilities(mon: Pokemon,
    prove: (ability: dex.Ability) => Set<inference.SubReason> | null):
    Map<dex.Ability, inference.SubInference>
{
    const res = new Map<dex.Ability, inference.SubInference>();
    if (mon.volatile.suppressAbility) return res;

    for (const name of mon.traits.ability.possibleValues)
    {
        const ability = dex.getAbility(mon.traits.ability.map[name]);
        const reasons = prove(ability);
        if (!reasons) continue;
        reasons.add(hasAbility(mon, new Set([name])));
        res.set(ability, new inference.SubInference(reasons));
    }
    return res;
}

/**
 * Parses an `|-ability|` event.
 * @param on Describes the circumstances of this event in order to handle
 * ability effects. If null, then the ability is just being set or revealed.
 */
export async function abilityEvent(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-ability|");
    const [, identStr, abilityStr] = event.args;
    const abilityId = toIdName(abilityStr);
    handleAbility(ctx, identStr, abilityId)
    await consume(ctx);
}

// TODO: necessary?
/** Parses an ability activation as a suffix of another event, if present. */
export function abilitySuffix(ctx: BattleParserContext<"gen4">,
    event: Event):
    {
        holder: Pokemon, ident: ReturnType<typeof Protocol.parsePokemonIdent>,
        ability: dex.Ability
    } | null
{
    // TODO: parse suffix into separate ability event
    // TODO: for trace, ?
    switch (event.args[0])
    {
        case "cant":
        {
            const [, identStr, reason] = event.args;
            const abilityId = parseAbilityEffectId(reason);
            if (!abilityId) break;
            const {holder, ident, ability} =
                handleAbility(ctx, identStr, abilityId);

            // TODO: delegate to Ability obj?
            if (ability.data.name === "truant")
            {
                holder.volatile.activateTruant();
                // recharge turn overlaps with truant turn
                holder.volatile.mustRecharge = false;
            }
            return {holder, ident, ability};
        }
    }
    return null;
}

function parseAbilityEffectId(str?: string): string | null
{
    if (!str?.startsWith("ability: ")) return null;
    return toIdName(str.substr("ability: ".length));
}

/** Sets ability and returns holder/ability data. */
function handleAbility(ctx: BattleParserContext<"gen4">,
    identStr: Protocol.PokemonIdent, abilityId: string):
    {
        holder: Pokemon, ident: ReturnType<typeof Protocol.parsePokemonIdent>,
        ability: dex.Ability
    }
{
    const ability = dex.getAbility(abilityId);
    if (!ability) throw new Error(`Unknown ability '${abilityId}'`);

    const ident = Protocol.parsePokemonIdent(identStr);
    const holder = ctx.state.getTeam(ident.player).active;
    holder.setAbility(ability.data.name);
    return {holder, ident, ability};
}