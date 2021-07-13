/** @file Parsers related to item activations. */
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

/** Checks if items should activate. */
export async function updateItems(ctx: BattleParserContext<"gen4">):
    Promise<void>
{
    // TODO: also check abilities? in what order?
    // TODO
    await unordered.all(ctx,
        (Object.keys(ctx.state.teams) as SideID[])
            .map(side => consumeOnUpdate(ctx, side)));
}
