import { Protocol } from "@pkmn/protocol";
import { toIdName } from "../../../../../helpers";
import { Event } from "../../../../../parser";
import { BattleParserContext, consume, verify } from "../../../parser";
import * as dex from "../dex";
import { Pokemon } from "../state/Pokemon";

/**
 * Expects an ability activation.
 * @param on Describes the circumstances of this event in order to handle
 * ability effects. If null, then the ability is just being set or revealed.
 */
export async function activateAbility(ctx: BattleParserContext<"gen4">,
    on: dex.AbilityOn | null = null)
{

}

/**
 * Parses an `|-ability|` event and its effects.
 * @param on Describes the circumstances of this event in order to handle
 * ability effects. If null, then the ability is just being set or revealed.
 */
export async function parseAbility(ctx: BattleParserContext<"gen4">,
    on: dex.AbilityOn | null = null)
{
    const event = await verify(ctx, "|-ability|");
    const [_, identStr, abilityStr] = event.args;
    const abilityId = toIdName(abilityStr);

    const {holder, ident, ability} = handleAbility(ctx, identStr, abilityId)

    ctx =
    {
        ...ctx,
        logger: ctx.logger.addPrefix("Ability(" +
            `${ident.player}${ident.position}, ${ability.data.name}): `)
    };

    await consume(ctx);

    // TODO: ability effects, get examples
}

/** Parses an ability activation as a suffix of another event, if present. */
export function handleAbilitySuffix(ctx: BattleParserContext<"gen4">,
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
            const {holder, ability} = handleAbility(ctx, identStr, abilityId);

            // TODO: delegate to Ability obj?
            if (ability.data.name === "truant")
            {
                holder.volatile.activateTruant();
                // recharge turn overlaps with truant turn
                holder.volatile.mustRecharge = false;
            }
            return {holder, ability};
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
