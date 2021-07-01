/** @file Contains useful helper types. */
import { MajorStatus } from "./handlers/battle/formats/gen4/dex/dex-util";

/** Converts a display name into an id name. */
export function toIdName(str: string): string
{
    return str.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Player ID in a battle. */
export type PlayerID = "p1" | "p2";

/**
 * Gets the opposite PlayerID of the given one.
 * @param id Given player id.
 * @returns The other PlayerID.
 */
export function otherPlayerID(id: PlayerID): PlayerID
{
    return id === "p1" ? "p2" : "p1";
}

/**
 * Checks whether a string is a PlayerID.
 * @param id Value to check.
 * @returns True if the value is part of the PlayerID type union.
 */
export function isPlayerID(id: any): id is PlayerID
{
    return id === "p1" || id === "p2";
}

/** Types of server rooms. */
export type RoomType = "chat" | "battle";

/** Gives basic info about the owner and position of a pokemon. */
export interface PokemonID
{
    /** Whose side the pokemon is on. */
    readonly owner: PlayerID;
    /**
     * Active position (a, b, or c). Only really applicable in non-single
     * battles.
     */
    readonly position?: string;
    /** Display nickname. */
    readonly nickname: string;
}

/** Holds a couple details about a pokemon. */
export interface PokemonDetails
{
    readonly species: string;
    readonly shiny: boolean;
    readonly gender: string | null;
    readonly level: number;
}

/** Details pokemon hp (can be percent) and status conditions. */
export interface PokemonStatus
{
    readonly hp: number;
    readonly hpMax: number;
    readonly condition: MajorStatus | null;
}
