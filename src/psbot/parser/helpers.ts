/** @file Provides helper parsers/functions for the main parser. */
import { BoostName, isBoostName, isMajorStatus, isWeatherType, MajorStatus,
    WeatherType } from "../handlers/battle/formats/gen4/dex/dex-util";
import { isPlayerID, PlayerID, PokemonDetails, PokemonID, PokemonStatus } from
    "../helpers";
import { transform } from "./combinators";
import { Info, Input, Parser, Result } from "./types";

// helper parsers

/** Parser that consumes any word. */
export function anyWord(input: Input, info: Info): Result<string, string>
{
    const w = input.get();
    if (input.done || w === "\n") throw new Error("Expected word");
    return {result: w, remaining: input.next()};
}

/** Parser that consumes a JSON object. */
export const json = transform(anyWord, JSON.parse);

/** Parser that consumes any integer. */
export const integer = transform(anyWord, parseInteger);

/** Parser that consumes a PlayerID. */
export const playerId = transform(anyWord, parsePlayerID);

/** Parser that consumes a PlayerID with username. */
export const playerIdWithName = transform(anyWord, parsePlayerIDWithName);

/** Parser that consumes a PokemonID. */
export const pokemonId = transform(anyWord, parsePokemonID);

/** Parser that consumes a PokemonDetails. */
export const pokemonDetails = transform(anyWord, parsePokemonDetails);

/** Parser that consumes a PokemonStatus. */
export const pokemonStatus = transform(anyWord, parsePokemonStatus);

/** Parser that consumes a MajorStatus. */
export const majorStatus = transform(anyWord, parseMajorStatus);

/** Parser that consumes a BoostableStatName. */
export const boostName = transform(anyWord, parseBoostName);

/** Parser that consumes a WeatherType or `"none"`. */
export const weatherTypeOrNone = transform(anyWord, parseWeatherTypeOrNone);

/** Advances input to the next newline. This is a no-op if already on one. */
export function skipLine(input: Input, info: Info): Result<undefined, string>
{
    while (!input.done && input.get() !== "\n") input = input.next();

    return {result: undefined, remaining: input};
}

/**
 * Parser that consumes the rest of the line as plain text. Leaves Input
 * iterator at next newline.
 */
export function restOfLine(input: Input, info: Info): Result<string, string>
{
    let result = "";
    let w = input.get();

    if (!input.done && w !== "\n")
    {
        result = w;
        input = input.next();
        w = input.get();
        while (!input.done && w !== "\n")
        {
            // since words are delimited by pipes, add them back
            result += "|" + w;
            input = input.next();
            w = input.get();
        }
    }

    return {result, remaining: input};
}

/** Creates a Parser that consumes a particular word. */
export function word<T extends string>(...alts: T[]): Parser<T, string>
{
    return function(input, info): Result<T, string>
    {
        const w = input.get() as T;
        if (!alts.includes(w))
        {
            throw new Error(`Expected ${alts.map(s => `'${s}'`).join(", or")} \
but found ${w}`);
        }
        return {result: w, remaining: input.next()};
    };
}

// helper functions

/** Parses an integer. Throws if invalid. */
export function parseInteger(n: string): number
{
    const parsed = parseInt(n, 10);
    if (isNaN(parsed)) throw new Error(`Invalid integer '${n}'`);

    return parsed;
}

/** Parses a PlayerID. Throws if invalid. */
export function parsePlayerID(id: string): PlayerID
{
    if (!isPlayerID(id)) throw new Error(`Invalid PlayerID '${id}'`);
    return id;
}

/**
 * Parses a PlayerID with username. Throws if invalid.
 *
 * Format:
 * @example
 * <PlayerID>: <username>
 */
export function parsePlayerIDWithName(s: string):
    {id: PlayerID, username: string}
{
    const id = parsePlayerID(s.substr(0, 2));
    if (s.substr(2, 2) !== ": ")
    {
        throw new Error(`Invalid PlayerIDWithName '${s}'`);
    }
    const username = s.substr(4);
    return {id, username};
}

/**
 * Parses a Pokemon ID in the form `<owner><pos>: <name>`, where `<owner>`
 * determines the side the pokemon is on, `<pos>` is its position on that
 * side (optional in certain places), and `<name>` is the Pokemon's nickname.
 * @param id Unparsed pokemon ID.
 * @param pos Whether to require `<pos>` in format. This should only be false
 * when parsing a `request` message. Default true.
 * @param logger Used to log an error if invalid. Optional.
 * @returns A parsed PokemonID object. Throws if invalid.
 */
export function parsePokemonID(id: string, pos = true): PokemonID
{
    const owner = id.substring(0, 2);
    if (!isPlayerID(owner))
    {
        throw new Error(`PokemonID '${id}' has invalid PlayerID '${owner}'`);
    }

    if (pos)
    {
        if (id.substring(3, 5) !== ": ")
        {
            throw new Error(`Invalid PokemonID ${id}`);
        }
        return {
            owner, position: id.substring(2, 3), nickname: id.substring(5)
        };
    }
    return {owner, nickname: id.substring(4)};
}

/**
 * Parses a Pokemon's details in the form
 * `<species>, shiny, <gender>, L<level>`, where all but the species name is
 * optional. If gender is omitted then it's genderless, and if level is
 * omitted then it's assumed to be level 100.
 * @param details Unparsed pokemon details.
 * @param logger Used to log an error if invalid. Optional.
 * @returns A parsed PokemonDetails object. Throws if invalid.
 */
export function parsePokemonDetails(input: string): PokemonDetails
{
    // filter out empty strings
    const details = input.split(", ").filter(detail => detail.length > 0);
    if (details.length === 0)
    {
        throw new Error(`PokemonDetails ${input} is empty`);
    }

    const species = details[0];
    let shiny = false;
    let gender: string | null = null;
    let level = 100;
    for (let i = 1; i < details.length; ++i)
    {
        const detail = details[i];
        if (detail === "shiny") shiny = true;
        else if (detail === "M" || detail === "F") gender = detail;
        else if (detail.startsWith("L")) level = parseInt(detail.substr(1), 10);
    }

    return {species, shiny, gender, level};
}

/**
 * Parses a pokemon's status in the form `<hp>/<hpMax> <status>`. HP can be
 * displayed as a percentage and status is optional.
 * @param status Unparsed pokemon status.
 * @param logger Used to log an error if invalid. Optional.
 * @returns A parsed PokemonStatus object. Throws if invalid.
 */
export function parsePokemonStatus(status: string): PokemonStatus
{
    if (status === "0 fnt")
    {
        // fainted pokemon
        return {hp: 0, hpMax: 0, condition: null};
    }

    const slash = status.indexOf("/");
    if (slash === -1)
    {
        throw new Error(`Missing hp '/' in PokemonStatus '${status}'`);
    }
    let space = status.indexOf(" ", slash);
    // status condition can be omitted, in which case it'll end up as an
    //  empty string
    if (space === -1) space = status.length;

    const hp = parseInt(status.substring(0, slash), 10);
    const hpMax = parseInt(status.substring(slash + 1, space), 10);
    const condStr = status.substr(space + 1);
    const condition = condStr ? parseMajorStatus(condStr) : null;
    return {hp, hpMax, condition};
}

/** Parses a major status. Throws if invalid. */
export function parseMajorStatus(status: string): MajorStatus
{
    if (!isMajorStatus(status))
    {
        throw new Error(`Invalid major status '${status}'`);
    }
    return status;
}

/** Parses a boost name. Throws if invalid. */
export function parseBoostName(stat: string): BoostName
{
    if (!isBoostName(stat))
    {
        throw new Error(`Invalid boost name '${stat}'`);
    }
    return stat;
}

/** Parses a weather type or `"none"`. Throws if invalid. */
export function parseWeatherTypeOrNone(type: string): WeatherType | "none"
{
    if (!isWeatherType(type) && type !== "none")
    {
        throw new Error(`Invalid weather type '${type}'`);
    }
    return type;
}
