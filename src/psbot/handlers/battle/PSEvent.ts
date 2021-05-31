import type { Args, KWArgs, Protocol } from "@pkmn/protocol";

/** PS protocol event type. */
export type Event<TName extends Protocol.ArgName = Protocol.ArgName> =
    ArgsEvent<TName> & KWEvent<TName>;

interface ArgsEvent<TName extends Protocol.ArgName>
{
    /** Array arguments. First element is event type. */
    args: Args[TName];
}

type KWEvent<TName extends Protocol.ArgName> =
    TName extends Protocol.BattleArgsWithKWArgName ?  KWEventImpl<TName>
    : {};

interface KWEventImpl<TName extends Protocol.BattleArgsWithKWArgName>
{
    /** Keyword arguments. */
    kwArgs: KWArgs[TName];
}
