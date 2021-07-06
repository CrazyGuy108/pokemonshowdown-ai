import { Protocol } from "@pkmn/protocol";
import { SideID } from "@pkmn/types";
import { toIdName } from "../../../../../helpers";
import { Event } from "../../../../../parser";
import { BattleParserContext, consume, inference, peek, verify } from
    "../../../parser";
import * as dex from "../dex";
import { Pokemon } from "../state/Pokemon";
import { hasAbility } from "./reason/ability";

/**
 * Creates an EventInference parser that expects an on-`switchOut` ability to
 * activate if possible.
 * @param side Pokemon reference who could have such an ability.
 */
export async function onSwitchOut(ctx: BattleParserContext<"gen4">,
    side: SideID)
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
    const event = await peek(ctx);
    // TODO: check for on-switchout ability effects
    // TODO: event format?
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
 * Creates an EventInference that expects an ability activation.
 * @param accept Callback to accept one of the provided ability pathways.
 * @param on Context in which the ability would activate.
 * @param side Pokemon reference who could have such an ability.
 * @param abilities Eligible ability pathways.
 * @param hitBy Move and user-ref that hit the ability holder with a move, if
 * applicable.
 */
async function activateAbility(ctx: BattleParserContext<"gen4">,
    accept: inference.AcceptCallback, on: dex.AbilityOn, side: SideID,
    abilities: ReadonlyMap<dex.Ability, inference.SubInference>,
    hitBy?: dex.MoveAndUserRef)
{
    switch (on)
    {
        case "switchOut":

    }
}

/**
 * Parses an `|-ability|` event.
 * @param on Describes the circumstances of this event in order to handle
 * ability effects. If null, then the ability is just being set or revealed.
 */
export async function abilityEvent(ctx: BattleParserContext<"gen4">)
{
    const event = await verify(ctx, "|-ability|");
    const [_, identStr, abilityStr] = event.args;
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
            const [_, identStr, reason] = event.args;
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
