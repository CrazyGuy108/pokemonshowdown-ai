import { Protocol } from "@pkmn/protocol";
import { BattleParserContext, verify } from "../../../battle/parser";
import { Event } from "../../parser";

/**
 * Peeks and verifies the next Event's type. Throws if there are no events left
 * or if the predicate fails.
 * @param ctx Parser context.
 * @param type Expected event type.
 */
export async function verifyNext<T extends Protocol.ArgName>(
    ctx: BattleParserContext<Event, any, any>, type: T): Promise<Event<T>>
{
    return verify(ctx,
        (event: Event): event is Event<T> =>
            Protocol.key(event.args) === type,
        event =>
            `Expected type '${type}' but got '${Protocol.key(event.args)}'`);
}
