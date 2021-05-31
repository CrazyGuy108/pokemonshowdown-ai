/**
 * @file Interfaces and helper functions for dealing with the arguments of a
 * MessageHandler.
 */
import { MoveTarget } from "../handlers/battle/formats/gen4/dex/dex-util";
import { InitPokemon } from "../../battle/parser/BattleEvent";
import { PlayerID, PokemonDetails, PokemonID, PokemonStatus, RoomType } from
    "../helpers";
import * as psevent from "./PSBattleEvent";

/** Set of Prefixes. */
const prefixes =
{
    challstr: true, deinit: true, error: true, init: true, request: true,
    updatechallenges: true, updateuser: true
} as const;
/** Message types that are parsed as a single standalone line. */
export type Prefix = keyof typeof prefixes;
/**
 * Checks if a value is a Prefix. Usable as a type guard.
 * @param value Value to check.
 * @returns Whether the value is a Prefix.
 */
export function isPrefix(value: any): value is Prefix
{
    return prefixes.hasOwnProperty(value);
}

/**
 * Defines the type maps for each Message. Key must match the Message's `#type`
 * field.
 */
interface MessageMap
{
    battleInit: BattleInit;
    battleProgress: BattleProgress;
    challstr: ChallStr;
    deinit: DeInit;
    error: Error;
    init: Init;
    request: Request;
    updateChallenges: UpdateChallenges;
    updateUser: UpdateUser;
}

/** Main message type produced by the parser. */
export type Type = keyof MessageMap;

/** Message type received from the PS server. */
export type Message<T extends Type> = MessageMap[T];

/** Stands for any type of Message that the PS server can send. */
export type Any = Message<Type>;

/** Base class for Messages. */
interface MessageBase<T extends Type>
{
    /** The type of Message this is. */
    readonly type: T;
}

/** Message for initializing a battle. Includes initial BattleEvents. */
export interface BattleInit extends MessageBase<"battleInit">
{
    /** PlayerID of a player. */
    readonly id: PlayerID;
    /** Username of a player. */
    readonly username: string;
    /** Fixed size of each team. */
    readonly teamSizes: {readonly [P in PlayerID]: number};
    /** Cartridge generation. */
    readonly gen: number;
    /** Current game format. */
    readonly tier?: string;
    /** Whether we're playing on the ranked ladder. */
    readonly rated?: boolean;
    /** List of additional rules/clauses in effect for this game. */
    readonly rules: string[];
    /** Initial events. */
    readonly events: readonly psevent.Any[];
}

/** Message for handling parsed BattleEvents. */
export interface BattleProgress extends MessageBase<"battleProgress">
{
    /** Sequence of events in the battle in the order they were parsed. */
    readonly events: readonly psevent.Any[];
}

/** Message that provides the challenge string to verify login info. */
export interface ChallStr extends MessageBase<"challstr">
{
    /** String used to verify account login. */
    readonly challstr: string;
}

/** Message that indicates the leaving of a room. */
export interface DeInit extends MessageBase<"deinit"> {}

/** Message for providing errors from the server. */
export interface Error extends MessageBase<"error">
{
    /** Why the requested action failed. */
    readonly reason: string;
}

/** Message that indicates the joining of a room. */
export interface Init extends MessageBase<"init">
{
    /** Type of room we're joining. */
    readonly roomType: RoomType;
}

/**
 * Message that requests an action taken by the client's battle handler.
 * Provides info on the client's team and possible choices. Some properties in
 * the parsed JSON have to be specially parsed in order to get the full context.
 */
export interface Request extends MessageBase<"request">
{
    /**
     * Whether the opponent is the only one making a decision, meaning the
     * client has to wait.
     */
    readonly wait?: boolean;
    /** Corresponds to which active pokemon slots must be filled. */
    readonly forceSwitch?: readonly boolean[];
    /** Active pokemon info. */
    readonly active?: readonly RequestActive[];
    /** Basic info about the entire team. */
    readonly side: RequestSide;
    /** Request id for verification. */
    readonly rqid?: number;
    /** Whether the given request cannot be canceled. */
    readonly noCancel?: boolean;
}

/** Active pokemon info. */
export interface RequestActive
{
    /** Move statuses. */
    readonly moves: readonly RequestMove[];
    /** Whether the pokemon is trapped and can't switch. */
    readonly trapped?: boolean;
}

/**
 * Data about an active pokemon's move. When trapped into using a multi-turn
 * move, only the `move` and `id` fields will be defined.
 */
export interface RequestMove
{
    /** Name of the move. */
    readonly move: string;
    /** Move id name. */
    readonly id: string;
    /** Current amount of power points. */
    readonly pp?: number;
    /** Maximum amount of power points. */
    readonly maxpp?: number;
    /** Target of the move. */
    readonly target?: MoveTarget;
    /** Whether the move is currently disabled. */
    readonly disabled: boolean;
}

/** Basic team info. */
export interface RequestSide
{
    /** List of all pokemon on the team. */
    readonly pokemon: readonly RequestPokemon[];
}

/** Basic pokemon info. */
export interface RequestPokemon extends InitPokemon, PokemonID, PokemonDetails,
    PokemonStatus
{
    /**
     * True if this pokemon is active. This declaration is only here for
     * completeness and should not be directly accessed. Explicit SwitchEvents
     * are better at that.
     */
    readonly active?: boolean;
    /** Pokeball id name. */
    readonly pokeball: string;
}

/** Message that indicates a change in ingoing/outgoing challenges. */
export interface UpdateChallenges extends MessageBase<"updateChallenges">
{
    /**
     * Maps users challenging the client to the battle format they're being
     * challenged to.
     */
    readonly challengesFrom: {readonly [user: string]: string};
    /** Current outgoing challenge from the client (TODO). */
    readonly challengeTo: null;
}

/** Message that changes the client's username and guest status. */
export interface UpdateUser extends MessageBase<"updateUser">
{
    /** New username. */
    readonly username: string;
    /** Whether this is a guest account. */
    readonly isGuest: boolean;
}
