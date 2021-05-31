/** @file Interfaces and helper functions for handling Events. */
import { BoostName, MajorStatus, WeatherType } from "../handlers/battle/formats/gen4/dex/dex-util";
import { SwitchOptions } from "../../battle/parser/BattleEvent";
import { PlayerID, PokemonDetails, PokemonID, PokemonStatus } from "../helpers";

/**
 * The types of minor Events that can exist. Used as event prefixes.
 */
const types =
{
    "\n": {} as Empty,
    "-ability": {} as Ability,
    "-activate": {} as Activate,
    "-boost": {} as Boost,
    cant: {} as Cant,
    "-clearallboost": {} as ClearAllBoost,
    "-clearboost": {} as ClearBoost,
    "-clearnegativeboost": {} as ClearNegativeBoost,
    "-clearpositiveboost": {} as ClearPositiveBoost,
    "-copyboost": {} as CopyBoost,
    "-crit": {} as Crit,
    "-curestatus": {} as CureStatus,
    "-cureteam": {} as CureTeam,
    "-damage": {} as Damage,
    detailschange: {} as DetailsChange,
    drag: {} as Drag,
    "-end": {} as End,
    "-endability": {} as EndAbility,
    "-enditem": {} as EndItem,
    "-fail": {} as Fail,
    faint: {} as Faint,
    "-fieldend": {} as FieldEnd,
    "-fieldstart": {} as FieldStart,
    "-formechange": {} as FormeChange,
    "-heal": {} as Heal,
    "-hitcount": {} as HitCount,
    "-immune": {} as Immune,
    "-invertboost": {} as InvertBoost,
    "-item": {} as Item,
    "-message": {} as Message,
    "-miss": {} as Miss,
    move: {} as Move,
    "-mustrecharge": {} as MustRecharge,
    "-notarget": {} as NoTarget,
    "-prepare": {} as Prepare,
    "-resisted": {} as Resisted,
    "-setboost": {} as SetBoost,
    "-sethp": {} as SetHP,
    "-sideend": {} as SideEnd,
    "-sidestart": {} as SideStart,
    "-singlemove": {} as SingleMove,
    "-singleturn": {} as SingleTurn,
    "-start": {} as Start,
    "-status": {} as Status,
    "-supereffective": {} as SuperEffective,
    "-swapboost": {} as SwapBoost,
    switch: {} as Switch,
    tie: {} as Tie,
    "-transform": {} as Transform,
    turn: {} as Turn,
    "-unboost": {} as Unboost,
    upkeep: {} as Upkeep,
    "-weather": {} as Weather,
    win: {} as Win
} as const;

/** The types of Events that can exist. Used as event prefixes. */
export type Type = keyof typeof types;

/** Checks if a string is a Type. Usable as a type guard. */
export function isType(value: any): value is Type
{
    return types.hasOwnProperty(value);
}

/** Maps Type to a Event interface type. */
export type Event<T extends Type> = typeof types[T];

/** Stands for any type of event that can happen during a battle. */
export type Any = Event<Type>;

// Event interfaces

/** Base class for Events. */
interface EventBase<T extends Type>
{
    /** Type of event this is. */
    readonly type: T;
    /** Optional `[from] x` suffix. */
    readonly from?: string;
    /** Additional PokemonID for context. */
    readonly of?: PokemonID;
    /**
     * Whether the event was caused from fatigue, or the completion of a
     * multi-turn locked move.
     */
    readonly fatigue?: boolean;
    /** Whether the event was due to eating. */
    readonly eat?: boolean;
    /** Whether the mentioned effect (usually a move) missed its target. */
    readonly miss?: boolean;
}

/**
 * Event data that contains the id, details, and status of a pokemon.
 *
 * Note that when casting to SwitchOptions, be sure to replace the
 * `species` field with an id name (e.g. via `toIdName()`).
 * @see SwitchOptions
 * @see toIdName
 */
interface AllDetails extends SwitchOptions, PokemonDetails, PokemonStatus
{
    /** ID of the pokemon being revealed or changed. */
    readonly id: PokemonID;
    /**
     * Species display name.
     * @override
     */
    readonly species: string;
}

/**
 * Event that wraps pre- and post-turn minor events, separating them from the
 * main events.
 */
export interface Empty extends EventBase<"\n"> {}

/** Event where a pokemon's ability is revealed and activated. */
export interface Ability extends EventBase<"-ability">
{
    /** ID of the pokemon. */
    readonly id: PokemonID;
    /** Ability being activated. */
    readonly ability: string;
}

/** Event where a volatile status is mentioned. */
export interface Activate extends EventBase<"-activate">
{
    readonly type: "-activate";
    /** ID of the pokemon whose status is being activated. */
    readonly id: PokemonID;
    /** Volatile status name. */
    readonly volatile: string;
    /** Additional info if provided. */
    readonly otherArgs: readonly string[];
}

/** Event where a stat is being boosted. */
export interface Boost extends EventBase<"-boost">
{
    /** ID of the pokemon being boosted. */
    readonly id: PokemonID;
    /** Name of stat being boosted. */
    readonly stat: BoostName;
    /** Amount to boost by. */
    readonly amount: number;
}

/** Event where an action is prevented from being completed. */
export interface Cant extends EventBase<"cant">
{
    /** ID of the pokemon. */
    readonly id: PokemonID;
    /** Why the action couldn't be completed. */
    readonly reason: string;
    /** The move that the pokemon wasn't able to use. */
    readonly moveName?: string;
}

/** Event where all stat boosts are being cleared. */
export interface ClearAllBoost extends
    EventBase<"-clearallboost"> {}

/** Event where a pokemon's stat boosts are being cleared. */
export interface ClearBoost extends EventBase<"-clearboost">
{
    /** ID of the pokemon whose boosts are being cleared. */
    readonly id: PokemonID;
}

/** Event where a pokemon's negative boosts are being cleared. */
export interface ClearNegativeBoost extends
    EventBase<"-clearnegativeboost">
{
    /** ID of the pokemon whose negative boosts are being cleared. */
    readonly id: PokemonID;
}

/** Event where a pokemon's positive boosts are being cleared. */
export interface ClearPositiveBoost extends
    EventBase<"-clearpositiveboost">
{
    /** ID of the pokemon whose positive boosts are being cleared. */
    readonly id: PokemonID;
}

/** Event where a pokemon's boosts are being copied onto another pokemon. */
export interface CopyBoost extends EventBase<"-copyboost">
{
    /** ID of the pokemon copying the boosts. */
    readonly source: PokemonID;
    /** ID of the pokemon whose boosts are being copied. */
    readonly target: PokemonID;
}

/** Event indicating a critical hit of a move on a pokemon. */
export interface Crit extends EventBase<"-crit">
{
    /** ID of the pokemon taking the hit. */
    readonly id: PokemonID;
}

/** Event where a pokemon's major status is cured. */
export interface CureStatus extends EventBase<"-curestatus">
{
    /** ID of the pokemon being cured. */
    readonly id: PokemonID;
    /** Status condition the pokemon is being cured of. */
    readonly majorStatus: MajorStatus;
}

/** Event where all of a team's pokemon are cured of major statuses. */
export interface CureTeam extends EventBase<"-cureteam">
{
    /** ID of the pokemon whose team is being cured of a major status. */
    readonly id: PokemonID;
}

/** Event where a pokemon is damaged. */
export interface Damage extends EventBase<"-damage">
{
    /** ID of the pokemon being damaged. */
    readonly id: PokemonID;
    /** New hp/status. */
    readonly status: PokemonStatus;
}

/** Event where a pokemon permanently changes form. */
export interface DetailsChange extends AllDetails,
    EventBase<"detailschange"> {}

/** Event where a pokemon was switched in unintentionally. */
export interface Drag extends AllDetails, EventBase<"drag"> {}

/** Event addon where a volatile status has ended. */
export interface End extends EventBase<"-end">
{
    /** ID of the pokemon ending a volatile status. */
    readonly id: PokemonID;
    /** Volatile status name to be removed. */
    readonly volatile: string;
}

/** Event where a pokemon's ability is temporarily removed. */
export interface EndAbility extends EventBase<"-endability">
{
    /** ID of the pokemon. */
    readonly id: PokemonID;
    /** Ability being removed. */
    readonly ability: string;
}

/** Event where a pokemon's item is being removed or consumed. */
export interface EndItem extends EventBase<"-enditem">
{
    /** ID of the pokemon whose item is being removed. */
    readonly id: PokemonID;
    /** Name of the item. */
    readonly item: string;
}

/** Event where a pokemon has failed at a certain action. */
export interface Fail extends EventBase<"-fail">
{
    /**
     * ID of the pokemon using the move if `#reason` is undefined, else the
     * target.
     */
    readonly id: PokemonID;
    /**
     * If specified, then a move failed to affect the mentioned pokemon because
     * of this reason.
     */
    readonly reason?: string;
}

/** Event where a pokemon has fainted. */
export interface Faint extends EventBase<"faint">
{
    /** ID of the pokemon that has fainted. */
    readonly id: PokemonID;
}

/** Event where a field effect has ended. */
export interface FieldEnd extends EventBase<"-fieldend">
{
    /** Name of the field effect. */
    readonly effect: string;
}

/** Event where a field effect has started. */
export interface FieldStart extends EventBase<"-fieldstart">
{
    /** Name of the field effect. */
    readonly effect: string;
}

/** Event where a pokemon temporarily changes form. */
export interface FormeChange extends AllDetails,
    EventBase<"-formechange"> {}

/** Event where a pokemon is healed. */
export interface Heal extends EventBase<"-heal">
{
    /** ID of the pokemon being healed. */
    readonly id: PokemonID;
    /** New hp/status. */
    readonly status: PokemonStatus;
}

/** Event specifying the total number of hits a move took. */
export interface HitCount extends EventBase<"-hitcount">
{
    /** ID of the pokemon being hit. */
    readonly id: PokemonID;
    /** Number of hits. */
    readonly count: number;
}

/** Event where a pokemon's immunity was mentioned. */
export interface Immune extends EventBase<"-immune">
{
    /** ID of the pokemon who was immune to the last action. */
    readonly id: PokemonID;
}

/** Event where a pokemon's boosts are being inverted. */
export interface InvertBoost extends EventBase<"-invertboost">
{
    /** ID of the pokemon whose boosts are being inverted. */
    readonly id: PokemonID;
}

/** Event where a pokemon's item is being revealed and/or activated. */
export interface Item extends EventBase<"-item">
{
    /** ID of the pokemon whose item is activating. */
    readonly id: PokemonID;
    /** Name of the item. */
    readonly item: string;
}

/** Event where a clarification message is being sent. */
export interface Message extends EventBase<"-message">
{
    /** Message text. */
    readonly message: string;
}

/** Event where a move missed one of its targets. */
export interface Miss extends EventBase<"-miss">
{
    /** ID of the pokemon who used the move. */
    readonly id: PokemonID;
    /** ID of the target pokemon. */
    readonly targetId: PokemonID;
}

/** Event where a move was used. */
export interface Move extends EventBase<"move">
{
    /** ID of the pokemon who used the move. */
    readonly id: PokemonID;
    /** Display name of the move being used. */
    readonly moveName: string;
    /** ID of the target pokemon. */
    readonly targetId?: PokemonID;
}

/** Event where a pokemon must recharge on the next turn. */
export interface MustRecharge extends EventBase<"-mustrecharge">
{
    /** ID of the pokemon that needs to recharge. */
    readonly id: PokemonID;
}

/** Event where a pokemon's move can't target anything. */
export interface NoTarget extends EventBase<"-notarget">
{
    /** ID of the pokemon attempting to use a move. */
    readonly id: PokemonID;
}

/** Event where a move is being prepared, and will fire next turn. */
export interface Prepare extends EventBase<"-prepare">
{
    /** ID of the pokemon preparing the move. */
    readonly id: PokemonID;
    /** Display name of the move being prepared. */
    readonly moveName: string;
    /** ID of the target pokemon. */
    readonly targetId?: PokemonID;
}

/** Event where a pokemon was hit by a move it resists. */
export interface Resisted extends EventBase<"-resisted">
{
    /** ID of the pokemon being hit. */
    readonly id: PokemonID;
}

/** Event where a pokemon's stat boost is being set. */
export interface SetBoost extends EventBase<"-setboost">
{
    /** ID of the pokemon whose boost is being set. */
    readonly id: PokemonID;
    /** Stat boost being set. */
    readonly stat: BoostName;
    /** Boost amount to be set. */
    readonly amount: number;
}

/** Event where the HP of a pokemon is being modified. */
export interface SetHP extends EventBase<"-sethp">
{
    /** ID of the Pokemon being set. */
    readonly id: PokemonID;
    /** New HP/status combo. */
    readonly status: PokemonStatus;
}

/** Event where a side condition has ended. */
export interface SideEnd extends EventBase<"-sideend">
{
    /** ID of the player whose side is affected. */
    readonly id: PlayerID;
    /** Name of the side condition. */
    readonly condition: string;
}

/** Event where a side condition has started. */
export interface SideStart extends EventBase<"-sidestart">
{
    /** ID of the player whose side is affected. */
    readonly id: PlayerID;
    /** Name of the side condition. */
    readonly condition: string;
}

/** Event where a move status is applied until another move is attempted. */
export interface SingleMove extends EventBase<"-singlemove">
{
    /** ID of the pokemon getting the status. */
    readonly id: PokemonID;
    /** Name of the move status. */
    readonly move: string;
}

/** Event where a status is temporarily added for a single turn. */
export interface SingleTurn extends EventBase<"-singleturn">
{
    /** ID of the pokemon getting the status. */
    readonly id: PokemonID;
    /** Name of the temporary status. */
    readonly status: string;
}

/** Event where a volatile status condition has started. */
export interface Start extends EventBase<"-start">
{
    /** ID of the pokemon starting a volatile status. */
    readonly id: PokemonID;
    /** Type of volatile status condition. */
    readonly volatile: string;
    /** Additional info if provided. */
    readonly otherArgs: readonly string[];
}

/** Event where a pokemon is afflicted with a status. */
export interface Status extends EventBase<"-status">
{
    /** ID of the pokemon being afflicted with a status condition. */
    readonly id: PokemonID;
    /** Status condition being afflicted. */
    readonly majorStatus: MajorStatus;
}

/** Event where a pokemon was hit by a move it was weak to. */
export interface SuperEffective extends
    EventBase<"-supereffective">
{
    /** ID of the pokemon being hit. */
    readonly id: PokemonID;
}

/** Event where a pokemon's boosts are being swapped with another's. */
export interface SwapBoost extends EventBase<"-swapboost">
{
    /** Pokemon whose stats are being swapped. */
    readonly source: PokemonID;
    /** Other swap target. */
    readonly target: PokemonID;
    /** Stats being swapped. */
    readonly stats: readonly BoostName[];
}

/** Event where a pokemon was chosen to switch in. */
export interface Switch extends AllDetails, EventBase<"switch"> {}

/** Event indicating that the game has ended in a tie. */
export interface Tie extends EventBase<"tie"> {}

/** Event where a pokemon transforms into another. */
export interface Transform extends EventBase<"-transform">
{
    /** Pokemon who is transforming. */
    readonly source: PokemonID;
    /** Pokemon that will be copied. */
    readonly target: PokemonID;
}

/** Event indicating that a new turn has started. */
export interface Turn extends EventBase<"turn">
{
    /** New turn number. */
    readonly num: number;
}

/** Event where a stat is being unboosted. */
export interface Unboost extends EventBase<"-unboost">
{
    /** ID of the pokemon being unboosted. */
    readonly id: PokemonID;
    /** Name of stat being unboosted. */
    readonly stat: BoostName;
    /** Amount to unboost by. */
    readonly amount: number;
}

/** Event indicating that the main Events are over. */
export interface Upkeep extends EventBase<"upkeep"> {}

/** Event where the weather is being changed or maintained. */
export interface Weather extends EventBase<"-weather">
{
    /** Type of weather, or `"none"` if being reset. */
    readonly weatherType: WeatherType | "none";
    /** Whether this is an upkeep message. */
    readonly upkeep: boolean;
}

/** Event indicating that the game has ended with a winner. */
export interface Win extends EventBase<"win">
{
    /** Username of the winner. */
    readonly winner: string;
}
