/** @file Interfaces and helper functions for handling BattleEvents. */
import { BoostName, MajorStatus, WeatherType } from "../../battle/dex/dex-util";
import { PlayerID, PokemonDetails, PokemonID, PokemonStatus } from "../helpers";

/**
 * Set of BattleEventPrefixes. Heal, drag, and unboost are included here, but
 * are parsed as DamageEvents, SwitchEvents, and BoostEvents respectively.
 */
export const battleEventPrefixes =
{
    "-ability": true, "-activate": true, "-boost": true, cant: true,
    "-clearallboost": true, "-clearboost": true, "-clearnegativeboost": true,
    "-clearpositiveboost": true, "-copyboost": true, "-curestatus": true,
    "-cureteam": true, "-damage": true, detailschange: true, drag: true,
    "-end": true, "-endability": true, faint: true, "-fieldend": true,
    "-fieldstart": true, "-formechange": true, "-heal": true,
    "-invertboost": true, move: true, "-mustrecharge": true, "-prepare": true,
    "-setboost": true, "-sethp": true, "-sideend": true, "-sidestart": true,
    "-singleturn": true, "-start": true, "-status": true, "-swapboost": true,
    switch: true, tie: true, turn: true, "-unboost": true, upkeep: true,
    "-weather": true, win: true
} as const;
/** Message line prefixes that are parsed as BattleEvents. */
export type BattleEventPrefix = keyof typeof battleEventPrefixes;
/** Checks if a string is a BattleEventPrefix. Usable as a type guard. */
export function isBattleEventPrefix(value: any): value is BattleEventPrefix
{
    return battleEventPrefixes.hasOwnProperty(value);
}

/** Names of BattleEvent types. */
export const battleEventTypes =
{
    ability: true, activate: true, boost: true, cant: true, clearallboost: true,
    clearboost: true, clearnegativeboost: true, clearpositiveboost: true,
    copyboost: true, curestatus: true, cureteam: true, damage: true,
    detailschange: true, end: true, endability: true, faint: true,
    fieldend: true, fieldstart: true, formechange: true, invertboost: true,
    move: true, mustrecharge: true, prepare: true, setboost: true, sethp: true,
    sideend: true, sidestart: true, singleturn: true, start: true, status: true,
    swapboost: true, switch: true, tie: true, turn: true, unboost: true,
    upkeep: true, weather: true, win: true
} as const;
/** Names of BattleEvent types. */
export type BattleEventType = keyof typeof battleEventTypes;

/** Maps BattleEventType to a BattleEvent interface type. */
export type BattleEvent<T extends BattleEventType> =
    T extends "ability" ? AbilityEvent
    : T extends "activate" ? ActivateEvent
    : T extends "boost" ? BoostEvent
    : T extends "cant" ? CantEvent
    : T extends "clearallboost" ? ClearAllBoostEvent
    : T extends "clearboost" ? ClearBoostEvent
    : T extends "clearnegativeboost" ? ClearNegativeBoostEvent
    : T extends "clearpositiveboost" ? ClearPositiveBoostEvent
    : T extends "copyboost" ? CopyBoostEvent
    : T extends "curestatus" ? CureStatusEvent
    : T extends "cureteam" ? CureTeamEvent
    : T extends "damage" ? DamageEvent
    : T extends "detailschange" ? DetailsChangeEvent
    : T extends "end" ? EndEvent
    : T extends "endability" ? EndAbilityEvent
    : T extends "faint" ? FaintEvent
    : T extends "fieldend" ? FieldEndEvent
    : T extends "fieldstart" ? FieldStartEvent
    : T extends "formechange" ? FormeChangeEvent
    : T extends "invertboost" ? InvertBoostEvent
    : T extends "move" ? MoveEvent
    : T extends "mustrecharge" ? MustRechargeEvent
    : T extends "prepare" ? PrepareEvent
    : T extends "setboost" ? SetBoostEvent
    : T extends "sethp" ? SetHPEvent
    : T extends "sideend" ? SideEndEvent
    : T extends "sidestart" ? SideStartEvent
    : T extends "singleturn" ? SingleTurnEvent
    : T extends "start" ? StartEvent
    : T extends "status" ? StatusEvent
    : T extends "swapboost" ? SwapBoostEvent
    : T extends "switch" ? SwitchEvent
    : T extends "tie" ? TieEvent
    : T extends "turn" ? TurnEvent
    : T extends "unboost" ? UnboostEvent
    : T extends "upkeep" ? UpkeepEvent
    : T extends "weather" ? WeatherEvent
    : T extends "win" ? WinEvent
    : never;

/** Stands for any type of event that can happen during a battle. */
export type AnyBattleEvent = BattleEvent<BattleEventType>;

/** Base class for BattleEvents. */
interface BattleEventBase
{
    /** Type of event this is. */
    readonly type: string;
    /** Cause of event. */
    readonly cause?: Cause;
}

/** Event where a pokemon's ability is revealed and activated. */
export interface AbilityEvent extends BattleEventBase
{
    readonly type: "ability";
    /** ID of the pokemon. */
    readonly id: PokemonID;
    /** Ability being activated. */
    readonly ability: string;
}

/** Event where a volatile status is mentioned. */
export interface ActivateEvent extends BattleEventBase
{
    readonly type: "activate";
    /** ID of the pokemon whose status is being activated. */
    readonly id: PokemonID;
    /** Volatile status name. */
    readonly volatile: string;
}

/** Event where a stat is being boosted. */
export interface BoostEvent extends BattleEventBase
{
    readonly type: "boost";
    /** ID of the pokemon being boosted. */
    readonly id: PokemonID;
    /** Name of stat being boosted. */
    readonly stat: BoostName;
    /** Amount to boost by. */
    readonly amount: number;
}

/** Event where an action is prevented from being completed. */
export interface CantEvent extends BattleEventBase
{
    readonly type: "cant";
    /** ID of the pokemon. */
    readonly id: PokemonID;
    /** Why the action couldn't be completed. */
    readonly reason: string;
    /** The move that the pokemon wasn't able to use. */
    readonly moveName?: string;
}

/** Event where all stat boosts are being cleared. */
export interface ClearAllBoostEvent extends BattleEventBase
{
    readonly type: "clearallboost";
}

/** Event where a pokemon's stat boosts are being cleared. */
export interface ClearBoostEvent extends BattleEventBase
{
    readonly type: "clearboost";
    /** ID of the pokemon whose boosts are being cleared. */
    readonly id: PokemonID;
}

/** Event where a pokemon's negative boosts are being cleared. */
export interface ClearNegativeBoostEvent extends BattleEventBase
{
    readonly type: "clearnegativeboost";
    /** ID of the pokemon whose negative boosts are being cleared. */
    readonly id: PokemonID;
}

/** Event where a pokemon's positive boosts are being cleared. */
export interface ClearPositiveBoostEvent extends BattleEventBase
{
    readonly type: "clearpositiveboost";
    /** ID of the pokemon whose positive boosts are being cleared. */
    readonly id: PokemonID;
}

/** Event where a pokemon's boosts are being copied onto another pokemon. */
export interface CopyBoostEvent extends BattleEventBase
{
    readonly type: "copyboost";
    /** ID of the pokemon copying the boosts. */
    readonly source: PokemonID;
    /** ID of the pokemon whose boosts are being copied. */
    readonly target: PokemonID;
}

/** Event where a pokemon's major status is cured. */
export interface CureStatusEvent extends BattleEventBase
{
    readonly type: "curestatus";
    /** ID of the pokemon being cured. */
    readonly id: PokemonID;
    /** Status condition the pokemon is being cured of. */
    readonly majorStatus: MajorStatus;
}

/** Event where all of a team's pokemon are cured of major statuses. */
export interface CureTeamEvent extends BattleEventBase
{
    readonly type: "cureteam";
    /** ID of the pokemon whose team is being cured of a major status. */
    readonly id: PokemonID;
}

/** Event where a pokemon is damaged or healed. */
export interface DamageEvent extends BattleEventBase
{
    readonly type: "damage";
    /** ID of the pokemon being damaged. */
    readonly id: PokemonID;
    /** New hp/status. */
    readonly status: PokemonStatus;
}

/** Event where id, details, and status of a pokemon are revealed or changed. */
interface AllDetailsEvent extends BattleEventBase
{
    /** ID of the pokemon being revealed or changed. */
    readonly id: PokemonID;
    /** Some details on species, level, etc. */
    readonly details: PokemonDetails;
    /** HP and any status conditions. */
    readonly status: PokemonStatus;
}

/** Event where a pokemon permanently changes form. */
export interface DetailsChangeEvent extends AllDetailsEvent
{
    readonly type: "detailschange";
}

/** Event where a pokemon temporarily changes form. */
export interface FormeChangeEvent extends AllDetailsEvent
{
    readonly type: "formechange";
}

/** Event where a pokemon was switched in. */
export interface SwitchEvent extends AllDetailsEvent
{
    readonly type: "switch";
}

/** Event addon where a volatile status has ended. */
export interface EndEvent extends BattleEventBase
{
    readonly type: "end";
    /** ID of the pokemon ending a volatile status. */
    readonly id: PokemonID;
    /** Volatile status name to be removed. */
    readonly volatile: string;
}

/** Event where a pokemon's ability is temporarily removed. */
export interface EndAbilityEvent extends BattleEventBase
{
    readonly type: "endability";
    /** ID of the pokemon. */
    readonly id: PokemonID;
    /** Ability being removed. */
    readonly ability: string;
}

/** Event where a pokemon has fainted. */
export interface FaintEvent extends BattleEventBase
{
    readonly type: "faint";
    /** ID of the pokemon that has fainted. */
    readonly id: PokemonID;
}

/** Event where a field effect has ended. */
export interface FieldEndEvent extends BattleEventBase
{
    readonly type: "fieldend";
    /** Name of the field effect. */
    readonly effect: string;
}

/** Event where a field effect has started. */
export interface FieldStartEvent extends BattleEventBase
{
    readonly type: "fieldstart";
    /** Name of the field effect. */
    readonly effect: string;
}

/** Event where a pokemon's boosts are being inverted. */
export interface InvertBoostEvent extends BattleEventBase
{
    readonly type: "invertboost";
    /** ID of the pokemon whose boosts are being inverted. */
    readonly id: PokemonID;
}

/** Event where a move was used. */
export interface MoveEvent extends BattleEventBase
{
    readonly type: "move";
    /** ID of the pokemon who used the move. */
    readonly id: PokemonID;
    /** Display name of the move being used. */
    readonly moveName: string;
    /** ID of the target pokemon. */
    readonly targetId?: PokemonID;
}

/** Event where a pokemon must recharge on the next turn. */
export interface MustRechargeEvent extends BattleEventBase
{
    readonly type: "mustrecharge";
    /** ID of the pokemon that needs to recharge. */
    readonly id: PokemonID;
}

/** Event where a move is being prepared, and will fire next turn. */
export interface PrepareEvent extends BattleEventBase
{
    readonly type: "prepare";
    /** ID of the pokemon preparing the move. */
    readonly id: PokemonID;
    /** Display name of the move being prepared. */
    readonly moveName: string;
    /** ID of the target pokemon. */
    readonly targetId?: PokemonID;
}

/** Event where a pokemon's stat boost is being set. */
export interface SetBoostEvent extends BattleEventBase
{
    readonly type: "setboost";
    /** ID of the pokemon whose boost is being set. */
    readonly id: PokemonID;
    /** Stat boost being set. */
    readonly stat: BoostName;
    /** Boost amount to be set. */
    readonly amount: number;
}

/** Event where the HP of multiple pokemon is being modified at once. */
export interface SetHPEvent extends BattleEventBase
{
    readonly type: "sethp";
    /** PokemonIDs with their corresponding new statuses. */
    readonly newHPs:
        readonly {readonly id: PokemonID, readonly status: PokemonStatus}[];
}

/** Event where a side condition has ended. */
export interface SideEndEvent extends BattleEventBase
{
    readonly type: "sideend";
    /** ID of the player whose side is affected. */
    readonly id: PlayerID;
    /** Name of the side condition. */
    readonly condition: string;
}

/** Event where a side condition has started. */
export interface SideStartEvent extends BattleEventBase
{
    readonly type: "sidestart";
    /** ID of the player whose side is affected. */
    readonly id: PlayerID;
    /** Name of the side condition. */
    readonly condition: string;
}

/** Event where a status is temporarily added for a single turn. */
export interface SingleTurnEvent extends BattleEventBase
{
    readonly type: "singleturn";
    /** ID of the pokemon getting the status. */
    readonly id: PokemonID;
    /** Name of the temporary status. */
    readonly status: string;
}

/** Event where a volatile status condition has started. */
export interface StartEvent extends BattleEventBase
{
    readonly type: "start";
    /** ID of the pokemon starting a volatile status. */
    readonly id: PokemonID;
    /** Type of volatile status condition. */
    readonly volatile: string;
    /** Additional info if provided. */
    readonly otherArgs: readonly string[];
}

/** Event where a pokemon is afflicted with a status. */
export interface StatusEvent extends BattleEventBase
{
    readonly type: "status";
    /** ID of the pokemon being afflicted with a status condition. */
    readonly id: PokemonID;
    /** Status condition being afflicted. */
    readonly majorStatus: MajorStatus;
}

/** Event where a pokemon's boosts are being swapped with another's. */
export interface SwapBoostEvent extends BattleEventBase
{
    readonly type: "swapboost";
    /** Pokemon whose stats are being swapped. */
    readonly source: PokemonID;
    /** Other swap target. */
    readonly target: PokemonID;
    /** Stats being swapped. */
    readonly stats: readonly BoostName[];
}

/** Event indicating that the game has ended in a tie. */
export interface TieEvent extends BattleEventBase
{
    readonly type: "tie";
}

/** Event indicating that a new turn has started. */
export interface TurnEvent extends BattleEventBase
{
    readonly type: "turn";
    /** New turn number. */
    readonly num: number;
}

/** Event where a stat is being unboosted. */
export interface UnboostEvent extends BattleEventBase
{
    readonly type: "unboost";
    /** ID of the pokemon being unboosted. */
    readonly id: PokemonID;
    /** Name of stat being unboosted. */
    readonly stat: BoostName;
    /** Amount to unboost by. */
    readonly amount: number;
}

/** Event indicating that the main BattleEvents are over. */
export interface UpkeepEvent extends BattleEventBase
{
    readonly type: "upkeep";
}

/** Event where the weather is being changed or maintained. */
export interface WeatherEvent extends BattleEventBase
{
    readonly type: "weather";
    /** Type of weather. */
    readonly weatherType: WeatherType;
    /** Whether this is an upkeep message. */
    readonly upkeep: boolean;
}

/** Event indicating that the game has ended with a winner. */
export interface WinEvent extends BattleEventBase
{
    readonly type: "win";
    /** Username of the winner. */
    readonly winner: string;
}

// battle event cause types

/** Optional event suffixes. */
export type Cause = AbilityCause | FatigueCause | ItemCause | LockedMoveCause;

/** Base class for Causes. */
interface CauseBase
{
    /** The type of Cause this is. */
    readonly type: string;
    /** Additional PokemonID for context. */
    readonly of?: PokemonID;
}

/** Caused by an ability. */
export interface AbilityCause extends CauseBase
{
    readonly type: "ability";
    /** Name of the ability being activated. */
    readonly ability: string;
    /**
     * Either the ID of the pokemon with the ability or the ID of the recipient
     * of the ability's effect. Meaning may depend on the context.
     */
    readonly of?: PokemonID;
}

/** Caused by fatigue, or the completion of a multi-turn locked move. */
export interface FatigueCause extends CauseBase
{
    readonly type: "fatigue";
}

/** Caused by a held item. */
export interface ItemCause extends CauseBase
{
    readonly type: "item";
    /** Item name. */
    readonly item: string;
}

/** Locked into a certain move. */
export interface LockedMoveCause extends CauseBase
{
    readonly type: "lockedmove";
}
