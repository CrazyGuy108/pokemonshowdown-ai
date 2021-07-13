/** @file Parsers and helper functions related to status effects. */
import { Protocol } from "@pkmn/protocol";
import { SideID } from "@pkmn/types";
import { toIdName } from "../../../../../../helpers";
import { Event } from "../../../../../../parser";
import { BattleParserContext, tryVerify } from "../../../../parser";
import * as dex from "../../dex";
import { ReadonlyPokemon } from "../../state/Pokemon";
import { dispatch } from "../base";

/** Result from `status()`. */
export interface StatusResult
{
    /** Status type that was consumed, or `true` if silently consumed. */
    success?: true | dex.StatusType;
}

/**
 * Expects a status effect.
 * @param targetRef Target pokemon reference.
 * @param statusTypes Possible statuses to afflict.
 * @returns The status type that was consumed, or `true` if the effect couldn't
 * be applied, or `undefined` if no valid event was found.
 */
export async function status(ctx: BattleParserContext<"gen4">, side: SideID,
    statusTypes: readonly dex.StatusType[]):
    Promise<true | dex.StatusType | undefined>
{
    const mon = ctx.state.getTeam(side).active;
    // effect would do nothing
    if (isStatusSilent(mon, statusTypes)) return true;

    const event = await tryVerify(ctx, "|-start|", "|-status|", "|-singlemove|",
        "|-singleturn|", "|-message|");
    if (!event) return;
    const res = verifyStatus(event, side, statusTypes);
    if (!res) return;
    await dispatch(ctx);
    return res;
}

/**
 * Verifies a status event.
 * @param event Event to verify.
 * @param side Pokemon reference that should receive the status.
 * @param statusTypes Possible statuses to afflict.
 * @returns Whether the event matches one of the `statusTypes`.
 */
export function verifyStatus(
    event: Event<"|-start|" | "|-status|" | "|-singlemove|" | "|-singleturn|" |
        "|-message|">,
    side: SideID, statusTypes: readonly dex.StatusType[]):
    dex.StatusType | false
{
    if (event.args[0] === "-message")
    {
        if (event.args[1] === "Sleep Clause Mod activated.")
        {
            if (statusTypes.includes("slp")) return "slp";
        }
        return false;
    }

    const [, identStr, effectStr] = event.args;
    const ident = Protocol.parsePokemonIdent(identStr);
    if (ident.player !== side) return false;
    const effect = Protocol.parseEffect(effectStr, toIdName);
    if (!statusTypes.includes(effect.name as dex.StatusType)) return false;
    return effect.name as dex.StatusType;
}

/**
 * Checks whether a status effect would be silent.
 * @param mon Target pokemon.
 * @param statusTypes Possible statuses to afflict.
 */
export function isStatusSilent(mon: ReadonlyPokemon,
    statusTypes: readonly dex.StatusType[]): boolean
{
    return statusTypes.every(s => cantStatus(mon, s));
}

// TODO: factor out status handlers for each status type?
/** Checks whether the pokemon can't be afflicted by the given status. */
function cantStatus(mon: ReadonlyPokemon, statusType: dex.StatusType):
    boolean
{
    switch (statusType)
    {
        case "aquaring": case "attract": case "curse": case "flashfire":
        case "focusenergy": case "imprison": case "ingrain":
        case "leechseed": case "mudsport": case "nightmare":
        case "powertrick": case "substitute": case "suppressAbility":
        case "torment": case "watersport":
        case "destinybond": case "grudge": case "rage": // singlemove
        case "magiccoat": case "roost": case "snatch": // singleturn
            return mon.volatile[statusType];
        case "bide": case "confusion": case "charge": case "magnetrise":
        case "embargo": case "healblock": case "slowstart": case "taunt":
        case "uproar": case "yawn":
            return mon.volatile[statusType].isActive;
        case "encore":
            return mon.volatile[statusType].ts.isActive;
        case "endure": case "protect": // stall
            return mon.volatile.stalling;
        case "foresight": case "miracleeye":
            return mon.volatile.identified === statusType;
        default:
            if (dex.isMajorStatus(statusType))
            {
                return !!mon.majorStatus.current;
            }
            // istanbul ignore next: should never happen
            throw new Error(`Invalid status effect '${statusType}'`);
    }
}

/** Checks whether the pokemon has the given status. */
export function hasStatus(mon: ReadonlyPokemon, statusType: dex.StatusType):
    boolean
{
    switch (statusType)
    {
        case "aquaring": case "attract": case "curse": case "flashfire":
        case "focusenergy": case "imprison": case "ingrain":
        case "leechseed": case "mudsport": case "nightmare":
        case "powertrick": case "substitute": case "suppressAbility":
        case "torment": case "watersport":
        case "destinybond": case "grudge": case "rage": // singlemove
        case "magiccoat": case "roost": case "snatch": // singleturn
            return mon.volatile[statusType];
        case "bide": case "confusion": case "charge": case "magnetrise":
        case "embargo": case "healblock": case "slowstart": case "taunt":
        case "uproar": case "yawn":
            return mon.volatile[statusType].isActive;
        case "encore":
            return mon.volatile[statusType].ts.isActive;
        case "endure": case "protect": // stall
            return mon.volatile.stalling;
        case "foresight": case "miracleeye":
            return mon.volatile.identified === statusType;
        default:
            if (dex.isMajorStatus(statusType))
            {
                return mon.majorStatus.current === statusType;
            }
            // istanbul ignore next: should never happen
            throw new Error(`Invalid status effect '${statusType}'`);
    }
}
