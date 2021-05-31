import * as dex from "../../psbot/handlers/battle/formats/gen4/dex/dex";
import * as dexutil from "../../psbot/handlers/battle/formats/gen4/dex/dex-util";
import { MoveData } from "../../psbot/handlers/battle/formats/gen4/state/Pokemon";
import { Side } from "../../psbot/handlers/battle/formats/gen4/state/Side";

/**
 * Defines the type maps for each Event. Key must match the Event's `#type`
 * field.
 */
interface EventMap
{
    activateAbility: ActivateAbility;
    activateFieldEffect: ActivateFieldEffect;
    activateItem: ActivateItem;
    activateStatusEffect: ActivateStatusEffect;
    activateTeamEffect: ActivateTeamEffect;
    block: Block;
    boost: Boost;
    changeType: ChangeType;
    clause: Clause;
    clearAllBoosts: ClearAllBoosts;
    clearNegativeBoosts: ClearNegativeBoosts;
    clearPositiveBoosts: ClearPositiveBoosts;
    copyBoosts: CopyBoosts;
    countStatusEffect: CountStatusEffect;
    crit: Crit;
    cureTeam: CureTeam;
    disableMove: DisableMove;
    fail: Fail;
    faint: Faint;
    fatigue: Fatigue;
    feint: Feint;
    formChange: FormChange;
    futureMove: FutureMove;
    halt: Halt;
    hitCount: HitCount;
    immune: Immune;
    inactive: Inactive;
    initOtherTeamSize: InitOtherTeamSize;
    initTeam: InitTeam;
    invertBoosts: InvertBoosts;
    lockOn: LockOn;
    mimic: Mimic;
    miss: Miss;
    modifyPP: ModifyPP;
    mustRecharge: MustRecharge;
    noTarget: NoTarget;
    postTurn: PostTurn;
    prepareMove: PrepareMove;
    preTurn: PreTurn;
    reenableMoves: ReenableMoves;
    removeItem: RemoveItem;
    resetWeather: ResetWeather;
    resisted: Resisted;
    restoreMoves: RestoreMoves;
    revealItem: RevealItem;
    revealMove: RevealMove;
    setThirdType: SetThirdType;
    sketch: Sketch;
    superEffective: SuperEffective;
    swapBoosts: SwapBoosts;
    switchIn: SwitchIn;
    takeDamage: TakeDamage;
    transform: Transform;
    trap: Trap;
    updateFieldEffect: UpdateFieldEffect;
    updateMoves: UpdateMoves;
    updateStatusEffect: UpdateStatusEffect;
    useMove: UseMove;
}

/** The types of Events that can exist. */
export type Type = keyof EventMap;

/** Maps Type to an Event interface type. */
export type Event<T extends Type> = EventMap[T];

/** Stands for any type of Event. */
export type Any = Event<Type>;

/** Base class for all Events. */
export interface EventBase<T extends Type>
{
    /** The type of Event this is. */
    readonly type: T;
}

/** Reveals, changes, and/or activates a pokemon's ability. */
export interface ActivateAbility extends EventBase<"activateAbility">
{
    /** Pokemon being associated with an ability. */
    readonly monRef: Side;
    /** Ability being activated or revealed. */
    readonly ability: string;
}

/** Activates a field-wide effect. */
export interface ActivateFieldEffect extends EventBase<"activateFieldEffect">
{
    /** Name of the effect. */
    readonly effect: dexutil.FieldEffectType;
    /** Whether to start (`true`) or end (`false`) the effect. */
    readonly start: boolean;
}

/** Reveals and activates a pokemon's held item. */
export interface ActivateItem extends EventBase<"activateItem">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Item being activated. */
    readonly item: string;
}

/** Starts, sets, or ends a trivial status effect. */
export interface ActivateStatusEffect extends EventBase<"activateStatusEffect">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Name of the effect. */
    readonly effect: dexutil.StatusType;
    /** Whether to start (`true`) or end (`false`) the status. */
    readonly start: boolean;
}

/** Activates a team-wide effect. */
export interface ActivateTeamEffect extends EventBase<"activateTeamEffect">
{
    /** Team reference. */
    readonly teamRef: Side;
    /** Name of the status. */
    readonly effect: dexutil.TeamEffectType | dexutil.ImplicitTeamEffectType;
    /** Whether to start (`true`) or end (`false`) the effect. */
    readonly start: boolean;
}

/** Indicates that an effect (e.g. a move) has been blocked by a status. */
export interface Block extends EventBase<"block">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Status being invoked. */
    readonly effect: BlockEffect;
}

/** Types of statuses that can block other effects. */
export type BlockEffect = "endure" | "magicCoat" | "mist" | "protect" |
    "safeguard" | "substitute";

/** Updates a stat boost. */
export interface Boost extends EventBase<"boost">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Stat to boost. */
    readonly stat: dexutil.BoostName;
    /** Number to add to the stat boost counter. */
    readonly amount: number;
    /**
     * Whether to set the stat boost counter rather than add to it. Default
     * false.
     */
    readonly set?: true;
}

/** Temporarily changes the pokemon's types. Also resets third type. */
export interface ChangeType extends EventBase<"changeType">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Types to set. */
    readonly newTypes: readonly [dexutil.Type, dexutil.Type];
}

/** PS-specific event mentioning a clause mod taking effect. */
export interface Clause extends EventBase<"clause">
{
    /** Clause type being activated. */
    readonly clause: "slp";
}

/** Clears all temporary stat boosts from the field. */
export interface ClearAllBoosts extends EventBase<"clearAllBoosts"> {}

/** Clears temporary negative stat boosts from the pokemon. */
export interface ClearNegativeBoosts extends EventBase<"clearNegativeBoosts">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Clears temporary positive stat boosts from the pokemon. */
export interface ClearPositiveBoosts extends EventBase<"clearPositiveBoosts">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Copies temporary stat boosts from one pokemon to the other. */
export interface CopyBoosts extends EventBase<"copyBoosts">
{
    /** Pokemon to get the boosts from. */
    readonly from: Side;
    /** Pokemon to copy the boosts to. */
    readonly to: Side;
}

/** Explicitly updates effect counters. */
export interface CountStatusEffect extends EventBase<"countStatusEffect">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Type of effect. */
    readonly effect: dexutil.CountableStatusType;
    /** Number to set the effect counter to. */
    readonly amount: number;
}

/** Indicates a critical hit of a move on the pokemon. */
export interface Crit extends EventBase<"crit">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Cures all pokemon of a team of any major status conditions. */
export interface CureTeam extends EventBase<"cureTeam">
{
    /** Team reference. */
    readonly teamRef: Side;
}

/** Temporarily disables the pokemon's move. */
export interface DisableMove extends EventBase<"disableMove">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Move being disabled. */
    readonly move: string;
}

/** Indicates that a move failed. */
export interface Fail extends EventBase<"fail"> {}

/** Indicates that the pokemon fainted. */
export interface Faint extends EventBase<"faint">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Indicates that the pokemon's locked move ended due to fatigue. */
export interface Fatigue extends EventBase<"fatigue">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Indicates that the pokemon's stalling move was broken by Feint. */
export interface Feint extends EventBase<"feint">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Indicates that the pokemon changed its form. */
export interface FormChange extends EventBase<"formChange">, SwitchOptions
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Whether this form change is permanent. */
    readonly perm: boolean;
}

/** Prepares or releases a future move. */
export interface FutureMove extends EventBase<"futureMove">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Move being prepared. */
    readonly move: dex.FutureMove;
    /**
     * Whether the move is being prepared (true, monRef mentions user) or
     * released (false, monRef mentions target).
     */
    readonly start: boolean;
}

/**
 * Indicates that the stream of BattleEvents has temporarily (or permanently)
 * halted. After a Halt event has been handled, the BattleState should have the
 * most up to date information if a decision has to be made soon.
 * @see HaltReason
 */
export type Halt = EventBase<"halt"> &
    (HaltGameOver | HaltWait | HaltSwitch | HaltDecide);

// tslint:disable: no-trailing-whitespace (force newline in comments)
/**
 * String union specifying the reason for halting.  
 * `gameOver` - The game has ended, with a `winner` field specifying the winner
 * (or lack thereof if tied).  
 * `wait` - Waiting for the opponent to make a decision.  
 * `switch` - Waiting for the client to make a switch decision.  
 * `decide` - Waiting for the client to make a move or switch decision.
 */
// tslint:enable: no-trailing-whitespace
export type HaltReason = "gameOver" | "wait" | "switch" | "decide";

export interface HaltBase<T extends HaltReason>
{
    /**
     * Reason for halting.
     * @see HaltReason
     */
    readonly reason: T;
}
export interface HaltGameOver extends HaltBase<"gameOver">
{
    /** The side that won. Leave blank if tie. */
    readonly winner?: Side;
}
export type HaltWait = HaltBase<"wait">;
export type HaltSwitch = HaltBase<"switch">;
export type HaltDecide = HaltBase<"decide">;

/** Indicates that the pokemon was hit by a move multiple times. */
export interface HitCount extends EventBase<"hitCount">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Number of hits. */
    readonly count: number;
}

/** Indicates that the pokemon was immune to an effect. */
export interface Immune extends EventBase<"immune">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Indicates that the pokemon spent its turn being inactive. */
export interface Inactive extends EventBase<"inactive">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Reason that the pokemon was inactive. */
    readonly reason?: InactiveReason;
    /** The move that the pokemon was prevented from using. */
    readonly move?: string;
}

/** Typing for `Inactive#reason`. */
export type InactiveReason = "imprison" | "recharge" | "slp" | "truant";

/** Initializes the opponent's team size. */
export interface InitOtherTeamSize extends EventBase<"initOtherTeamSize">
{
    /** Size to set the opponent's team to. */
    readonly size: number;
}

/** Initializes the client's team. */
export interface InitTeam extends EventBase<"initTeam">
{
    readonly team: readonly InitPokemon[];
}

/** Data for initializing a pokemon. */
export interface InitPokemon extends SwitchOptions
{
    /** Pokemon's stats. HP is provided in a separate field. */
    readonly stats: Readonly<Record<dexutil.StatExceptHP, number>>;
    /** List of move id names. */
    readonly moves: readonly string[];
    /** Base ability id name. */
    readonly baseAbility: string;
    /** Item id name. */
    readonly item: string;
    /** Hidden Power type if applicable. */
    readonly hpType?: dexutil.HPType;
    /** Happiness value if applicable. */
    readonly happiness?: number;
}

/** Data for handling a switch-in. */
export interface SwitchOptions
{
    /** Species id name. */
    readonly species: string;
    /** Level between 1 and 100. */
    readonly level: number;
    /** Pokemon's gender. Can be M, F, or null. */
    readonly gender: string | null;
    /** Pokemon's current HP. */
    readonly hp: number;
    /** Pokemon's max HP. */
    readonly hpMax: number;
}

/** Inverts all of the pokemon's temporary stat boosts. */
export interface InvertBoosts extends EventBase<"invertBoosts">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Indicates that the pokemon is taking aim due to Lock-On. */
export interface LockOn extends EventBase<"lockOn">
{
    /** User of Lock-On. */
    readonly monRef: Side;
    /** Target of the Lock-On move. */
    readonly target: Side;
}

/** Indicates that the pokemon is Mimicking a move. */
export interface Mimic extends EventBase<"mimic">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Move being Mimicked. */
    readonly move: string;
}

/** Indicates that the pokemon avoided a move. */
export interface Miss extends EventBase<"miss">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Reveals a move and modifies its PP value. */
export interface ModifyPP extends EventBase<"modifyPP">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Move name. */
    readonly move: string;
    /** Amount of PP to add, or `deplete` to fully deplete the move. */
    readonly amount: number | "deplete";
}

/** Indicates that the pokemon must recharge from the previous action. */
export interface MustRecharge extends EventBase<"mustRecharge">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Indicates that the pokemon's move couldn't target anything. */
export interface NoTarget extends EventBase<"noTarget">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Indicates that the turn is about to end. */
export interface PostTurn extends EventBase<"postTurn"> {}

/** Prepares a two-turn move. */
export interface PrepareMove extends EventBase<"prepareMove">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Move being prepared. */
    readonly move: dex.TwoTurnMove;
}

/** Indicates that the turn is about to begin. */
export interface PreTurn extends EventBase<"preTurn"> {}

/** Re-enables the pokemon's disabled moves. */
export interface ReenableMoves extends EventBase<"reenableMoves">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Indicates that an item was just removed from the pokemon. */
export interface RemoveItem extends EventBase<"removeItem">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /**
     * False if the item was removed or transferred. If the item was consumed
     * (i.e., it can be brought back using the Recycle move), this is set to
     * the item's name, or just true if the item's name is unknown.
     */
    readonly consumed: string | boolean;
}

/** Resets the weather back to none. */
export interface ResetWeather extends EventBase<"resetWeather"> {}

/** Indicates that the pokemon was hit by a move it resists. */
export interface Resisted extends EventBase<"resisted">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Restores the PP of each of the pokemon's moves. */
export interface RestoreMoves extends EventBase<"restoreMoves">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Reveals that the pokemon is now holding an item. */
export interface RevealItem extends EventBase<"revealItem">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Item name. */
    readonly item: string;
    /**
     * Whether the item was gained just now or being revealed. If `"recycle"`,
     * the item was recovered via the Recycle move.
     */
    readonly gained: boolean | "recycle";
}

/** Reveals that the pokemon knows a move. */
export interface RevealMove extends EventBase<"revealMove">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Move name. */
    readonly move: string;
}

/** Sets the pokemon's temporary third type. */
export interface SetThirdType extends EventBase<"setThirdType">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Type to set. */
    readonly thirdType: dexutil.Type;
}

/** Indicates that the pokemon is Sketching a move. */
export interface Sketch extends EventBase<"sketch">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Move being Sketched. */
    readonly move: string;
}

/** Indicates that the pokemon was hit by a move it is weak to. */
export interface SuperEffective extends EventBase<"superEffective">
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Swaps the given temporary stat boosts of two pokemon. */
export interface SwapBoosts extends EventBase<"swapBoosts">
{
    /** First pokemon reference. */
    readonly monRef1: Side;
    /** Second pokemon reference. */
    readonly monRef2: Side;
    /** Stats to swap. */
    readonly stats: readonly dexutil.BoostName[];
}

/** Indicates that a pokemon has switched in. */
export interface SwitchIn extends EventBase<"switchIn">, SwitchOptions
{
    /** Pokemon reference. */
    readonly monRef: Side;
}

/** Indicates that a pokemon took damage (or was healed) and its HP changed. */
export interface TakeDamage extends EventBase<"takeDamage">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** New HP value.. */
    readonly hp: number;
    // TODO: should drain include monRef?
    /** Whether this damage is from a drain or recoil move effect. */
    readonly from?: "drain" | "recoil";
}

/** Indicates that a pokemon has transformed into its target. */
export interface Transform extends EventBase<"transform">
{
    /** Pokemon that is transforming. */
    readonly source: Side;
    /** Pokemon to transform into. */
    readonly target: Side;
}

/** Indicates that the pokemon is being trapped by another. */
export interface Trap extends EventBase<"trap">
{
    /** Pokemon being trapped. */
    readonly target: Side;
    /** Pokemon that is trapping. */
    readonly by: Side;
}

/** Explicitly indicates that a field effect is still going. */
export interface UpdateFieldEffect extends EventBase<"updateFieldEffect">
{
    /** Type of effect to update. */
    readonly effect: dexutil.UpdatableFieldEffectType;
}

/** Reveals moves and pp values. */
export interface UpdateMoves extends EventBase<"updateMoves">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Pokemon's moves with pp values. */
    readonly moves: readonly Readonly<MoveData>[];
}

/**
 * Indicates that a status effect is still going. Usually this is implied at the
 * end of the turn unless the game usually sends an explicit message, which this
 * Event covers.
 */
export interface UpdateStatusEffect extends EventBase<"updateStatusEffect">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Type of effect to update. */
    readonly effect: dexutil.UpdatableStatusType;
}

/** Indicates that the pokemon is attempting to use a move. */
export interface UseMove extends EventBase<"useMove">
{
    /** Pokemon reference. */
    readonly monRef: Side;
    /** Name of the move. */
    readonly move: string;
}
