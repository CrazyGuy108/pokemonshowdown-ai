/** @file Formats BattleState objects into data usable by the neural network. */
import { Buffer} from "buffer";
import * as dex from "../../battle/dex/dex";
import { boostKeys, HPType, hpTypes, majorStatuses, RolloutMove,
    rolloutMoves, StatName, statNames, Type, types, weatherItems, WeatherType }
    from "../../battle/dex/dex-util";
import { ReadonlyBattleState } from "../../battle/state/BattleState";
import { ReadonlyHP } from "../../battle/state/HP";
import { ReadonlyItemTempStatus } from "../../battle/state/ItemTempStatus";
import { ReadonlyMajorStatusCounter } from
    "../../battle/state/MajorStatusCounter";
import { ReadonlyMove } from "../../battle/state/Move";
import { Moveset, ReadonlyMoveset } from "../../battle/state/Moveset";
import { ReadonlyPokemon } from "../../battle/state/Pokemon";
import { ReadonlyPokemonTraits } from "../../battle/state/PokemonTraits";
import { ReadonlyPossibilityClass } from "../../battle/state/PossibilityClass";
import { ReadonlyRoomStatus } from "../../battle/state/RoomStatus";
import { ReadonlyStatRange, StatRange } from "../../battle/state/StatRange";
import { ReadonlyStatTable } from "../../battle/state/StatTable";
import { ReadonlyTeam, Team } from "../../battle/state/Team";
import { ReadonlyTeamStatus } from "../../battle/state/TeamStatus";
import { ReadonlyTempStatus } from "../../battle/state/TempStatus";
import { ReadonlyVariableTempStatus } from
    "../../battle/state/VariableTempStatus";
import { ReadonlyVolatileStatus } from "../../battle/state/VolatileStatus";
import { assertEncoder, augment, concat, Encoder, map, nullable, optional } from
    "./Encoder";
import { booleanEncoder, checkLength, fillEncoder, limitedStatusTurns,
    numberEncoder, oneHotEncoder, zeroEncoder } from "./helpers";

/**
 * Creates a PossibilityClass encoder.
 * @param keys Class names to encode.
 */
export function possibilityClassEncoder(keys: readonly string[]):
    Encoder<ReadonlyPossibilityClass<any>>
{
    return {
        encode(arr, pc)
        {
            checkLength(arr, keys.length);
            if (pc.possibleValues.size < 0)
            {
                arr.fill(0);
                return;
            }

            const sumR = 1 / pc.possibleValues.size;
            for (let i = 0; i < keys.length; ++i)
            {
                arr[i] = pc.possibleValues.has(keys[i]) ? sumR : 0;
            }
        },
        size: keys.length
    };
}

/** Encodes temporary status info. */
export const tempStatusEncoder: Encoder<ReadonlyTempStatus> =
{
    encode(arr, ts)
    {
        checkLength(arr, 1);
        arr[0] = tempStatusEncoderImpl(ts);
    },
    size: 1
};

/** Encodes TempStatus data into a number. */
function tempStatusEncoderImpl(ts: ReadonlyTempStatus): number
{
    return limitedStatusTurns(ts.turns, ts.duration);
}

/**
 * Creates an Encoder for an ItemTempStatus.
 * @param keys Status types to encode.
 */
export function itemTempStatusEncoder<TStatusType extends string>(
    keys: readonly TStatusType[]):
    Encoder<ReadonlyItemTempStatus<TStatusType>>
{
    const size = keys.length + 1;
    return {
        encode(arr, its)
        {
            checkLength(arr, size);

            // modify one-hot value to interpolate status turns/duration
            let one: number;
            // not applicable
            if (its.type === "none") one = 0;
            // infinite duration
            else if (its.duration === null) one = 1;
            // currently assuming short duration but could have extension item
            else if (its.duration === its.durations[0] && its.source &&
                !its.source.definiteValue &&
                its.source.possibleValues.has(its.items[its.type]))
            {
                // take average of both durations since either is likely
                // TODO: interpolate instead by the likelihood that the source
                //  has the item
                one = limitedStatusTurns(its.turns + 1,
                    (its.durations[0] + its.durations[1]) / 2);
            }
            // extension item possibility (and therefore duration) is definitely
            //  known
            else one = limitedStatusTurns(its.turns + 1, its.duration);

            for (let i = 0; i < keys.length; ++i)
            {
                arr[i] = keys[i] === its.type ? one : 0;
            }
            // indicate whether the extended duration is being used
            arr[keys.length] = its.duration === its.durations[1] ? 1 : 0;
        },
        size
    };
}

/**
 * Creates an Encoder for a VariableTempStatus.
 * @param keys Status types to encode.
 */
export function variableTempStatusEncoder<TStatusType extends string>(
    keys: readonly TStatusType[]):
    Encoder<ReadonlyVariableTempStatus<TStatusType>>
{
    const size = keys.length;
    return {
        encode(arr, vts)
        {
            checkLength(arr, size);

            // one-hot encode status type, with the 1 also encoding the amount
            //  of turns left
            for (let i = 0; i < keys.length; ++i)
            {
                arr[i] = keys[i] === vts.type ?
                    limitedStatusTurns(vts.turns + 1, vts.duration) : 0;
            }
        },
        size
    };
}

/** Length of the `encodeStatRange()` array. */
export const sizeStatRange = /*min as % of max stat*/1 + /*max*/1 + /*base*/1;

/** Max possible base stat. */
export const maxBaseStat = 255;
/** Max possible normal stat. */
export const maxStat = StatRange.calcStat(/*hp*/false, maxBaseStat, 100, 252,
    31, 1.1);
/** Max possible hp stat. */
export const maxStatHP = StatRange.calcStat(/*hp*/true, maxBaseStat, 100, 252,
    31, 1);

/** Encoder for a StatRange. */
export const statRangeEncoder: Encoder<ReadonlyStatRange> =
{
    encode(arr, sr)
    {
        checkLength(arr, 3);
        // normalize based on max possible stats
        const reference = sr.hp ? maxStatHP : maxStat;
        arr[0] = sr.min !== null ? sr.min / reference : 0.5; // TODO: guess
        arr[1] = sr.max !== null ? sr.max / reference : 0.5;
        arr[2] = sr.base !== null ? sr.base / maxBaseStat : 0.5;
    },
    size: 3
};

/** Encoder for an unknown StatRange. */
export const unknownStatRangeEncoder: Encoder<null> =
    // halve max stat as a guess
    fillEncoder(0.5, statRangeEncoder.size);

/** Encoder for a nonexistent StatRange. */
export const emptyStatRangeEncoder: Encoder<undefined> =
    fillEncoder(-1, statRangeEncoder.size);

// TODO: move to dex-util
/** Stat names. */
const statKeys = Object.keys(statNames) as readonly StatName[];
/** Hidden Power type names. */
const hpTypeKeys = Object.keys(hpTypes) as readonly HPType[];

/** Encoder for a StatTable. */
export const statTableEncoder: Encoder<ReadonlyStatTable> = concat(
    ...statKeys.map(statName =>
        augment((st: ReadonlyStatTable) => st[statName], statRangeEncoder)),
    augment(st => (st.level ?? 0) / 100, numberEncoder), // level out of 100
    augment(st => st.hpType, possibilityClassEncoder(hpTypeKeys)));

/** Encoder for an unknown StatTable. */
export const unknownStatTableEncoder: Encoder<null> = concat(
    ...Array.from(statKeys, () => unknownStatRangeEncoder),
    fillEncoder(0.8, 1), // level out of 100 (guess)
    fillEncoder(1 / hpTypeKeys.length, hpTypeKeys.length)); // hp type

/** Encoder for a nonexistent StatTable. */
export const emptyStatTableEncoder: Encoder<undefined> = concat(
    ...Array.from(statKeys, () => emptyStatRangeEncoder),
    fillEncoder(-1, 1), // no level
    fillEncoder(0, hpTypeKeys.length)); // no hp type possibilities

/** Types without `???` type. */
const filteredTypes = Object.keys(types).filter(t => t !== "???") as Type[];

/** Args for `pokemonTraitsEncoder`. */
export interface PokemonTraitsEncoderArgs
{
    /** Traits object. */
    readonly traits: ReadonlyPokemonTraits;
    /** Optional third type. */
    readonly addedType?: Type;
}

/** Encoder for a PokemonTraits object. */
export const pokemonTraitsEncoder: Encoder<PokemonTraitsEncoderArgs> = concat(
    // ability
    augment(({traits: {ability}}) => ability,
        possibilityClassEncoder(Object.keys(dex.abilities))),
    // species
    augment(({traits: {data: {uid}}}) => ({id: uid}),
        oneHotEncoder(dex.numPokemon)),
    // stats
    augment(({traits: {stats}}) => stats, statTableEncoder),
    // type
    {
        encode(arr, {traits: {types: monTypes}, addedType})
        {
            checkLength(arr, filteredTypes.length);
            for (let i = 0; i < filteredTypes.length; ++i)
            {
                const type = filteredTypes[i];
                arr[i] = monTypes.includes(type) || type === addedType ? 1 : 0;
            }
        },
        size: filteredTypes.length
    });

/** Encoder for an unknown PokemonTraits object. */
export const unknownPokemonTraitsEncoder: Encoder<null> = concat(
    fillEncoder(1 / dex.numAbilities, dex.numAbilities),
    fillEncoder(1 / dex.numPokemon, dex.numPokemon),
    unknownStatTableEncoder,
    // could be any one or two of these types (avg 1 and 2)
    fillEncoder(1.5 / filteredTypes.length, filteredTypes.length));

/** Encoder for a nonexistent PokemonTraits object. */
export const emptyPokemonTraitsEncoder: Encoder<undefined> = concat(
    fillEncoder(-1, dex.numAbilities + dex.numPokemon),
    emptyStatTableEncoder,
    fillEncoder(-1, filteredTypes.length));

/** Encoder for a VolatileStatus. */
export const volatileStatusEncoder: Encoder<ReadonlyVolatileStatus> = concat(
    // passable
    augment(vs => vs.aquaRing, booleanEncoder),
    {
        encode(arr, vs: ReadonlyVolatileStatus)
        {
            checkLength(arr, boostKeys.length);
            for (let i = 0; i < boostKeys.length; ++i)
            {
                arr[i] = vs.boosts[boostKeys[i]];
            }
        },
        size: boostKeys.length
    },
    augment(vs => vs.confusion, tempStatusEncoder),
    augment(vs => vs.curse, booleanEncoder),
    augment(vs => vs.embargo, tempStatusEncoder),
    augment(vs => vs.focusEnergy, booleanEncoder),
    augment(vs => vs.ingrain, booleanEncoder),
    augment(vs => vs.leechSeed, booleanEncoder),
    augment(vs => vs.lockedOnBy?.lockOnTurns,
        nullable(tempStatusEncoder, zeroEncoder(tempStatusEncoder.size))),
    augment(vs => vs.lockOnTurns, tempStatusEncoder),
    augment(vs => vs.magnetRise, tempStatusEncoder),
    augment(vs => vs.nightmare, booleanEncoder),
    augment(vs => vs.perish <= 0 ? 0 : limitedStatusTurns(vs.perish, 3),
        numberEncoder),
    augment(vs => vs.powerTrick, booleanEncoder),
    augment(vs => vs.substitute, booleanEncoder),
    augment(vs => vs.suppressAbility, booleanEncoder),
    augment(vs => !!vs.trapped, booleanEncoder),
    augment(vs => !!vs.trapping, booleanEncoder),

    // non-passable
    augment(vs => vs.attract, booleanEncoder),
    augment(vs => vs.bide, tempStatusEncoder),
    augment(vs => vs.charge, tempStatusEncoder),
    augment(vs => vs.defenseCurl, booleanEncoder),
    augment(vs => vs.destinyBond, booleanEncoder),
    augment(
        vs => vs.disabled ?
            {
                id: dex.moves[vs.disabled.name].uid,
                one: tempStatusEncoderImpl(vs.disabled.ts)
            }
            : {id: null},
        oneHotEncoder(dex.numMoves)),
    augment(vs => vs.grudge, booleanEncoder),
    augment(vs => vs.healBlock, tempStatusEncoder),
    augment(vs => vs.identified === "foresight", booleanEncoder),
    augment(vs => vs.identified === "miracleEye", booleanEncoder),
    augment(vs => vs.imprison, booleanEncoder),
    augment(vs => vs.lockedMove,
        variableTempStatusEncoder(Object.keys(dex.lockedMoves) as
            dex.LockedMove[])),
    augment(vs => vs.minimize, booleanEncoder),
    augment(vs => vs.mudSport, booleanEncoder),
    augment(vs => vs.mustRecharge, booleanEncoder),
    augment(vs => ({traits: vs.overrideTraits, addedType: vs.addedType}),
        pokemonTraitsEncoder),
    augment(vs => vs.rage, booleanEncoder),
    augment(vs => vs.rollout,
        variableTempStatusEncoder(Object.keys(rolloutMoves) as RolloutMove[])),
    augment(vs => vs.roost, booleanEncoder),
    augment(vs => vs.slowStart, tempStatusEncoder),
    augment(vs => vs.snatch, booleanEncoder),
    // stall fail rate
    // halves each time a stalling move is used, capped at 12.5% in gen4
    augment(vs => Math.min(0.875, 1 - Math.pow(2, -vs.stallTurns)),
        numberEncoder),
    augment(vs => vs.stockpile / 3, numberEncoder),
    augment(vs => vs.taunt, tempStatusEncoder),
    augment(vs => vs.torment, booleanEncoder),
    augment(vs => vs.transformed, booleanEncoder),
    augment(vs => vs.twoTurn,
        variableTempStatusEncoder(Object.keys(dex.twoTurnMoves) as
            dex.TwoTurnMove[])),
    augment(vs => vs.unburden, booleanEncoder),
    augment(vs => vs.uproar, tempStatusEncoder),
    augment(vs => vs.waterSport, booleanEncoder),
    augment(vs => vs.willTruant, booleanEncoder),
    augment(vs => vs.yawn, tempStatusEncoder));

/** Encoder for a MajorStatusCounter. */
export const majorStatusCounterEncoder: Encoder<ReadonlyMajorStatusCounter> =
    augment(msc =>
        ({
            id: msc.current && majorStatuses[msc.current],
            // %hp that will be taken away at the end of the next turn by toxic
            //  dmg
            one: msc.current === "tox" ? Math.min(1, 0.0625 * msc.turns)
                : msc.current === "slp" ?
                    // chance of staying asleep
                    limitedStatusTurns(msc.turns, msc.duration!)
                // irrelevant
                : 1
        }),
        oneHotEncoder(Object.keys(majorStatuses).length));

/** Encoder for an unknown MajorStatusCounter. */
export const unknownMajorStatusCounterEncoder: Encoder<null> =
    fillEncoder(0, majorStatusCounterEncoder.size);

/** Encoder for a nonexistent MajorStatusCounter. */
export const emptyMajorStatusCounterEncoder: Encoder<undefined> =
    fillEncoder(0, majorStatusCounterEncoder.size);

// TODO: move to dex
/** Contains every move name. */
const moveNames = Object.keys(dex.moves) as readonly string[];
/** Max PP of any move. */
export const maxPossiblePP = 64;

/** Encoder for an unknown Move's PP value. */
const unknownPPEncoder: Encoder<any> =
{
    encode(arr)
    {
        checkLength(arr, 2);
        arr[0] = 1; // ratio of pp to maxpp
        arr[1] = 0.5; // ratio of maxpp to max possible pp (TODO: guess)
    },
    size: 2
};

/** Encoder for a Move. */
export const moveEncoder: Encoder<ReadonlyMove> = concat(
    augment(m => ({id: m.id}), oneHotEncoder(moveNames.length)),
    // ratio of pp to maxpp
    augment(m => m.pp / m.maxpp, numberEncoder),
    // ratio of maxpp to max possible pp
    augment(m => m.maxpp / maxPossiblePP, numberEncoder));

/** Args for `constrainedMoveEncoder`. */
export interface ConstrainedMoveArgs
{
    readonly move: "constrained";
    /** Mapping of move name to number of mentions. */
    readonly constraint: {readonly [name: string]: number};
    /**
     * Total number of mentions, i.e. the sum of all the `constraint` entries.
     */
    readonly total: number;
}

/** Encoder for an unknown Move slot with a constraint. */
export const constrainedMoveEncoder: Encoder<ConstrainedMoveArgs> =
    concat(
        {
            encode(arr, {constraint, total})
            {
                checkLength(arr, moveNames.length);
                // encode constraint data
                for (let i = 0; i < moveNames.length; ++i)
                {
                    arr[i] = (constraint[moveNames[i]] ?? 0) / total;
                }
            },
            size: moveNames.length
        },
        unknownPPEncoder);

/** Encoder for an unknown Move slot. */
export const unknownMoveEncoder: Encoder<null> = concat(
    // assume each move is equally probable
    fillEncoder(1 / moveNames.length, moveNames.length),
    unknownPPEncoder);

/** Encoder for an empty Move slot. */
export const emptyMoveEncoder: Encoder<undefined> =
    // no likelihood for any move type + 0 pp
    fillEncoder(0, moveNames.length + 2);

/** Args for `moveEncoder` to indicate that the Move is known. */
export interface KnownMoveArgs
{
    /** Move to encode. */
    readonly move: ReadonlyMove;
}

/** Args for `moveSlotEncoder`. */
export type MoveSlotArgs = KnownMoveArgs | ConstrainedMoveArgs | undefined;

/** Encoder for a Move slot within a Moveset. */
export const moveSlotEncoder: Encoder<MoveSlotArgs> =
{
    encode(arr, args)
    {
        checkLength(arr, moveEncoder.size);
        if (!args) emptyMoveEncoder.encode(arr, args);
        else if (args.move === "constrained")
        {
            constrainedMoveEncoder.encode(arr, args);
        }
        else moveEncoder.encode(arr, args.move);
    },
    size: moveEncoder.size
};
/** Encoder for a known Moveset. */
export const movesetEncoder: Encoder<ReadonlyMoveset> =
    augment(ms => getMoveArgs(ms), map(Moveset.maxSize, moveSlotEncoder));

/**
 * Gets data about every moveslot in the given Moveset.
 * @param ms Moveset to extract from.
 * @returns An array of partially-encoded `moveEncoder` args.
 */
function getMoveArgs(ms: ReadonlyMoveset): MoveSlotArgs[]
{
    const result: MoveSlotArgs[] = [];
    // known
    for (const move of ms.moves.values()) result.push({move});
    // unknown
    if (ms.moves.size < ms.size)
    {
        // precalculate unknown move encoding
        const constraint: {[name: string]: number} = {};
        let total = ms.constraint.size;
        for (const name of ms.constraint) constraint[name] = 1;
        for (const moveConstraint of ms.moveSlotConstraints)
        {
            for (const name of moveConstraint)
            {
                constraint[name] = (constraint[name] ?? 0) + 1;
            }
            total += moveConstraint.size;
        }
        const constrainedArgs: ConstrainedMoveArgs =
            {move: "constrained", constraint, total};
        for (let i = ms.moves.size; i < ms.size; ++i)
        {
            result.push(constrainedArgs);
        }
    }
    // empty
    for (let i = ms.size; i < Moveset.maxSize; ++i)
    {
        result.push(undefined);
    }
    return result;
}

/** Encoder for an unknown Moveset. */
export const unknownMovesetEncoder: Encoder<null> = concat(
    ...Array.from({length: Moveset.maxSize}, () => unknownMoveEncoder));

/** Encoder for a nonexistent Moveset. */
export const emptyMovesetEncoder: Encoder<undefined> = concat(
    ...Array.from({length: Moveset.maxSize}, () => emptyMoveEncoder));


/** Encoder for an HP object. */
export const hpEncoder: Encoder<ReadonlyHP> =
{
    encode(arr, hp)
    {
        checkLength(arr, 2);
        arr[0] = hp.max === 0 ? 0 : hp.current / hp.max;
        if (hp.isPercent) arr[1] = 0.5; // TODO: guess hp stat
        else arr[1] = hp.max / maxStatHP;
    },
    size: 2
};

/** Encoder for an unknown HP object. */
export const unknownHPEncoder: Encoder<null> =
{
    encode(arr)
    {
        // TODO: guess hp stat
        arr[0] = 1;
        arr[1] = 0.5;
    },
    size: 2
};

/** Encoder for a nonexistent HP object. */
export const emptyHPEncoder: Encoder<undefined> = fillEncoder(-1, 2);

/** Holds every item name. */
const itemKeys = Object.keys(dex.items) as readonly string[];

/** Encoder for an inactive Pokemon. */
export const inactivePokemonEncoder: Encoder<ReadonlyPokemon> = concat(
    augment(p => ({traits: p.traits}), pokemonTraitsEncoder),
    augment(p => p.item, possibilityClassEncoder(itemKeys)),
    augment(p => p.lastItem, possibilityClassEncoder(itemKeys)),
    augment(p => p.moveset, movesetEncoder),
    augment(p => p.gender === "M", booleanEncoder),
    augment(p => p.gender === "F", booleanEncoder),
    augment(p => p.gender === null, booleanEncoder),
    augment(p => (p.happiness ?? /*half*/127.5) / 255, numberEncoder),
    augment(p => p.hp, hpEncoder),
    augment(p => p.majorStatus, majorStatusCounterEncoder),
    augment(p => p.isGrounded, booleanEncoder),
    augment(p => p.maybeGrounded, booleanEncoder));

/** Encoder for an unrevealed Pokemon. */
export const unknownPokemonEncoder: Encoder<null> = concat(
    unknownPokemonTraitsEncoder,
    zeroEncoder(2 * itemKeys.length), // item + lastItem
    unknownMovesetEncoder,
    fillEncoder(1 / 3, 3), // gender possibilities
    fillEncoder(1, 1), // happiness guess
    unknownHPEncoder,
    unknownMajorStatusCounterEncoder,
    fillEncoder(0.5, 2)); // grounded guess

/** Encoder for an empty Pokemon slot. */
export const emptyPokemonEncoder: Encoder<undefined> = concat(
    emptyPokemonTraitsEncoder,
    fillEncoder(0, 2 * itemKeys.length), // item + lastItem
    emptyMovesetEncoder,
    fillEncoder(-1, 4), // gender + happiness
    emptyHPEncoder,
    emptyMajorStatusCounterEncoder,
    fillEncoder(-1, 2)); // grounded

/** Encoder for a benched Pokemon slot, which may be unknown or empty. */
export const benchedPokemonEncoder = optional(inactivePokemonEncoder,
    unknownPokemonEncoder, emptyPokemonEncoder);

// TODO: should Team manage active slots and VolatileStatus?
/** Encoder for an active Pokemon. */
export const activePokemonEncoder: Encoder<ReadonlyPokemon> = concat(
    inactivePokemonEncoder,
    augment(p => p.volatile, volatileStatusEncoder));

/** Holds all the FutureMove names. */
const futureMoveKeys = Object.keys(dex.futureMoves) as
    readonly dex.FutureMove[];

/** Encoder for a TeamStatus. */
export const teamStatusEncoder: Encoder<ReadonlyTeamStatus> = concat(
    ...futureMoveKeys.map(fm =>
        augment((ts: ReadonlyTeamStatus) => ts.futureMoves[fm],
            tempStatusEncoder)),
    augment(ts => ts.healingWish, booleanEncoder),
    augment(ts => ts.lightScreen, itemTempStatusEncoder(["lightscreen"])),
    augment(ts => ts.luckyChant, tempStatusEncoder),
    augment(ts => ts.lunarDance, booleanEncoder),
    augment(ts => ts.mist, tempStatusEncoder),
    augment(ts => ts.reflect, itemTempStatusEncoder(["reflect"])),
    augment(ts => ts.safeguard, tempStatusEncoder),
    augment(ts => !!ts.selfSwitch, booleanEncoder),
    augment(ts => ts.selfSwitch === "copyvolatile", booleanEncoder),
    augment(ts => ts.spikes / 3, numberEncoder),
    augment(ts => ts.stealthRock, numberEncoder),
    augment(ts => ts.toxicSpikes / 2, numberEncoder),
    augment(ts => ts.tailwind, tempStatusEncoder),
    augment(ts => ts.wish, tempStatusEncoder));

/** Encoder for a Team. */
export const teamEncoder: Encoder<ReadonlyTeam> = concat(
    assertEncoder(t =>
    {
        if (!t.active) throw new Error("Team does not have an active Pokemon");
        // should never happen
        if (t.active !== t.pokemon[0])
        {
            throw new Error("Active Pokemon is not in the right Team slot");
        }
        if (!t.active.active)
        {
            throw new Error("Active Pokemon is not active");
        }
        for (let i = 1; i < t.pokemon.length; ++i)
        {
            // should never happen
            if (t.pokemon[i]?.active)
            {
                throw new Error(`Pokemon in Team slot ${i} is active`);
            }
        }
    }),
    augment(t => t.active, activePokemonEncoder),
    ...Array.from({length: Team.maxSize - 1}, (_, i) =>
        augment((t: ReadonlyTeam) => t.pokemon[i], benchedPokemonEncoder)),
    augment(t => t.status, teamStatusEncoder)
);

/** Encoder for a RoomStatus. */
export const roomStatusEncoder: Encoder<ReadonlyRoomStatus> = concat(
    augment(rs => rs.gravity, tempStatusEncoder),
    augment(rs => rs.trickRoom, tempStatusEncoder),
    augment(rs => rs.weather,
        itemTempStatusEncoder(Object.keys(weatherItems) as WeatherType[])));

/** Encoder for a BattleState. */
export const battleStateEncoder: Encoder<ReadonlyBattleState> = concat(
        augment(bs => bs.status, roomStatusEncoder),
        augment(bs => bs.teams.us, teamEncoder),
        augment(bs => bs.teams.them, teamEncoder));

/**
 * Allocates a typed array suitable for the given Encoder. Its contents are
 * zeroed out.
 */
export function alloc(encoder: Encoder<any>): Float32Array
{
    return new Float32Array(encoder.size);
}

/**
 * Allocates a typed array suitable for the given Encoder. Its contents are not
 * zeroed out, and may contain sensitive data.
 */
export function allocUnsafe(encoder: Encoder<any>): Float32Array
{
    // unsafe allocation lets us not have to zero out the contents
    const buf = Buffer.allocUnsafe(
        encoder.size * Float32Array.BYTES_PER_ELEMENT);
    return new Float32Array(buf.buffer, buf.byteOffset, encoder.size);
}
