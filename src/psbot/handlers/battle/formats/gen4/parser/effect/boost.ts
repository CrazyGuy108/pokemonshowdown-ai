/** @file Parsers and helper functions related to stat boost events. */
import { Protocol } from "@pkmn/protocol";
import { BoostID, SideID } from "@pkmn/types";
import { Event } from "../../../../../../parser";
import { BattleParserContext, eventLoop, tryVerify } from "../../../../parser";
import { BoostTable } from "../../dex";
import { dispatch, handlers as base } from "../base";

// TODO: move to a helper lib
type Writable<T> = {-readonly [U in keyof T]: T[U]};

/** Args for {@link boost}. */
export interface BoostArgs
{
    /** Pokemon reference receiving the boosts. */
    side: SideID;
    /** Boosts to apply. */
    table: Partial<BoostTable<number>>;
    /** Whether to ignore boosts that can't be applied. Default false.  */
    silent?: boolean;
}

/**
 * Parses a boost/unboost effect.
 * @param accept Callback to accept this pathway. Called while parsing the first
 * expected boost event.
 * @param args Other required named arguments.
 * @returns The boosts that weren't parsed.
 */
export async function boost(ctx: BattleParserContext<"gen4">,
    args: BoostArgs): Promise<Partial<Writable<BoostTable<number>>>>
{
    const mon = ctx.state.getTeam(args.side).active;
    const table = {...args.table};

    await eventLoop(ctx,
        async function boostLoop(_ctx)
        {
            const event = await tryVerify(_ctx, "|-boost|", "|-unboost|");
            if (!event) return;
            const [, identStr, boostId, boostAmountStr] = event.args;
            const ident = Protocol.parsePokemonIdent(identStr);
            if (ident.player !== args.side) return;
            if (!table.hasOwnProperty(boostId)) return;
            const boostAmount = Number(boostAmountStr);
            if (!matchBoost(table[boostId]!, boostAmount,
                mon.volatile.boosts[boostId]))
            {
                return;
            }
            delete table[boostId];
            await dispatch(ctx);
        });

    if (args.silent)
    {
        // remove boosts that were already at their limit
        consumeBoosts(table,
            boostId =>
                matchBoost(table[boostId]!, 0,
                    mon.volatile.boosts[boostId as BoostID]));
    }

    return table;
}

/**
 * Checks if the boost amounts are suitable.
 * @param pending Pending boost amount.
 * @param given Given boost amount from a `|-boost|`/`|-unboost|` event.
 * @param current Pokemon's current boost amount.
 */
export function matchBoost(pending: number, given: number, current: number):
    boolean
{
    // boost amount that will be set
    const next = Math.max(-6, Math.min(current + given, 6));
    // boost amount that we expected
    const expected = Math.max(-6, Math.min(current + pending, 6));
    return next === expected;
}

/**
 * Parses a set-boost effect.
 * @param accept Callback to accept this pathway. Called while parsing the first
 * expected boost event.
 * @param args Other required named arguments.
 * @returns The boosts that weren't parsed.
 */
export async function setBoost(ctx: BattleParserContext<"gen4">,
    args: BoostArgs): Promise<Partial<Writable<BoostTable<number>>>>
{
    const mon = ctx.state.getTeam(args.side).active;
    const table = {...args.table};

    await eventLoop(ctx,
        async function setBoostLoop(_ctx)
        {
            const event = await tryVerify(_ctx, "|-setboost|");
            if (!event) return;
            const [, identStr, boostId, boostAmountStr] = event.args;
            const ident = Protocol.parsePokemonIdent(identStr);
            if (ident.player !== args.side) return;
            if (!table.hasOwnProperty(boostId)) return;
            const boostAmount = Number(boostAmountStr);
            if (table[boostId]! !== boostAmount) return;
            delete table[boostId];
            await base["|-setboost|"](_ctx);
        });

    if (args.silent)
    {
        // remove boosts that were already set to the expected amount
        consumeBoosts(table,
            boostId =>
                table[boostId] === mon.volatile.boosts[boostId as BoostID]);
    }

    return table;
}

/** Removes keys that satisfy the predicate. */
function consumeBoosts(table: Partial<Writable<BoostTable<number>>>,
    pred: (boostId: BoostID) => boolean): void
{
    for (const boostId in table)
    {
        if (!table.hasOwnProperty(boostId)) continue;
        if (pred(boostId as BoostID))
        {
            delete table[boostId as BoostID];
        }
    }
}

/**
 * Parses a boost/unboost effect for one stat.
 * @param accept Callback to accept this pathway. Called while parsing the first
 * expected boost event.
 * @param args Other required named arguments.
 * @returns The boost that was parsed, or "silent" if no boosts could be
 * applied if `args.silent=true`. Otherwise `undefined` if the next event is
 * invalid.
 */
export async function boostOne(ctx: BattleParserContext<"gen4">,
    args: BoostArgs,
    pred?: (event: Event<"|-boost|" | "|-unboost|">) => boolean):
    Promise<"silent" | BoostID | undefined>
{
    const mon = ctx.state.getTeam(args.side).active;
    if (args.silent)
    {
        // verify that all the possible boosts were already maxed out
        let allMaxed = true;
        for (const possibleBoostId in args.table)
        {
            if (!args.table.hasOwnProperty(possibleBoostId)) continue;
            if (!matchBoost(args.table[possibleBoostId as BoostID]!, 0,
                    mon.volatile.boosts[possibleBoostId as BoostID]))
            {
                allMaxed = false;
                break;
            }
        }
        if (allMaxed) return "silent";
    }

    const event = await tryVerify(ctx, "|-boost|", "|-unboost|");
    if (!event) return;
    const [, identStr, boostId, boostAmountStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    if (ident.player !== args.side) return;
    if (!args.table.hasOwnProperty(boostId)) return;
    const boostAmount = Number(boostAmountStr);
    if (!matchBoost(args.table[boostId]!, boostAmount,
        mon.volatile.boosts[boostId]))
    {
        return;
    }
    if (pred && !pred(event)) return;
    await dispatch(ctx);


    return boostId;
}
