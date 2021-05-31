import * as dex from "../dex/dex";
import * as dexutil from "../dex/dex-util";
import { Effectiveness } from "../dex/typechart";
import { ReadonlyBattleState } from "../state/BattleState";
import { Move } from "../state/Move";
import { Pokemon } from "../state/Pokemon";
import { otherSide, Side } from "../state/Side";
import * as events from "../../../../../../battle/parser/BattleEvent";
import { SubParserConfig, SubParserResult } from "../../../../../../battle/parser/BattleParser";
import { consume, eventLoop, peek, tryPeek, verify } from "../../../../../../battle/parser/helpers";
import * as ability from "./activateAbility";
import * as item from "./activateItem";
import { dispatch, handlers as base } from "./base";
import * as parsers from "./parsers";
import * as consumeItem from "./removeItem";
import { expectSwitch } from "./switchIn";

/**
 * Handles events within the context of a move being used. Returns the
 * last event that it didn't handle.
 * @param called Whether this move was called by another move, or reflected
 * (`"bounced"`) via another effect. Default false.
 */
export async function useMove(cfg: SubParserConfig,
    called: boolean | "bounced" = false): Promise<SubParserResult>
{
    // setup context and verify initial event
    const ctx = await initCtx(cfg, called);
    preMoveAssertions(ctx);
    inferTargets(ctx);
    // after we've verified the initial useMove event we can consume it
    await consume(cfg);

    // look for move interruptions
    const tryResult = await tryExecute(ctx);
    if (tryResult.fail === "fail") return {};

    // execute move effects
    const execResult = await execute(ctx, /*miss*/ tryResult.fail === "miss");

    // clean up flags and return
    preHaltIgnoredEffects(ctx);
    return execResult;
}

/** Extended parser state for move context. */
interface MoveContext
{
    /** Base SubParserConfig. */
    readonly cfg: SubParserConfig;
    /** Original UseMove event. */
    readonly event: events.UseMove;
    /**
     * Whether this move was called by another move, or reflected (`"bounced"`)
     * via another effect.
     */
    readonly called: boolean | "bounced";

    // event data
    /** Reference to find the user within the BattleState. */
    readonly userRef: Side;
    /** Name of the move. */
    readonly moveName: string;
    /** User of the move. */
    readonly user: Pokemon;
    /** Dex data for the move. */
    readonly move: dex.Move;
    /** Move object if this event came directly from the user's moveset. */
    readonly moveState?: Move;
    // TODO: expand for doubles/triples
    /** Maps mon-ref to whether the move may hit them. */
    readonly pendingTargets: {readonly [TMonRef in Side]: boolean};
    /**
     * Total number of expected targets. If `#pendingTargets` allows for more
     * than this number, only the first `totalTargets` mentioned targets will be
     * counted.
     */
    readonly totalTargets: number;

    // move expectations
    /** Whether all implicit effects should have been handled by now. */
    implicitHandled: boolean;
    /** Whether all silently ignored effects should have been handled by now. */
    ignoredHandled: boolean;
    /** Whether this move should be recorded by its targets for Mirror Move. */
    readonly mirror: boolean;
    /** Last move before this one. */
    readonly lastMove?: string;
    /** Whether this is a two-turn move on its second turn. */
    readonly releasedTwoTurn?: true;

    // in-progress move result flags
    /**
     * Target-refs currently mentioned by listening to events. Lays groundwork
     * for future double/triple battle support.
     */
    readonly mentionedTargets: Map<Side, TargetFlags>;
    /**
     * If defined, the current move has been bounced by the given Pokemon
     * reference so a call effect should be expected immediately after this is
     * set.
     */
    bouncing?: Side;
    /** Whether the move failed on its own or just missed its targets. */
    failed?: true | "miss";
    // TODO(doubles): index by opponent as well
    /** Status effects being blocked for the target. */
    blockStatus?: {readonly [T in dexutil.StatusType]?: true};
}

interface TargetFlags
{
    /** Whether the target was damaged directly or KO'd. */
    damaged?: true | "ko";
    /** Whether the target applied Pressure. */
    pressured?: true;
}

/**
 * Initializes move context state using the initial useMove event, but doesn't
 * consume it just yet.
 */
async function initCtx(cfg: SubParserConfig,
    called: boolean | "bounced"): Promise<MoveContext>
{
    const event = await verify(cfg, "useMove");

    // TODO: should there be so many exceptions? replace these with error logs
    //  and provide a recovery path if not testing
    const moveName = event.move;
    const move = dex.getMove(moveName);
    if (!move) throw new Error(`Unknown move '${moveName}'`);

    // set last move
    const lastMove = cfg.state.status.lastMove;
    cfg.state.status.lastMove = event.move;

    // other trivial event data
    const userRef = event.monRef;
    const user = cfg.state.teams[userRef].active;

    // find out which pokemon should be targeted by the move
    let pendingTargets: {readonly [TMonRef in Side]: boolean};
    let totalTargets: number;
    switch (move.getTarget(user))
    {
        // TODO: support non-single battles
        case "adjacentAlly":
            // these moves should always fail in singles
            pendingTargets = {us: false, them: false};
            totalTargets = 0;
            break;
        case "adjacentAllyOrSelf": case "allies": case "allySide":
        case "allyTeam": case "self":
            pendingTargets =
                framePendingTargets(userRef, {us: true, them: false});
            totalTargets = 1;
            break;
        case "all":
            pendingTargets =
                framePendingTargets(userRef, {us: true, them: true});
            totalTargets = 2;
            break;
        case "adjacentFoe": case "allAdjacent": case "allAdjacentFoes":
        case "any": case "foeSide": case "normal": case "randomNormal":
        case "scripted":
            pendingTargets =
                framePendingTargets(userRef, {us: false, them: true});
            totalTargets = 1;
            break;
    }

    // release two-turn move
    let releasedTwoTurn = false;
    if (user.volatile.twoTurn.type === moveName)
    {
        user.volatile.twoTurn.reset();
        if (move.data.effects?.delay?.type !== "twoTurn")
        {
            // istanbul ignore next: should never happen
            throw new Error(`Two-turn move '${moveName}' does not have ` +
                "delay=twoTurn");
        }
        releasedTwoTurn = true;
    }

    const continueLock = user.volatile.lockedMove.type === moveName;
    const continueRollout = user.volatile.rollout.type === moveName;

    const mirror =
        // expected to be a charging turn, can't mirror those
        (move.data.effects?.delay?.type !== "twoTurn" || releasedTwoTurn) &&
        // can't mirror called moves
        !called &&
        // can't mirror called rampage moves
        (!continueLock || !user.volatile.lockedMove.called) &&
        (!continueRollout || !user.volatile.rollout.called) &&
        // default to mirror move flag
        // TODO: should called+released two-turn count? (unique to PS?)
        !move.data.flags?.noMirror;

    // setup result object
    const result: MoveContext =
    {
        cfg, event, called, userRef, moveName, user, move, pendingTargets,
        totalTargets, implicitHandled: false, ignoredHandled: false, mirror,
        ...lastMove && {lastMove}, ...releasedTwoTurn && {releasedTwoTurn},
        mentionedTargets: new Map()
    };

    // only reveal and deduct pp if this event isn't continuing a multi-turn
    //  move
    const reveal = !releasedTwoTurn && !continueLock && !continueRollout;

    // if this isn't a called move, then the user must have this move in its
    //  moveset (i.e., it's an actual move selection by the player)
    if (called) return result;

    // every move decision resets any single-move statuses
    user.volatile.resetSingleMove();

    // set last move if directly selecting from moveset/struggle
    if (!reveal) return result;
    user.volatile.lastMove = moveName;

    // only struggle can be selected without being a part of the moveset
    if (moveName === "struggle") return result;

    // record the move object in case further deductions need to be made
    const revealedMove = user.moveset.reveal(moveName);
    --revealedMove.pp;

    // activate choice item lock
    // TODO: how to infer choice lock when the item is revealed?
    // TODO: what if the item is removed after setting choice lock?
    if (user.item.definiteValue &&
        user.item.map[user.item.definiteValue].isChoice)
    {
        user.volatile.choiceLock = moveName;
    }

    // taunt assertion
    if (revealedMove.data.category === "status" &&
        user.volatile.taunt.isActive)
    {
        throw new Error(`Using status move '${moveName}' but should've been ` +
            "Taunted");
    }

    return {...result, moveState: revealedMove};
}

/** Converts a user(us)/target(them) map to an actual monRef us/them map. */
function framePendingTargets(userRef: Side,
    obj: {readonly [TRelMonRef in Side]: boolean}):
    {readonly [TMonRef in Side]: boolean}
{
    if (userRef === "us") return obj;
    return {them: obj.us, us: obj.them};
}

/** Assertions surrounding the selection of a move. */
function preMoveAssertions(ctx: MoveContext): void
{
    if (ctx.move.data.flags?.focus && !ctx.user.volatile.focus &&
        !ctx.user.volatile.encore.ts.isActive && !ctx.called)
    {
        ctx.cfg.logger.error("User has focus=false yet focus move being " +
            "used");
    }
}

/** Result of `tryExecute()`. */
interface TryExecuteResult extends SubParserResult
{
    /** Whether the move failed on its own or missed/was blocked. */
    fail?: "fail" | "miss";
}

/**
 * Checks if the move can be executed normally. Result has `#success=true` if it
 * can.
 */
async function tryExecute(ctx: MoveContext): Promise<TryExecuteResult>
{
    // see if the move failed on its own
    const failResult = await checkFail(ctx);
    // TODO: separate implicit effects
    if (failResult.success) return {fail: "fail"};

    // check for delayed move
    const delayResult = await checkDelay(ctx);
    if (delayResult.ret === true)
    {
        // set fail marker here so the caller short-circuits
        return {fail: "fail"};
    }
    // short-circuit current useMove() call frame to the returned promise
    if (delayResult.ret) return {...await delayResult.ret, fail: "fail"};

    // accuracy calculations start here, consume micleberry status
    // TODO(later): accuracy calcs and probablistic inductions
    ctx.user.volatile.micleberry = false;

    // check for other effects/abilities blocking this move
    // TODO(doubles): allow move to execute with fewer targets if only one of
    //  them blocks it
    const blockResult = await checkBlock(ctx);
    if (blockResult.success) return {fail: "miss"};

    // all checks passed
    return {};
}

/** Checks if the move failed on its own. */
async function checkFail(ctx: MoveContext, lastEvent?: events.Any):
    Promise<parsers.SuccessResult>
{
    let success: boolean | undefined;
    const result = await eventLoop(ctx.cfg, async function checkFailLoop(cfg)
    {
        const event = await peek(cfg);
        const _ctx = {...ctx, cfg};
        switch (event.type)
        {
            case "fail":
                // move couldn't be used
                // TODO: assertions on why the move could fail?
                success = true;
                handleFail(_ctx);
                return await base.fail(cfg);
            case "noTarget":
                // no opponent to target
                if (!cfg.state.teams[otherSide(_ctx.userRef)].active.fainted)
                {
                    break;
                }
                success = true;
                handleNoTarget(_ctx);
                return await base.noTarget(cfg);
        }
        return {};
    });

    // fail assertions
    if (success)
    {
        if (ctx.move.data.flags?.focus && !ctx.user.volatile.damaged)
        {
            ctx.cfg.logger.error("User has damaged=false yet focus move " +
                "failed");
        }
    }
    else
    {
        if (ctx.move.data.flags?.focus && ctx.user.volatile.damaged)
        {
            ctx.cfg.logger.error("User has damaged=true yet focus move " +
                "didn't fail");
        }
    }

    return {...result, ...success && {success}};
}

/** Result of `checkDelay()`. */
interface CheckDelayResult extends SubParserResult
{
    /**
     * Whether to short-circuit the move execution. If true it should stop
     * immediately. If it's a Promise then the short-circuit should
     * `return await` this value.
     */
    ret?: true | Promise<SubParserResult>;
}

/** Checks for a delayed move effect. */
async function checkDelay(ctx: MoveContext): Promise<CheckDelayResult>
{
    if (!ctx.move.data.effects?.delay) return {};
    const delayResult = await expectDelay(ctx);
    if (delayResult.success === "shorten")
    {
        // execute event again to handle shortened release turn
        // by creating a new MoveContext in this call, it'll no longer think
        //  it's in the charging turn so certain obscure effects are still
        //  handled properly (e.g. mirrormove tracking on release turn)
        let repeatEvent: events.UseMove | null = ctx.event;
        return {
            ret: useMove(
                {
                    ...ctx.cfg,
                    // override EventIterator to "repeat" or "unget" the current
                    //  useMove event
                    iter:
                    {
                        ...ctx.cfg.iter,
                        async next(state: ReadonlyBattleState)
                        {
                            if (repeatEvent)
                            {
                                const result = {value: repeatEvent};
                                repeatEvent = null;
                                return result;
                            }
                            return ctx.cfg.iter.next(state);
                        },
                        async peek()
                        {
                            if (repeatEvent) return {value: repeatEvent};
                            return ctx.cfg.iter.peek();
                        }
                    }
                },
                /*called*/ false)
        };
    }
    if (delayResult.success)
    {
        preHaltIgnoredEffects(ctx);
        return {ret: true};
    }
    return {};
}

// TODO(doubles): handle multiple targets
/**
 * Checks for and acts upon any pre-hit blocking effects and abilities. Result
 * has `#success=true` if the move was blocked.
 */
async function checkBlock(ctx: MoveContext): Promise<parsers.SuccessResult>
{
    // check for a block event due to an effect
    const next = await tryPeek(ctx.cfg);
    if (next?.type === "block" && next.effect !== "substitute" &&
        addTarget(ctx, next.monRef))
    {
        if (next.effect === "magicCoat")
        {
            const mon = ctx.cfg.state.teams[next.monRef].active;
            // verify magiccoat and reflectable flags
            if (!mon.volatile.magicCoat || ctx.called === "bounced" ||
                !ctx.move.data.flags?.reflectable)
            {
                return {};
            }
            handleBlock(ctx);
            await base.block(ctx.cfg);
            return {
                ...await expectBouncedMove(ctx, next.monRef),
                success: true
            };
        }
        // normal block event (safeguard, protect, etc)
        // this may also include endure due to weird PS event ordering
        if (next.effect !== "endure")
        {
            handleBlock(ctx);
            await base.block(ctx.cfg);
            return {success: true};
        }
        await base.block(ctx.cfg);
    }
    else if (next?.type === "miss" && addTarget(ctx, next.monRef))
    {
        handleBlock(ctx);
        await base.miss(ctx.cfg);
        return {success: true};
    }
    else if (next?.type === "immune" && addTarget(ctx, next.monRef))
    {
        handleBlock(ctx);
        handleTypeEffectiveness(ctx, "immune");
        await base.immune(ctx.cfg);
        return {success: true};
    }

    // check for a blocking ability
    // TODO(doubles): multiple eligible targets
    let success: boolean | undefined;
    const targetRef = otherSide(ctx.userRef);
    if (!ctx.failed && !ctx.pendingTargets[ctx.userRef] &&
        ctx.totalTargets > 0 && addTarget(ctx, targetRef))
    {
        // ability blocking
        // TODO: precedence with regard to type resist berries, and others?
        const expectResult = await ability.onBlock(ctx.cfg, {[targetRef]: true},
                ctx);
        for (const abilityResult of expectResult.results)
        {
            // handle block results
            // TODO: if wonderguard, assert type effectiveness
            success ||= abilityResult.immune || abilityResult.failed;
            // in the event that success=false, block parts of the move that the
            //  ability takes issue with
            ctx.blockStatus =
                {...ctx.blockStatus, ...abilityResult.blockStatus};
        }
        if (success) handleBlock(ctx);
    }
    return {...success && {success: true}};
}

/**
 * Dispatches move effects and hits.
 * @param miss Whether the move missed on the first accuracy check, which can
 * affect certain moves.
 */
async function execute(ctx: MoveContext, miss?: boolean):
    Promise<SubParserResult>
{
    if (!miss)
    {
        await hitLoop(ctx);
        await otherEffects(ctx);
        handleImplicitEffects(ctx);
    }
    await handleFaint(ctx, miss);
    if (!miss) await handleFinalEffects(ctx);
    return {};
}

/** Handles the possibly multiple hits from a move. */
async function hitLoop(ctx: MoveContext): Promise<SubParserResult>
{
    const maxHits = ctx.move.data.multihit?.[1] ?? 1;
    let multihitEnded: boolean | undefined; // presence of hitcount event
    for (let i = 0; i < maxHits; ++i)
    {
        // handle pre-hit, hit, and post-hit effects
        if (ctx.move.data.category !== "status")
        {
            const preHitResult = await preHit(ctx);
            const hitResult = await hit(ctx);
            if (preHitResult.resistSuper && hitResult.effectiveness !== "super")
            {
                throw new Error("Move effectiveness expected to be 'super' " +
                    `but got '${hitResult.effectiveness}'`);
            }
            handleTypeEffectiveness(ctx, hitResult.effectiveness);
        }
        await postHit(ctx);

        // check for hitcount event to terminate hit loop
        const hitCountResult = await checkHitCount(ctx, i + 1);
        if (hitCountResult.success)
        {
            multihitEnded = true;
            break;
        }
    }
    if (ctx.move.data.multihit && !multihitEnded)
    {
        throw new Error("Expected HitCount event to terminate multi-hit move");
    }
    return {};
}

/**
 * Checks for a `HitCount` event.
 * @param hits Current number of hits.
 */
async function checkHitCount(ctx: MoveContext, hits: number):
    Promise<parsers.SuccessResult>
{
    const event = await tryPeek(ctx.cfg);
    if (event?.type === "hitCount")
    {
        if (hits !== event.count || !addTarget(ctx, event.monRef))
        {
            throw new Error("Invalid HitCount event: expected " +
                `non-'${ctx.userRef}' ${hits} but got '${event.monRef}' ` +
                event.count);
        }
        await base.hitCount(ctx.cfg);
        return {success: true};
    }
    return {};
}

/** Result of `preHit()`. */
interface PreHitResult extends SubParserResult
{
    /** Resist berry type. */
    resistSuper?: dexutil.Type;
}

/** Check for pre-hit modifier events. */
async function preHit(ctx: MoveContext): Promise<PreHitResult>
{
    // check for resist berry effect
    let resistSuper: dexutil.Type | undefined;
    const itemPreHitResult = await consumeItem.consumeOnPreHit(ctx.cfg,
        {[otherSide(ctx.userRef)]: true}, ctx);
    for (const result of itemPreHitResult.results)
    {
        resistSuper ||= result.resistSuper;
        if (resistSuper) break;
    }
    return {...resistSuper && {resistSuper}};
}

/** Result of `hit()`. */
interface HitResult extends SubParserResult
{
    /** Whether the damage was blocked by a Substitute. */
    substitute?: true;
    /** Type effectiveness of the move. */
    effectiveness: Effectiveness;
}

/** Handles move damage modifier events, e.g. crits and type effectiveness. */
async function hit(ctx: MoveContext): Promise<HitResult>
{
    let effectiveness: Effectiveness = "regular";
    let damaged: boolean | "substitute" | undefined;
    let crit: boolean | undefined;
    const result = await eventLoop(ctx.cfg, async function hitEventLoop(cfg)
    {
        const event = await peek(cfg)
        const _ctx = {...ctx, cfg};
        switch (event.type)
        {
            // TODO: support multi-hit moves
            case "activateStatusEffect":
                // substitute could break after blocking
                if (event.effect !== "substitute" || event.start) break;
                if (_ctx.userRef === event.monRef) break;
                if (damaged !== "substitute") break;
                if (!addTarget(_ctx, event.monRef)) break;
                return await base.activateStatusEffect(cfg);
            case "block":
                if (event.effect !== "substitute") break;
                if (_ctx.userRef === event.monRef) break;
                if (damaged) break;
                if (!addTarget(_ctx, event.monRef)) break;
                if (_ctx.move.data.flags?.ignoreSub)
                {
                    // istanbul ignore next: can't reproduce until gen5 with
                    //  damaging sub-ignoring moves
                    throw new Error("Substitute-ignoring move shouldn't have " +
                        "been blocked by Substitute");
                }
                damaged = "substitute";
                return await base.block(cfg);
            case "crit":
                if (_ctx.userRef === event.monRef) break;
                if (crit) break;
                if (!addTarget(_ctx, event.monRef)) break;
                crit = true;
                return await base.crit(cfg);
            case "resisted":
                if (_ctx.userRef === event.monRef) break;
                if (effectiveness !== "regular") break;
                if (!addTarget(_ctx, event.monRef)) break;
                effectiveness = "resist";
                return await base.resisted(cfg);
            case "superEffective":
                if (_ctx.userRef === event.monRef) break;
                if (effectiveness !== "regular") break;
                if (!addTarget(_ctx, event.monRef)) break;
                effectiveness = "super";
                return await base.superEffective(cfg);
            case "takeDamage":
            {
                // main move damage
                if (event.from || _ctx.userRef === event.monRef) break;
                if (damaged) break;
                if (!addTarget(_ctx, event.monRef,
                    /*damaged*/ event.hp <= 0 ? "ko" : true))
                {
                    break;
                }
                const mon = cfg.state.teams[event.monRef].active;
                const fullHP = mon.hp.current >= mon.hp.max;
                damaged = true;
                await base.takeDamage(cfg);
                // if the target was at full hp before being deducted, we should
                //  check for focussash-like items that activate on one-hit KOs
                if (fullHP)
                {
                    await consumeItem.consumeOnTryOHKO(cfg,
                        {[event.monRef]: true});
                }
                return {};
            }
        }
        return {};
    });

    // TODO: include damage dealt for drain/recoil handling
    return {
        ...result, ...(damaged === "substitute" && {substitute: true}),
        effectiveness
    };
}

/** Handles move effects after the move officially hits. */
async function postHit(ctx: MoveContext): Promise<SubParserResult>
{
    const moveEffects = ctx.move.data.effects;
    if (moveEffects?.count)
    {
        // TODO: if perish, infer soundproof if the counter doesn't take
        //  place at the end of the turn
        const countResult = await parsers.countStatus(ctx.cfg, ctx.userRef,
                moveEffects.count);
        if (!countResult.success)
        {
            throw new Error("Expected effect that didn't happen: " +
                `countStatus ${moveEffects.count}`);
        }
    }
    if (moveEffects?.damage?.type === "split") await handleSplitDamage(ctx);
    // TODO: some weird contradictory ordering when testing on PS is
    //  reflected here, should the PSEventHandler re-order them or should
    //  the dex make clearer distinguishments for these specific effects?
    // self-heal generally happens before status (e.g. roost)
    if (moveEffects?.damage?.type === "percent" &&
        moveEffects.damage.percent > 0)
    {
        await handlePercentDamage(ctx, moveEffects?.damage);
    }
    // charge message happens after boost so handle it earlier in this
    //  specific case
    if (moveEffects?.status?.self?.includes("charge"))
    {
        await handleBoost(ctx, moveEffects?.boost);
    }
    // move status effects
    await handleStatus(ctx);
    // untracked statuses
    await eventLoop(ctx.cfg, async function statusLoop(cfg)
    {
        const event = await peek(cfg);
        if (event.type !== "activateStatusEffect") return {};

        let accept = false;
        switch (event.effect)
        {
            case "confusion": case "leechSeed":
                // can be removed by a different move, but currently not
                //  tracked yet (TODO)
                accept = !event.start;
                break;
            default:
                if (dexutil.isMajorStatus(event.effect))
                {
                    // TODO: also track curing moves
                    // for now, curing moves are ignored and silently
                    //  passed
                    accept = !event.start;
                }
        }
        if (!accept) return {};
        return await base.activateStatusEffect(cfg);
    });
    // self-damage generally happens after status effects (e.g. curse,
    //  substitute)
    if (moveEffects?.damage?.type === "percent" &&
        moveEffects.damage.percent < 0)
    {
        await handlePercentDamage(ctx, moveEffects?.damage);
    }
    // boost generally happens after damage effects (e.g. bellydrum)
    if (!moveEffects?.status?.self?.includes("charge"))
    {
        await handleBoost(ctx, moveEffects?.boost);
    }
    if (ctx.move.data.category !== "status")
    {
        // drain effect
        if (moveEffects?.drain)
        {
            // see if an ability interrupts the drain effect
            let blocked: boolean | undefined;
            const expectResult = await ability.onMoveDrain(ctx.cfg,
                {[otherSide(ctx.userRef)]: true}, ctx);
            for (const abilityResult of expectResult.results)
            {
                blocked ||= abilityResult.invertDrain;
                if (blocked) break;
            }

            if (!blocked)
            {
                // TODO: no drain msg if attack did 0 damage
                const damageResult = await parsers.damage(ctx.cfg,
                    ctx.userRef, "drain", /*sign*/ 1);
                if (!damageResult.success)
                {
                    throw new Error("Expected effects that didn't " +
                        "happen: drain " +
                        `${moveEffects.drain[0]}/${moveEffects.drain[1]}`);
                }
                await parsers.update(ctx.cfg);
            }
        }

        // check for target effects

        // TODO: track actual move targets
        const holderRef = otherSide(ctx.userRef);
        const holder = ctx.cfg.state.teams[holderRef].active;

        // consumeOn-super item (enigmaberry)
        // doesn't work if fainted
        if (!holder.fainted)
        {
            await consumeItem.consumeOnSuper(ctx.cfg, {[holderRef]: true}, ctx);
        }

        // see if an on-moveDamage variant ability will activate
        // note: still works if fainted
        const flags = ctx.mentionedTargets.get(holderRef);
        // choose category with highest precedence
        let qualifier: "damage" | "contact" | "contactKO" | undefined;
        if (ctx.move.data.flags?.contact)
        {
            if (flags?.damaged === "ko") qualifier = "contactKO";
            else if (flags?.damaged) qualifier = "contact";
        }
        else if (flags?.damaged) qualifier = "damage";
        if (qualifier)
        {
            await ability.onMoveDamage(ctx.cfg, {[holderRef]: true}, qualifier,
                ctx);
        }

        // consumeOn-postHit item (jabocaberry/rowapberry)
        // note: still works if fainted
        await consumeItem.consumeOnPostHit(ctx.cfg, {[holderRef]: true}, ctx);
    }
    // make sure no more items need to activate
    return await parsers.update(ctx.cfg);
}

/** Handles other effects of a move apart from status/boost/damage. */
async function otherEffects(ctx: MoveContext): Promise<SubParserResult>
{
    const moveEffects = ctx.move.data.effects;

    // TODO: verify order, or stop it from being enforced
    if (moveEffects?.swapBoosts)
    {
        const targetRef = otherSide(ctx.userRef);
        const swapResult = await parsers.swapBoosts(ctx.cfg, ctx.userRef,
                targetRef, moveEffects.swapBoosts);
        if (!swapResult.success)
        {
            throw new Error("Expected effect that didn't happen: " +
                "swapBoosts " +
                `[${Object.keys(moveEffects.swapBoosts).join(", ")}]`);
        }
    }
    if (moveEffects?.team)
    {
        for (const tgt of ["self", "hit"] as dexutil.MoveEffectTarget[])
        {
            const effectType = moveEffects.team[tgt];
            if (!effectType) continue;
            const targetRef = tgt === "self" ?
                ctx.userRef : otherSide(ctx.userRef);
            const teamResult = await parsers.teamEffect(ctx.cfg, ctx.user,
                    targetRef, effectType);
            if (!teamResult.success)
            {
                throw new Error("Expected effect that didn't happen: " +
                    `${tgt} team ${effectType}`);
            }
        }
    }
    // unsupported team effects
    await eventLoop(ctx.cfg, async function teamLoop(cfg)
    {
        const event = await peek(cfg);
        if (event.type !== "activateTeamEffect") return {};

        let accept: boolean | undefined;
        switch (event.effect)
        {
            case "spikes": case "stealthRock": case "toxicSpikes":
                // TODO: cover hazard removal moves
                accept = !event.start;
                break;
            case "lightScreen": case "reflect":
                // TODO: cover screens removal moves
                accept = !event.start && event.teamRef !== ctx.userRef;
                break;
        }
        if (!accept) return {};
        return await base.activateTeamEffect(cfg);
    });
    if (moveEffects?.field)
    {
        const fieldResult = await parsers.fieldEffect(ctx.cfg, ctx.user,
                moveEffects.field.effect, moveEffects.field.toggle);
        if (!fieldResult.success)
        {
            throw new Error("Expected effect that didn't happen: " +
                `field ${moveEffects.field.effect}` +
                (moveEffects.field.toggle ? " toggle" : ""));
        }
    }
    if (moveEffects?.changeType)
    {
        await expectChangeType(ctx, moveEffects.changeType);
    }
    if (moveEffects?.disableMove) await expectDisable(ctx);
    // TODO: item removal effects
    await eventLoop(ctx.cfg, async function removeItemLoop(cfg)
    {
        // TODO: track effects that can cause this
        const event = await peek(cfg);
        if (event.type !== "removeItem" || event.consumed !== false) return {};
        return await base.removeItem(cfg);
    });

    return {};
}

/**
 * Handles expected faint events from the targets of the current move, as well
 * as self-fainting.
 * @param miss Whether the move missed or was blocked, which can affect certain
 * self-faint moves.
 */
async function handleFaint(ctx: MoveContext, miss?: boolean):
    Promise<SubParserResult>
{
    const faintCandidates = new Set<Side>();
    for (const [monRef, flags] of ctx.mentionedTargets)
    {
        if (flags.damaged !== "ko") continue;
        faintCandidates.add(monRef);
    }
    const selfFaint = ctx.move.data.effects?.selfFaint;
    if (ctx.user.fainted || selfFaint === "always" ||
        (selfFaint === "ifHit" && !miss))
    {
        faintCandidates.add(ctx.userRef);
    }

    return await expectFaints(ctx, faintCandidates);
}

/**
 * Expects a set of faint messages.
 * @param monRefs Pokemon references that should faint. These are removed from
 * the Set whenever this function handles a faint event.
 */
async function expectFaints(ctx: MoveContext, monRefs: Set<Side>):
    Promise<SubParserResult>
{
    if (monRefs.size <= 0) return {};
    await eventLoop(ctx.cfg, async function faintLoop(cfg)
    {
        const event = await peek(cfg);
        if (event.type !== "faint") return {};
        if (!monRefs.has(event.monRef)) return {}
        await base.faint(ctx.cfg);
        monRefs.delete(event.monRef);
        return {};
    });
    if (monRefs.size > 0)
    {
        throw new Error(`Pokemon [${[...monRefs].join(", ")}] haven't ` +
            "fainted yet");
    }
    return {};
}

/**
 * Handles terminating move effects that happen after handling initial faint
 * checks.
 */
async function handleFinalEffects(ctx: MoveContext): Promise<SubParserResult>
{
    if ((await handleRecoil(ctx)).permHalt) return {permHalt: true};
    if ((await handleItemMovePostDamage(ctx)).permHalt) return {permHalt: true};
    if ((await handleTransform(ctx)).permHalt) return {permHalt: true};
    if ((await handleSelfSwitch(ctx)).permHalt) return {permHalt: true};
    if ((await handleMoveCall(ctx)).permHalt) return {permHalt: true};
    return {};
}

async function handleRecoil(ctx: MoveContext): Promise<SubParserResult>
{
    // TODO: faint between each of these
    const data = ctx.move.data.effects?.recoil;
    if (!data) return {};
    const damageResult = await parsers.damage(ctx.cfg, ctx.userRef, "recoil",
        /*sign*/ -1);
    if (damageResult.success !== "silent" && !data.struggle)
    {
        recoil(ctx, /*consumed*/ !!damageResult.success);
    }
    if (damageResult.permHalt) return {permHalt: true};
    if (damageResult.success === true)
    {
        let result: SubParserResult;
        // berries can activate directly after receiving recoil damage
        if (!ctx.user.fainted) result = await parsers.update(ctx.cfg);
        // could also faint instead
        else result = await expectFaints(ctx, new Set([ctx.userRef]));
        if (result.permHalt) return {permHalt: true};
    }
    return {};
}

async function handleItemMovePostDamage(ctx: MoveContext):
    Promise<SubParserResult>
{
    if (!ctx.move.dealsBPDamage) return {};
    if (![...ctx.mentionedTargets.values()].some(f => f.damaged)) return {};
    if (ctx.user.fainted) return {};
    if ((await item.onMovePostDamage(ctx.cfg, {[ctx.userRef]: true})).permHalt)
    {
        return {permHalt: true};
    }
    if (ctx.user.fainted &&
        (await expectFaints(ctx, new Set([ctx.userRef]))).permHalt)
    {
        return {permHalt: true};
    }
    return {};
}

async function handleTransform(ctx: MoveContext): Promise<SubParserResult>
{
    if (!ctx.move.data.effects?.transform || ctx.user.fainted) return {};

    const next = await tryPeek(ctx.cfg);
    if (next?.type !== "transform")
    {
        throw new Error("Expected effect that didn't happen: transform");
    }
    if (next.source !== ctx.userRef)
    {
        throw new Error("Transform effect failed: " +
            `Expected source '${ctx.userRef}' but got '${next.source}'`);
    }
    if (!addTarget(ctx, next.target))
    {
        throw new Error("Transform effect failed");
    }
    return await base.transform(ctx.cfg);
}

async function handleSelfSwitch(ctx: MoveContext): Promise<SubParserResult>
{
    const effect = ctx.move.data.effects?.selfSwitch;
    if (!effect) return {};
    if (ctx.cfg.state.teams[ctx.userRef].pokemon.every(
            (mon, i) => i === 0 || mon?.fainted))
    {
        return {};
    }

    // gen4: self-faint self-switch moves (e.g. healingwish) send out the
    //  replacement immediately rather than waiting until the end of the turn
    if (ctx.user.fainted && !ctx.move.data.effects?.selfFaint) return {};

    const team = ctx.cfg.state.teams[ctx.userRef];
    team.status.selfSwitch = effect;

    const next = await tryPeek(ctx.cfg);
    if (next?.type !== "halt")
    {
        throw new Error("Expected effect that didn't happen: " +
            `selfSwitch '${effect}'`);
    }

    // if a self-switch move wins the game before switching, the game ends
    //  immediately while ignoring the self-switch effect
    if (next.reason === "gameOver") return {permHalt: true};

    const expectedReason = ctx.userRef === "us" ? "switch" : "wait";
    if (next.reason !== expectedReason)
    {
        throw new Error(`SelfSwitch effect '${effect}' failed: ` +
            `Expected halt reason '${expectedReason}' but got ` +
            `'${next.reason}'`);
    }

    // make sure all information is up to date before possibly
    //  requesting a decision
    preHaltIgnoredEffects(ctx);
    await base.halt(ctx.cfg);

    // TODO: communicate self-switch/healingwish effects to the function we're
    //  calling
    const switchResult = await expectSwitch(ctx.cfg, ctx.userRef);
    if (!switchResult.success)
    {
        throw new Error(`SelfSwitch effect '${effect}' failed`);
    }
    return switchResult;
}

async function handleMoveCall(ctx: MoveContext): Promise<SubParserResult>
{
    const call = ctx.move.data.effects?.call;
    if (!call) return {};
    if (!(await verifyCalledMove(ctx, ctx.userRef, call)).success) return {};
    return await base.useMove(ctx.cfg, /*called*/ true);
}

/**
 * Verifies a `useMove` BattleEvent in the context of a called move.
 * @param userRef User of the called move.
 * @param callEffect Rule string for how the move should be selected.
 */
async function verifyCalledMove(ctx: MoveContext, userRef: Side,
    callEffect: dexutil.CallType): Promise<parsers.SuccessResult>
{
    // can't do anything if fainted
    if (ctx.cfg.state.teams[userRef].active.fainted) return {};

    const next = await tryPeek(ctx.cfg);
    if (next?.type !== "useMove")
    {
        throw new Error("Expected effect that didn't happen: " +
            `call '${callEffect}'`);
    }
    if (next.monRef !== userRef)
    {
        throw new Error(`Call effect '${callEffect}' failed: ` +
            `Expected '${userRef}' but got '${next.monRef}'`);
    }

    switch (callEffect)
    {
        case true: break; // nondeterministic call
        case "copycat":
            if (ctx.lastMove !== next.move)
            {
                throw new Error("Call effect 'copycat' failed: " +
                    `Should've called '${ctx.lastMove}' but got ` +
                    `'${next.move}'`);
            }
            if (dex.moves[ctx.lastMove].flags?.noCopycat)
            {
                throw new Error("Call effect 'copycat' failed: " +
                    `Can't call move '${ctx.lastMove}' with flag ` +
                    "noCopycat=true");
            }
            break;
        case "mirror":
            if (ctx.user.volatile.mirrorMove !== next.move)
            {
                throw new Error("Call effect 'mirror' failed: Should've " +
                    `called '${ctx.user.volatile.mirrorMove}' but got ` +
                    `'${next.move}'`);
            }
            break;
        case "self":
            // calling a move that is part of the user's moveset
            if (!addTarget(ctx, userRef))
            {
                throw new Error("Call effect 'self' failed");
            }
            ctx.user.moveset.reveal(next.move);
            break;
        case "target":
        {
            // TODO: track actual target
            const targetRef = otherSide(userRef);
            if (!addTarget(ctx, targetRef))
            {
                throw new Error("Call effect 'target' failed");
            }
            ctx.cfg.state.teams[targetRef].active.moveset.reveal(next.move);
            break;
        }
        default:
            // regular string specifies the move that should be
            //  called
            // TODO: what if copycat is supposed to be called rather
            //  than the copycat effect?
            if (next.move !== callEffect)
            {
                throw new Error(`Call effect '${callEffect}' failed`);
            }
    }
    return {success: true};
}

/** Result from `expectDelay()`. */
interface DelayResult extends SubParserResult
{
    /**
     * Whether the effect was successful. If `"shorten"`, the move should be
     * expected to execute immediately.
     */
    success?: true | "shorten";
}

/** Expects a move delay effect if applicable. */
async function expectDelay(ctx: MoveContext): Promise<DelayResult>
{
    switch (ctx.move.data.effects?.delay?.type)
    {
        case "twoTurn":
        {
            if (!dex.isTwoTurnMove(ctx.moveName))
            {
                // istanbul ignore next: should never happen
                throw new Error(`Invalid two-turn move '${ctx.moveName}'`);
            }
            // can't expect event if releasing two-turn move, should instead get
            //  the damage()/postDamage() events
            if (ctx.releasedTwoTurn) break;

            const next = await tryPeek(ctx.cfg);
            if (next?.type !== "prepareMove" || next.monRef !== ctx.userRef)
            {
                throw new Error(`TwoTurn effect '${ctx.moveName}' failed`);
            }
            if (next.move !== ctx.moveName)
            {
                throw new Error(`TwoTurn effect '${ctx.moveName}' failed: ` +
                    `Expected '${ctx.moveName}' but got '${next.move}'`);
            }
            await base.prepareMove(ctx.cfg);

            // TODO: move shorten logic to base prepareMove handler?

            // check solar move (suppressed by airlock/cloudnine)
            let suppressWeather: boolean | undefined;
            for (const monRef of ["us", "them"] as Side[])
            {
                const mon = ctx.cfg.state.teams[monRef].active;
                if (dex.abilities[mon.ability]?.flags?.suppressWeather)
                {
                    suppressWeather = true;
                    break;
                }
            }
            let shorten = !suppressWeather &&
                ctx.move.data.effects?.delay.solar &&
                ctx.cfg.state.status.weather.type === "SunnyDay";
            // check for powerherb
            if (!shorten)
            {
                // expect consumeOn-moveCharge item
                const chargeResult = await consumeItem.consumeOnMoveCharge(
                        ctx.cfg, {[ctx.userRef]: true});
                for (const consumeResult of chargeResult.results)
                {
                    shorten ||= consumeResult.shorten;
                }
            }

            return {success: shorten ? "shorten" : true};
        }
        case "future":
        {
            if (!dex.isFutureMove(ctx.moveName))
            {
                // istanbul ignore next: should never happen
                throw new Error(`Invalid future move '${ctx.moveName}'`);
            }
            // can't expect event if future move already active, should instead
            //  fail the move
            if (ctx.cfg.state.teams[ctx.userRef].status
                .futureMoves[ctx.moveName].isActive)
            {
                break;
            }

            const next = await tryPeek(ctx.cfg);
            if (next?.type !== "futureMove" || !next.start)
            {
                throw new Error(`Future effect '${ctx.moveName}' failed`);
            }
            if (next.move !== ctx.moveName)
            {
                throw new Error(`Future effect '${ctx.moveName}' failed: ` +
                    `Expected '${ctx.moveName}' but got '${next.move}'`);
            }
            return {
                ...await base.futureMove(ctx.cfg), success: true
            };
        }
    }
    return {};
}

/**
 * Handles type effectiveness assertions, even for status moves.
 * @param effectiveness Type effectiveness.
 */
function handleTypeEffectiveness(ctx: MoveContext,
    effectiveness: Effectiveness): void
{
    // TODO: need to handle all corner cases
    // TODO(doubles): do this for each defender
    void ctx, effectiveness;
}

/** Handles the status effects of a move. */
async function handleStatus(ctx: MoveContext): Promise<SubParserResult>
{
    for (const tgt of ["self", "hit"] as dexutil.MoveEffectTarget[])
    {
        // try to parse any possible status effect from the move
        const statusTypes = ctx.move.getAllStatusEffects(tgt, ctx.user.types);
        if (statusTypes.length <= 0) continue;

        // status effect for target was blocked
        if (tgt === "hit" && ctx.blockStatus &&
            statusTypes.some(s => ctx.blockStatus![s]))
        {
            continue;
        }

        // can't inflict status if about to faint
        const targetRef = tgt === "self" ? ctx.userRef : otherSide(ctx.userRef);
        const target = ctx.cfg.state.teams[targetRef].active;
        if (target.hp.current <= 0) continue;

        if (tgt === "hit")
        {
            // substitute blocks status conditions
            if (!ctx.move.data.flags?.ignoreSub && target.volatile.substitute)
            {
                continue;
            }
        }

        // expect status effects
        const statusResult = await parsers.peekStatus(ctx.cfg, targetRef,
                statusTypes);
        // if no statuses happened, target must have an ability immunity
        if (!statusResult.success) statusImmunity(ctx, targetRef);
        // verify if imprison was successful
        else if (statusResult.success === "imprison")
        {
            imprison(ctx, /*failed*/ false);
        }
        // after verifying the status event with our own additional assertions,
        //  we can now safely handle it if it wasn't silent
        if (typeof statusResult.success === "string")
        {
            await dispatch(ctx.cfg);
            // also check for item updates
            await parsers.update(ctx.cfg);
        }
    }

    return {};
}

/** Handles the split-damage effect of a move (e.g. painsplit). */
async function handleSplitDamage(ctx: MoveContext): Promise<SubParserResult>
{
    let usMentioned = false;
    let targetMentioned = false;
    await eventLoop(ctx.cfg, async function splitDamageLoop(cfg)
    {
        const event = await peek(cfg);
        if (event.type !== "takeDamage") return {};
        if (event.from) return {};
        if (event.monRef !== ctx.userRef)
        {
            if (targetMentioned || !addTarget(ctx, event.monRef)) return {};
            targetMentioned = true;
        }
        else if (usMentioned) return {};
        else usMentioned = true;
        return await base.takeDamage(ctx.cfg);
    });
    return await parsers.update(ctx.cfg);
}

/** Handles the percent-damage/heal effects of a move. */
async function handlePercentDamage(ctx: MoveContext,
    effect?: NonNullable<dexutil.MoveData["effects"]>["damage"]):
    Promise<SubParserResult>
{
    // shouldn't activate if non-ghost type and ghost flag is set
    if (!effect || effect.type !== "percent" ||
        (effect.ghost && !ctx.user.types.includes("ghost")))
    {
        return {};
    }
    // TODO(doubles): actually track targets
    const targetRef = effect.target === "self" ?
        ctx.userRef : otherSide(ctx.userRef);
    const damageResult = await parsers.percentDamage(ctx.cfg, targetRef,
            effect.percent);
    if (!damageResult.success)
    {
        throw new Error("Expected effect that didn't happen: " +
            `${effect.target} percentDamage ${effect.percent}%`);
    }
    return damageResult;
}

/** Handles the boost effects of a move. */
async function handleBoost(ctx: MoveContext,
    effect?: NonNullable<dexutil.MoveData["effects"]>["boost"]):
    Promise<SubParserResult>
{
    // shouldn't activate if ghost type and noGhost flag is set
    if (!effect || (effect.noGhost && ctx.user.types.includes("ghost")))
    {
        return {};
    }
    const chance = effect.chance;
    for (const tgt of ["self", "hit"] as dexutil.MoveEffectTarget[])
    {
        const table = effect[tgt];
        if (!table) continue;
        const targetRef = tgt === "self" ? ctx.userRef : otherSide(ctx.userRef);
        const target = ctx.cfg.state.teams[targetRef].active;
        // can't boost target if about to faint
        if (target.hp.current <= 0) continue;
        if (tgt === "hit")
        {
            // substitute blocks boosts
            if (!ctx.move.data.flags?.ignoreSub && target.volatile.substitute)
            {
                continue;
            }
        }
        const boostResult = await moveBoost(ctx, targetRef, table, chance,
                effect.set);
        if (Object.keys(boostResult.remaining).length > 0 && !effect.chance)
        {
            throw new Error("Expected effect that didn't happen: " +
                `${tgt} boost ${effect.set ? "set" : "add"} ` +
                JSON.stringify(boostResult.remaining));
        }
    }
    return {};
}

/**
 * Handles events due to a move's Boost effect.
 * @param targetRef Target pokemon reference receiving the boosts.
 * @param boosts Boost table.
 * @param chance Chance of the effect happening, or undefined if guaranteed.
 * @param set Whether boosts are being added or set.
 */
async function moveBoost(ctx: MoveContext, targetRef: Side,
    boosts: Partial<dexutil.BoostTable>, chance?: number, set?: boolean):
    Promise<parsers.BoostResult>
{
    // can't do anything if fainted
    if (ctx.cfg.state.teams[targetRef].active.fainted) return {remaining: {}};

    const table = {...boosts};

    // see if the target's ability blocks the boost effect
    if (targetRef !== ctx.userRef && !set)
    {
        const expectResult = await ability.onTryUnboost(ctx.cfg,
                {[targetRef]: true}, ctx);
        // only one ability should activate
        if (expectResult.results.length === 1)
        {
            // remove blocked boosts from the pending boost table
            const abilityResult = expectResult.results[0];
            if (abilityResult.blockUnboost)
            {
                for (const b in abilityResult.blockUnboost)
                {
                    if (!abilityResult.blockUnboost.hasOwnProperty(b))
                    {
                        continue;
                    }
                    delete table[b as dexutil.BoostName];
                }
            }
        }
    }
    // effect should pass silently
    if (Object.keys(table).length <= 0) return {remaining: {}};

    const boostResult = await parsers.boost(ctx.cfg, targetRef,
            table, set, /*silent*/ true);

    if ((chance == null || chance >= 100) &&
        Object.keys(boostResult.remaining).length > 0)
    {
        throw new Error("Expected effect that didn't happen: " +
            `${targetRef === ctx.userRef ? "self" : "hit"} boost ` +
            `${set ? "set" : "add"} ${JSON.stringify(boostResult.remaining)}`);
    }
    return boostResult;
}

/**
 * Expects a changeType effect for the move user.
 * @param effect Type of effect.
 */
async function expectChangeType(ctx: MoveContext, effect: "conversion"):
    Promise<SubParserResult>
{
    // can't do anything if fainted
    if (ctx.user.fainted) return {};

    const next = await tryPeek(ctx.cfg);
    if (next?.type !== "changeType")
    {
        throw new Error("Expected effect that didn't happen: " +
            `changeType '${effect}'`);
    }
    if (!addTarget(ctx, next.monRef))
    {
        throw new Error(`ChangeType effect '${effect}' failed`);
    }
    // TODO: track type change effects: camouflage, conversion2
    // for now only conversion is tracked, which changes the user's type into
    //  that of a known move
    // note: conversion move treats modifyType moves as their default type
    ctx.user.moveset.addMoveSlotConstraint(dex.typeToMoves[next.newTypes[0]]);
    return await base.changeType(ctx.cfg);
}

/** Expects a disableMove effect. */
async function expectDisable(ctx: MoveContext): Promise<SubParserResult>
{
    const next = await tryPeek(ctx.cfg);
    if (next?.type !== "disableMove")
    {
        throw new Error("Expected effect that didn't happen: disableMove");
    }
    if (!addTarget(ctx, next.monRef))
    {
        throw new Error("DisableMove effect failed");
    }
    return await base.disableMove(ctx.cfg);
}

/**
 * Expects the move to be reflected onto the user by the opponent.
 * @param userRef New move user.
 */
async function expectBouncedMove(ctx: MoveContext, userRef: Side):
    Promise<SubParserResult>
{
    if ((await verifyCalledMove(ctx, userRef, ctx.moveName)).success)
    {
        return await base.useMove(ctx.cfg, /*called*/ "bounced");
    }
    return {};
}

// inference helper functions

/** Infers move targets. */
function inferTargets(ctx: MoveContext): void
{
    // TODO(doubles): this may be more complicated or just ignored
    const opponent = otherSide(ctx.userRef);
    if (ctx.pendingTargets[opponent]) addTarget(ctx, opponent);
    if (ctx.pendingTargets[ctx.userRef]) addTarget(ctx, ctx.userRef);
}

/**
 * Indicates that the BattleEvents mentioned a target for the current move.
 * @param damaged Whether the pokemon was damaged directly (true) or KO'd
 * ('"ko"`).
 * @returns False on error, true otherwise.
 */
function addTarget(ctx: MoveContext, targetRef: Side,
    damaged: boolean | "ko" = false): boolean
{
    let flags = ctx.mentionedTargets.get(targetRef);
    // already mentioned target earlier
    if (flags)
    {
        // update damaged status if higher precedence (ko > true > false)
        if (damaged && (!flags.damaged || damaged === "ko"))
        {
            flags.damaged = damaged;
        }
    }
    else
    {
        // assertions about the move target
        if (!ctx.pendingTargets[targetRef])
        {
            ctx.cfg.logger.error(`Mentioned target '${targetRef}' but the ` +
                `current move '${ctx.moveName}' can't target it`);
            return false;
        }
        if (ctx.mentionedTargets.size >= ctx.totalTargets)
        {
            ctx.cfg.logger.error("Can't add more targets. Already " +
                `mentioned ${ctx.mentionedTargets.size} ` +
                (ctx.mentionedTargets.size > 0 ?
                    `('${[...ctx.mentionedTargets].join("', '")}') ` : "") +
                `but trying to add '${targetRef}'.`);
            return false;
        }

        ctx.mentionedTargets.set(targetRef,
            flags = {...(!!damaged && {damaged})});
    }

    // TODO: fainting prior to the move should cause active to be null so this
    //  check isn't as complicated
    const target = ctx.cfg.state.teams[targetRef].active;
    if (flags.damaged) target.volatile.damaged = true;
    if (ctx.user !== target && (!target.fainted || flags.damaged === "ko"))
    {
        // update opponent's mirror move tracker
        if (ctx.mirror) target.volatile.mirrorMove = ctx.moveName;

        // deduct an extra pp if the target has pressure
        // TODO(gen>=5): don't count allies
        if (!flags.pressured && ctx.moveState &&
            !target.volatile.suppressAbility && target.ability === "pressure" &&
            // only ability that can cancel pressure
            // TODO: use ignoreTargetAbility flag
            ctx.user.ability !== "moldbreaker")
        {
            ctx.moveState.pp -= 1;
            flags.pressured = true;
        }

        if (target.volatile.substitute && !ctx.move.data.flags?.ignoreSub &&
            flags.damaged)
        {
            throw new Error("Move should've been blocked by target's " +
                "Substitute");
        }
    }

    return true;
}

/** Handles the implications of a move failing. */
function handleFail(ctx: MoveContext): void
{
    // TODO: add MoveData field to support this move
    if (ctx.moveName === "naturalgift") naturalGift(ctx, /*failed*/ true);

    // imprison move failed, make inferences based on fail conditions
    if (ctx.move.data.effects?.status?.self?.includes("imprison") &&
        !ctx.move.data.effects.status.chance)
    {
        imprison(ctx, /*failed*/ true);
    }

    // non-called moves affect the stall counter
    if (!ctx.called) ctx.user.volatile.stall(false);

    // clear continuous moves
    ctx.user.volatile.lockedMove.reset();
    ctx.user.volatile.rollout.reset();

    // when the move fails, micle status is silently ended
    ctx.user.volatile.micleberry = false;

    // TODO: verify other implications
}

/** Handles the implications of a move lacking a target. */
function handleNoTarget(ctx: MoveContext): void
{
    // non-called moves affect the stall counter
    if (!ctx.called) ctx.user.volatile.stall(false);

    // clear continuous moves
    ctx.user.volatile.lockedMove.reset();
    ctx.user.volatile.rollout.reset();

    // TODO: verify other implications
}

/** Handles the implications of a move being blocked by an effect. */
function handleBlock(ctx: MoveContext): void
{
    // non-called moves affect the stall counter
    if (!ctx.called) ctx.user.volatile.stall(false);

    // interrupted momentum move
    // TODO(gen>=5): also reset rampage move
    ctx.user.volatile.rollout.reset();
}

/** Handles implicit move effects, consuming most remaining flags. */
function handleImplicitEffects(ctx: MoveContext): void
{
    if (ctx.moveName === "naturalgift") naturalGift(ctx, /*failed*/ false);

    let lockedMove = false;
    const {lockedMove: lock} = ctx.user.volatile;
    switch (ctx.move.data.implicit?.status)
    {
        case "defenseCurl": case "minimize": case "mustRecharge":
            ctx.user.volatile[ctx.move.data.implicit.status] = true;
            break;
        case "lockedMove":
            if (!dex.isLockedMove(ctx.moveName))
            {
                // istanbul ignore next: should never happen
                throw new Error(`Invalid locked move ${ctx.moveName}`);
            }
            // continue locked status
            // already prevented from consuming pp in constructor
            if (lock.type === ctx.moveName) lock.tick();
            // start locked status
            else lock.start(ctx.moveName, !!ctx.called);
            lockedMove = true;
            break;
    }
    // if the locked move was called, then this current context is the one that
    //  called the move so we shouldn't reset it
    if (!lockedMove && (lock.turns !== 0 || !lock.called)) lock.reset();

    // TODO: add rollout to implicit status above
    const {rollout} = ctx.user.volatile;
    if (dexutil.isRolloutMove(ctx.moveName))
    {
        // TODO: add rollout moves to ImplicitStatusEffect
        // start/continue rollout status
        // already prevented from consuming pp in constructor if continuing
        if (rollout.type === ctx.moveName) rollout.tick();
        else rollout.start(ctx.moveName, !!ctx.called);
    }
    // must've missed the status ending
    // if the rollout move was called, then this current context is the one that
    //  called the move so we shouldn't reset it
    else if (rollout.turns !== 0 || !rollout.called) rollout.reset();

    // team effects

    const team = ctx.cfg.state.teams[ctx.userRef];
    switch (ctx.move.data.implicit?.team)
    {
        case "healingWish": case "lunarDance":
            team.status[ctx.move.data.implicit.team] = true;
            break;
        // wish can be used consecutively, but only the first use counts
        case "wish":
            team.status.wish.start(/*restart*/false);
            break;
    }

    preHaltIgnoredEffects(ctx);
}

/**
 * Handles ignored effects prior to a halt event, where a possible switch
 * decision could be requested which would require all information to be up to
 * date.
 */
function preHaltIgnoredEffects(ctx: MoveContext): void
{
    if (ctx.ignoredHandled) return;
    ctx.ignoredHandled = true;

    // reset stall counter if it wasn't updated this turn
    if (!ctx.called && !ctx.user.volatile.stalling)
    {
        ctx.user.volatile.stall(false);
    }
}

// TODO: refactor to use EventInference helpers
/**
 * Infers an implicit status immunity. Assumes the move's effect couldn't have
 * been silently consumed.
 * @param targetRef Target that was supposed to receive the move's status
 * effect.
 */
function statusImmunity(ctx: MoveContext, targetRef: Side): void
{
    // get guaranteed status effects
    const tgt = targetRef === ctx.userRef ? "self" : "hit";
    const statuses = ctx.move.getGuaranteedStatusEffects(tgt, ctx.user.types);
    if (statuses.length <= 0) return;

    // moldbreaker check
    const user = ctx.user;
    const userAbility = user.traits.ability;
    if (!user.volatile.suppressAbility &&
        [...userAbility.possibleValues].every(
            n => userAbility.map[n].flags?.ignoreTargetAbility))
    {
        throw new Error(`Move '${ctx.moveName}' user '${ctx.userRef}' has ` +
            "ability-ignoring ability " +
            `[${[...userAbility.possibleValues].join(", ")}] but status ` +
            `[${statuses.join(", ")}] was still blocked by target ` +
            `'${targetRef}'`);
    }

    // the target must have a status immunity ability
    // make sure the ability isn't suppressed or we'll have a problem
    const target = ctx.cfg.state.teams[targetRef].active;
    if (target.volatile.suppressAbility)
    {
        throw new Error(`Move '${ctx.moveName}' status ` +
            `[${statuses.join(", ")}] was blocked by target '${targetRef}' ` +
            "but target's ability is suppressed");
    }

    // find abilities that grant applicable status immunities
    const targetAbility = target.traits.ability;
    // note: can consider immunities to either status if there are multiple
    //  possible statuses to afflict
    // TODO: rework api to allow for custom overnarrowing errors/recovery
    const filteredAbilities = [...targetAbility.possibleValues]
        .filter(n => statuses.some(s =>
                // TODO: some abilities distinguish between self/hit statuses
                dex.getAbility(targetAbility.map[n]).canBlockStatus(s,
                    ctx.cfg.state.status.weather.type)));
    if (filteredAbilities.length <= 0)
    {
        // overnarrowed error
        throw new Error(`Move '${ctx.moveName}' status ` +
            `[${statuses.join(", ")}] was blocked by target '${targetRef}' ` +
            "but target's ability " +
            `[${[...targetAbility.possibleValues].join(", ")}] can't block it`);
    }
    targetAbility.narrow(filteredAbilities);
}

/**
 * Handles the implications of Imprison succeeding or failing.
 * @param failed Whether the move failed.
 */
function imprison(ctx: MoveContext, failed: boolean): void
{
    // assume us is fully known, while them is unknown
    // TODO: what if both are unknown?
    const us = ctx.cfg.state.teams.us.active.moveset;
    const usMoves = [...us.moves.keys()];
    const them = ctx.cfg.state.teams.them.active.moveset;

    if (failed)
    {
        // imprison failed, which means both active pokemon don't have each
        //  other's moves
        // infer that the opponent doesn't have any of our moves

        // sanity check: opponent should not already have one of our moves
        const commonMoves = usMoves.filter(
            name => them.moves.has(name));
        if (commonMoves.length > 0)
        {
            throw new Error("Imprison failed but both Pokemon have " +
                `common moves: ${commonMoves.join(", ")}`);
        }

        // remove our moves from their move possibilities
        them.inferDoesntHave(usMoves);
    }
    else
    {
        // imprison succeeded, which means both active pokemon have at least one
        //  common move
        // infer that one of our moves has to be contained by the opponent's
        //  moveset

        // sanity check: opponent should have or be able to have at least one of
        //  our moves
        if (usMoves.every(name =>
            !them.moves.has(name) && !them.constraint.has(name)))
        {
            throw new Error("Imprison succeeded but both Pokemon " +
                "cannot share any moves");
        }

        them.addMoveSlotConstraint(usMoves);
    }
}

/**
 * Handles the implications of Natural Gift succeeding or failing.
 * @param failed Whether the move failed.
 */
function naturalGift(ctx: MoveContext, failed: boolean): void
{
    // naturalgift only succeeds if the user has a berry, and implicitly
    //  consumes it
    if (!failed)
    {
        // TODO: narrow further based on perceived power and type
        ctx.user.item.narrow(Object.keys(dex.berries));
        ctx.user.removeItem(/*consumed*/ true);
    }
    // fails if the user doesn't have a berry
    // TODO: also check for klutz/embargo blocking the berry from being used
    else ctx.user.item.remove(Object.keys(dex.berries));
}

/**
 * Makes an inference based on whether the recoil effect was consumed or
 * ignored.
 */
function recoil(ctx: MoveContext, consumed: boolean): void
{
    if (ctx.user.volatile.suppressAbility)
    {
        if (!consumed)
        {
            throw new Error(`Move ${ctx.moveName} user '${ctx.userRef}' ` +
                "suppressed recoil through an ability but ability is " +
                "suppressed");
        }
        // can't make any meaningful inferences here
    }
    else
    {
        // get possible recoil-canceling abilities
        const userAbility = ctx.user.traits.ability;
        const noRecoilAbilities = [...userAbility.possibleValues]
            .filter(n => userAbility.map[n].flags?.noIndirectDamage);
        // can't have recoil-canceling abilities
        if (consumed)
        {
            if (noRecoilAbilities.length === userAbility.size)
            {
                throw new Error(`Move ${ctx.moveName} user '${ctx.userRef}' ` +
                    "must have a recoil-canceling ability " +
                    `[${noRecoilAbilities.join(", ")}] but recoil still ` +
                    "happened");
            }
            userAbility.remove(noRecoilAbilities);
        }
        // must have a recoil-canceling ability
        else if (noRecoilAbilities.length <= 0)
        {
            throw new Error(`Move ${ctx.moveName} user '${ctx.userRef}' ` +
                `ability [${[...userAbility.possibleValues].join(", ")}] ` +
                "can't suppress recoil but it still suppressed recoil");
        }
        else userAbility.narrow(noRecoilAbilities);
    }
}
