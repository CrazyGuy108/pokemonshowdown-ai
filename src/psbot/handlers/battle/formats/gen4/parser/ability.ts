import { Protocol } from "@pkmn/protocol";
import { toIdName } from "../../../../../helpers";
import { Event } from "../../../../../parser";
import { BattleParserContext, consume, verify } from "../../../parser";
import * as dex from "../dex";
import { Pokemon } from "../state/Pokemon";

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
