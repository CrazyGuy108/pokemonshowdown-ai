import * as dex from "../dex/dex";
import * as dexutil from "../dex/dex-util";
import { Pokemon } from "../state/Pokemon";
import { Side } from "../state/Side";
import { SubParserConfig, SubParserResult } from "../../../../../../battle/parser/BattleParser";
import { consume, peek, verify } from "../../../../../../battle/parser/helpers";
import { createEventInference, EventInference, expectEvents, ExpectEventsResult,
    SubInference } from "./EventInference";
import { getItems } from "./itemHelpers";

// TODO: should EventInference code be moved to a separate module?
/**
 * Result from `expectConsumeItems()` and variants like `consumeOnMoveCharge()`.
 */
export type ExpectConsumeItemsResult = ExpectEventsResult<ItemConsumeResult>;

// TODO: most of these can't be called by current turn-tracking infrastructure
/**
 * Expects a consumeOn-`preMove` item to activate.
 * @param eligible Eligible holders.
 */
export async function consumeOnPreMove(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>):
    Promise<ExpectConsumeItemsResult>
{
    const pendingItems = getItems(cfg, eligible,
        (item, mon) => item.canConsumePreMove(mon));

    return await expectConsumeItems(cfg, "preMove", pendingItems);
}

/**
 * Expects a consumeOn-`moveCharge` item to activate.
 * @param eligible Eligible holders.
 */
export async function consumeOnMoveCharge(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>):
    Promise<ExpectConsumeItemsResult>
{
    const pendingItems = getItems(cfg, eligible,
        (item, mon) => item.canConsumeMoveCharge(mon));

    return await expectConsumeItems(cfg, "moveCharge", pendingItems);
}

/**
 * Expects a consumeOn-`preHit` item to activate.
 * @param eligible Eligible holders.
 * @param hitBy Move and user the holder is being hit by.
 */
export async function consumeOnPreHit(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>,
    hitBy: dexutil.MoveAndUserRef): Promise<ExpectConsumeItemsResult>
{
    const hitBy2: dexutil.MoveAndUser =
        {move: hitBy.move, user: cfg.state.teams[hitBy.userRef].active};
    const pendingItems = getItems(cfg, eligible,
        (item, mon) => item.canConsumePreHit(mon, hitBy2));

    return await expectConsumeItems(cfg, "preHit", pendingItems, hitBy);
}

/**
 * Expects a consumeOn-`tryOHKO` item to activate.
 * @param eligible Eligible holders. It's assumed that the eligible holders were
 * at full hp before being deducted just now.
 */
export async function consumeOnTryOHKO(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>):
    Promise<ExpectConsumeItemsResult>
{
    const pendingItems = getItems(cfg, eligible,
        (item, mon) => item.canConsumeTryOHKO(mon));

    return await expectConsumeItems(cfg, "tryOHKO", pendingItems);
}

/**
 * Expects a consumeOn-`super` item to activate.
 * @param eligible Eligible holders.
 * @param hitByMove Move the holder is being hit by.
 * @param userRef User of the move.
 */
export async function consumeOnSuper(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>,
    hitBy: dexutil.MoveAndUserRef): Promise<ExpectConsumeItemsResult>
{
    const hitBy2: dexutil.MoveAndUser =
        {move: hitBy.move, user: cfg.state.teams[hitBy.userRef].active};
    const pendingItems = getItems(cfg, eligible,
        (item, mon) => item.canConsumeSuper(mon, hitBy2));

    return await expectConsumeItems(cfg, "super", pendingItems, hitBy);
}

/**
 * Expects a consumeOn-`postHit` item to activate.
 * @param eligible Eligible holders.
 * @param hitByMove Move the holder is being hit by.
 * @param userRef User of the move.
 */
export async function consumeOnPostHit(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>,
    hitBy: dexutil.MoveAndUserRef): Promise<ExpectConsumeItemsResult>
{
    const hitBy2: dexutil.MoveAndUser =
        {move: hitBy.move, user: cfg.state.teams[hitBy.userRef].active};
    const pendingItems = getItems(cfg, eligible,
        (item, mon) => item.canConsumePostHit(mon, hitBy2));

    return await expectConsumeItems(cfg, "postHit", pendingItems, hitBy);
}

/**
 * Expects a consumeOn-`update` item to activate.
 * @param eligible Eligible holders.
 */
export async function consumeOnUpdate(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>):
    Promise<ExpectConsumeItemsResult>
{
    const pendingItems = getItems(cfg, eligible,
        (item, mon) => item.canConsumeUpdate(mon));

    return await expectConsumeItems(cfg, "update", pendingItems);
}

/**
 * Expects a consumeOn-`residual` item to activate.
 * @param eligible Eligible holders.
 */
export async function consumeOnResidual(cfg: SubParserConfig,
    eligible: Partial<Readonly<Record<Side, true>>>):
    Promise<ExpectConsumeItemsResult>
{
    const pendingItems = getItems(cfg, eligible,
        (item, mon) => item.canConsumeResidual(mon));

    return await expectConsumeItems(cfg, "residual", pendingItems);
}


/**
 * Expects an item consumption.
 * @param on Context in which the item would activate.
 * @param pendingItems Eligible item possibilities.
 * @param hitBy Move+userRef that the holder was hit by.
 */
async function expectConsumeItems(cfg: SubParserConfig,
    on: dexutil.ItemConsumeOn,
    pendingItems: Partial<Record<Side, ReadonlyMap<string, SubInference>>>,
    hitBy?: dexutil.MoveAndUserRef): Promise<ExpectConsumeItemsResult>
{
    const inferences: EventInference[] = [];
    for (const monRef in pendingItems)
    {
        if (!pendingItems.hasOwnProperty(monRef)) continue;
        const items = pendingItems[monRef as Side]!;
        inferences.push(createEventInference(new Set(items.values()),
            async function expectConsumeItemsTaker(_cfg, accept)
            {
                const event = await peek(_cfg)
                if (event.type !== "removeItem") return {};
                if (event.monRef !== monRef) return {};
                if (typeof event.consumed !== "string") return {};

                // match pending item possibilities with current item event
                const inf = items.get(event.consumed);
                if (!inf) return {};

                // indicate accepted event
                accept(inf);
                return await removeItem(_cfg, on, hitBy);
            }));
    }

    return await expectEvents(cfg, inferences);
}

/** Context for handling item consumption effects. */
interface RemoveItemContext
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
    readonly on: dexutil.ItemConsumeOn | null;
    /** Move+user that the holder was hit by, if applicable. */
    readonly hitBy?: dexutil.MoveAndUser & dexutil.MoveAndUserRef;
}

// TODO: separate interface fields by ItemConsumeOn type key
/** Result from handling a RemoveItem event. */
export interface ItemConsumeResult extends SubParserResult
{
    /** Whether the holder will be moving first within its priority bracket. */
    moveFirst?: true;
    /** Whether to shorten charging (two-turn) move. */
    shorten?: true;
    /** Resist berry type. */
    resistSuper?: dexutil.Type;
}

/**
 * Handles events within the context of an item consumption. Returns the
 * last event that it didn't handle.
 * @param on Context in which the item is activating.
 * @param hitBy Move+user that the item holder was hit by.
 */
export async function removeItem(cfg: SubParserConfig,
    on: dexutil.ItemConsumeOn | null = null,
    hitBy?: dexutil.MoveAndUserRef): Promise<ItemConsumeResult>
{
    const event = await verify(cfg, "removeItem");
    let item: dex.Item | null | undefined;
    if (typeof event.consumed === "string")
    {
        if (event.consumed === "none" || !(item = dex.getItem(event.consumed)))
        {
            throw new Error(`Unknown item '${event.consumed}'`);
        }
    }

    const holderRef = event.monRef;
    const holder = cfg.state.teams[holderRef].active;
    holder.removeItem(event.consumed);
    // handle consumed=boolean case
    if (!item)
    {
        await consume(cfg);
        return {};
    }

    const ctx: RemoveItemContext =
    {
        cfg, holder, holderRef, item, on,
        ...hitBy &&
            {hitBy: {...hitBy, user: cfg.state.teams[hitBy.userRef].active}}
    };

    return await dispatchEffects(ctx);
}

/**
 * Dispatches the effects of an item being consumed. Assumes that the initial
 * `removeItem` event hasn't been consumed or fully verified yet.
 * @param ctx RemoveItem SubParser context.
 */
async function dispatchEffects(ctx: RemoveItemContext):
    Promise<ItemConsumeResult>
{
    switch (ctx.on)
    {
        case "preMove":
            return await ctx.item.consumeOnPreMove(ctx.cfg, ctx.holderRef);
        case "moveCharge":
            return await ctx.item.consumeOnMoveCharge(ctx.cfg, ctx.holderRef);
        case "preHit":
            // istanbul ignore next: should never happen
            if (!ctx.hitBy) throw new Error("Incomplete hitBy args");
            return await ctx.item.consumeOnPreHit(ctx.cfg, ctx.holderRef,
                ctx.hitBy);
        case "tryOHKO":
            return await ctx.item.consumeOnTryOHKO(ctx.cfg, ctx.holderRef);
        case "super":
            return await ctx.item.consumeOnSuper(ctx.cfg, ctx.holderRef);
        case "postHit":
            // istanbul ignore next: should never happen
            if (!ctx.hitBy) throw new Error("Incomplete hitBy args");
            return await ctx.item.consumeOnPostHit(ctx.cfg, ctx.holderRef,
                ctx.hitBy);
        case "update":
            return await ctx.item.consumeOnUpdate(ctx.cfg, ctx.holderRef);
        case "residual":
            return await ctx.item.consumeOnResidual(ctx.cfg, ctx.holderRef);
        default:
            await consume(ctx.cfg);
            return {};
    }
}
