import { Protocol } from "@pkmn/protocol";
import { BattleParserContext, tryPeek, verify } from "../../../battle/parser";
import { Event } from "../../parser";

/**
 * Peeks and verifies the next Event's type. Throws if there are no events left
 * or if the predicate fails.
 * @param ctx Parser context.
 * @param type Expected event type.
 */
export async function verifyNext<T extends Protocol.ArgName>(
    ctx: BattleParserContext<Event, any, any, any>, type: T): Promise<Event<T>>
{
    return verify(ctx,
        (event: Event): event is Event<T> =>
            Protocol.key(event.args) === type,
        event =>
            `Expected type '${type}' but got '${Protocol.key(event.args)}'`);
}

/**
 * Peeks and verifies the next Event's type. Returns null if there are no events
 * left or if the event type doesn't match.
 * @param ctx Parser context.
 * @param type Expected event type.
 */
export async function tryVerifyNext<T extends Protocol.ArgName>(
    ctx: BattleParserContext<Event, any, any, any>, type: T):
    Promise<Event<T> | null>
{
    const event = await tryPeek(ctx);
    if (!event || Protocol.key(event.args) !== type) return null;
    return event as Event<T>;
}
