import * as dex from "../dex/dex";
import * as dexutil from "../dex/dex-util";
import { Pokemon } from "../state/Pokemon";
import { Side } from "../state/Side";
import { SubParserConfig, SubParserResult } from "../../../../../../battle/parser/BattleParser";
import { consume, peek, verify } from "../../../../../../battle/parser/helpers";
import { createEventInference, EventInference, expectEvents, ExpectEventsResult,
    SubInference } from "./EventInference";
import { getItems } from "./itemHelpers";

/** Result from `expectItems()` and variants like `onMovePostDamage()`. */
export type ExpectItemsResult = ExpectEventsResult<ItemResult>;

/**
 * Expects an on-`movePostDamage` item to activate.
 * @param eligible Eligible holders.
 */
export async function onMovePostDamage(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>): Promise<ExpectItemsResult>
{
    const pendingItems = getItems(cfg, eligible,
        (item, mon) => item.canMovePostDamage(mon));

    return await expectItems(cfg, "movePostDamage", pendingItems);
}

/**
 * Expects an item activation.
 * @param on Context in which the item would activate.
 * @param pendingItems Eligible item possibilities.
 */
async function expectItems(cfg: SubParserConfig, on: dexutil.ItemOn,
    pendingItems: {readonly [S in Side]?: ReadonlyMap<string, SubInference>}):
    Promise<ExpectItemsResult>
{
    const inferences: EventInference<ItemResult>[] = [];
    for (const monRef in pendingItems)
    {
        if (!pendingItems.hasOwnProperty(monRef)) continue;
        const items = pendingItems[monRef as Side]!;
        inferences.push(createEventInference(new Set(items.values()),
            async function expectItemsTaker(_cfg, accept)
            {
                const event = await peek(_cfg);
                if (event.type !== "activateItem") return {};
                if (event.monRef !== monRef) return {};

                // match pending item possibilities with current item event
                const inf = items.get(event.item);
                if (!inf) return {};

                // indicate accepted event
                accept(inf);
                return await activateItem(cfg, on);
            }));
    }

    return await expectEvents(cfg, inferences);
}

/** Context for handling item activation. */
interface ItemContext
{
    /** Parser state. */
    readonly cfg: SubParserConfig;
    /** Item holder. */
    readonly holder: Pokemon;
    /** Item holder Pokemon reference. */
    readonly holderRef: Side;
    /** Item data wrapper. */
    readonly item: dex.Item;
    /** Circumstances in which the item is activating. */
    readonly on: dexutil.ItemOn | null;
}

/** Result from handling an ActivateItem event. */
export type ItemResult = SubParserResult;

/**
 * Handles events within the context of an item activation. Returns the
 * last event that it didn't handle.
 * @param on Context in which the item is activating.
 */
export async function activateItem(cfg: SubParserConfig,
    on: dexutil.ItemOn | null = null): Promise<ItemResult>
{
    const initialEvent = await verify(cfg, "activateItem");
    let item: dex.Item | null;
    if (initialEvent.item === "none" ||
        !(item = dex.getItem(initialEvent.item)))
    {
        throw new Error(`Unknown item '${initialEvent.item}'`);
    }
    const holder = cfg.state.teams[initialEvent.monRef].active;
    const holderRef = initialEvent.monRef;

    // after the item has been validated, we can infer it for the pokemon
    holder.setItem(item.data.name);

    // dispatch item effects
    const ctx: ItemContext = {cfg, holder, holderRef, item, on};
    return dispatchEffects(ctx);
}

/**
 * Dispatches the effects of an item. Assumes that the initial `activateItem`
 * event hasn't been consumed or fully verified yet.
 * @param ctx Item SubParser context.
 */
async function dispatchEffects(ctx: ItemContext): Promise<ItemResult>
{
    switch (ctx.on)
    {
        case "movePostDamage":
            return await ctx.item.onMovePostDamage(ctx.cfg, ctx.holderRef);
        case "turn":
            return await ctx.item.onTurn(ctx.cfg, ctx.holderRef);
        default:
            await consume(ctx.cfg);
            return {};
    }
}
