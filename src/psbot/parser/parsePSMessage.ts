/** @file Exposes the `parsePSMessage` function. */
import { Protocol } from "@pkmn/protocol";
import { BoostName, boostNames } from "../../battle/dex/dex-util";
import { Logger } from "../../Logger";
import { PlayerID } from "../helpers";
import { maybe, sequence, transform } from "./combinators";
import { anyWord, boostName, integer, json, majorStatus, parseBoostName,
    parsePokemonDetails, parsePokemonID, parsePokemonStatus, playerId,
    playerIdWithName, pokemonDetails, pokemonId, pokemonStatus, restOfLine,
    skipLine, weatherTypeOrNone, word } from "./helpers";
import { iter } from "./Iter";
import { MessageHandler } from "./MessageHandler";
import * as psevent from "./PSBattleEvent";
import * as psmsg from "./PSMessage";
import { Info, Input, Parser, Result } from "./types";

/**
 * Parses a message from a Pokemon Showdown server room.
 * @param data Message(s) to be parsed.
 * @returns The room that the messages were sent from, as well as the parsed
 * Messages.
 */
export async function parsePSMessage(data: string):
    Promise<{room: string, messages: psmsg.Any[]}>
{
    const result = {room: "", messages: [] as psmsg.Any[]};
    const mh = new MessageHandler();
    for await (const {roomid, args, kwArgs} of Protocol.parse(data))
    {
        if (!result.room) result.room = roomid;
        else if (result.room !== roomid)
        {
            throw new Error(`Changed rooms midway: '${result.room}' to ` +
                `'${roomid}'`);
        }
        const msg = mh.dispatch(args, kwArgs);
        if (msg) result.messages.push(msg);
    }
    const last = mh.done();
    if (last) result.messages.push(last);
    return result;
}

/**
 * Parses a message from a PokemonShowdown server.
 * @param data Message(s) to be parsed.
 * @param logger Logs messages to the user. Default stderr.
 * @returns The room that the messages were sent from, as well as the parsed
 * Messages.
 */
/*export function parsePSMessagee(data: string, logger = Logger.stderr):
    {room: string, messages: psmsg.Any[]}
{
    const {room, pos} = parseRoom(data);
    const info: Info = {room, logger};

    // remove room line
    if (pos > 0) data = data.substr(pos);
    // words are separated by pipe characters so they don't need to be there
    // lines are separated by newlines so leave them in using lookahead
    // e.g. "|a|b\n|c|d" becomes ["", "a", "b", "\n", "c", "d"]
    const words = data.split(/\||(?=\n)/);
    // remove initial blank space
    words.shift();

    const input = iter(words);

    return {room, messages: messages(input, info)};
}*/

/**
 * Parses room name.
 * @param data Message string.
 * @returns The room name and the position of the first line. Defaults to empty
 * string if no room name was found.
 */
function parseRoom(data: string): {room: string, pos: number}
{
    // format: >roomname
    if (data.startsWith(">"))
    {
        let pos = data.indexOf("\n", 1);
        // istanbul ignore if: can't test
        if (pos === -1) pos = data.length;
        return {room: data.substring(1, pos), pos: pos + 1};
    }
    // no room name found
    return {room: "", pos: 0};
}

/** Parses messages until the input is consumed. */
function messages(input: Input, info: Info): psmsg.Any[]
{
    const result: psmsg.Any[] = [];
    while (!input.done)
    {
        // the parser doesn't have to consume the whole line since the rest of
        //  it will be skipped over
        try
        {
            const r = message(input, info);
            if (r.result) result.push(r.result);
            input = r.remaining;
        }
        catch (e) { info.logger.error(e); }
        // skip until next line (after the newline)
        input = skipLine(input, info).remaining.next();
    }
    return result;
}

// message parsers

type MessageParser<T extends psmsg.Type> = Parser<psmsg.Message<T>, string>;
type MessageResult<T extends psmsg.Type> =
    Result<psmsg.Message<T> | null, string>;

/**
 * Parses a Message. Note that message parsers can parse one or multiple lines,
 * and the remaining Input returned in the Result must end on or before the last
 * parsed line's newline character.
 */
function message(input: Input, info: Info): MessageResult<psmsg.Type>
{
    const prefix = input.get() as psmsg.Prefix | "player" | psevent.Type;

    switch (prefix)
    {
        case "challstr": return messageChallstr(input, info);
        case "deinit": return messageDeInit(input, info);
        case "error": return messageError(input, info);
        case "init": return messageInit(input, info);
        case "request": return messageRequest(input, info);
        case "updatechallenges": return messageUpdateChallenges(input, info);
        case "updateuser": return messageUpdateUser(input, info);
        case "player": return messageBattleInit(input, info);
        default:
            if (psevent.isType(prefix))
            {
                return messageBattleProgress(input, info);
            }

            // silently ignore this message line
            return {result: null, remaining: input};
    }
}

/**
 * Parses a `challstr` message.
 *
 * Format:
 * @example
 * |challstr|<challstr>
 */
const messageChallstr: MessageParser<"challstr"> = transform(
    sequence(word("challstr"), restOfLine),
    ([_, challstr]) => ({type: "challstr", challstr}));

/**
 * Parses an `error` message.
 *
 * Format:
 * @example
 * |error|[reason] <description>
 */
const messageError: MessageParser<"error"> = transform(
    sequence(word("error"), restOfLine),
    ([_, reason]) => ({type: "error", reason}));

/**
 * Parses a `deinit` message.
 *
 * Format:
 * @example
 * |deinit
 */
const messageDeInit: MessageParser<"deinit"> =
    transform(word("deinit"), () => ({type: "deinit"}));

/**
 * Parses an `init` message.
 *
 * Format:
 * @example
 * |init|<chat or battle>
 */
const messageInit: MessageParser<"init"> = transform(
    sequence(
        word("init"),
        transform(anyWord, type =>
        {
            if (type !== "chat" && type !== "battle")
            {
                throw new Error(`Unknown room type ${type}`);
            }
            return type;
        })),
    ([_, roomType]) => ({type: "init", roomType}));

/**
 * Parses a `request` message. The JSON data in the RequestArgs need to have
 * their side details object further parsed before dispatch.
 *
 * Format:
 * @example
 * |request|<unparsed RequestArgs json>
 */
const messageRequest: MessageParser<"request"> = transform(
    sequence(
        word("request"),
        transform(json, function(obj)
        {
            // some info is encoded in a string that needs to be further parsed
            for (const mon of obj.side.pokemon)
            {
                // ident, details, and condition fields are the same format as
                //  the data from a |switch| message
                Object.assign(mon, parsePokemonID(mon.ident, /*pos*/false),
                    parsePokemonDetails(mon.details),
                    parsePokemonStatus(mon.condition));

                // remove the fields we just processed
                delete mon.ident;
                delete mon.details;
                // since PokemonStatus has a "condition" field, we don't remove
                //  that
                // delete mon.condition;
            }

            return obj;
        })),
    ([_, msg]) => ({type: "request", ...msg}));

/**
 * Parses an `updatechallenges` message.
 *
 * Format:
 * @example
 * |updatechallenges|<UpdateChallengesArgs json>
 */
const messageUpdateChallenges: MessageParser<"updateChallenges"> = transform(
    sequence(word("updatechallenges"), json),
    ([_, msg]) => ({type: "updateChallenges", ...msg}));

/**
 * Parses an `updateuser` message.
 *
 * Format:
 * @example
 * |updateuser|<our username>|<0 if guest, 1 otherwise>|<avatarId>
 */
const messageUpdateUser: MessageParser<"updateUser"> = transform(
    // TODO: include avatar id
    sequence(word("updateuser"), transform(anyWord, w => w.trim()), integer),
    ([_, username, name]) => ({type: "updateUser", username, isGuest: !name}));

/**
 * Parses a `battleinit` multiline message. Can be silently ignored if invalid,
 * since usually the first one to attempt parsing is invalid.
 *
 * Format:
 * @example
 * |player|<our PlayerID>|<our username>|<avatar id>
 * |teamsize|p1|<team size>
 * |teamsize|p2|<team size>
 * |gametype|<game type>
 * |gen|<gen #>
 * <...>
 * |start
 * <initial BattleEvents>
 * |turn|1
 */
function messageBattleInit(input: Input, info: Info):
    MessageResult<"battleInit">
{
    // just going to partially implement this procedurally instead of trying to
    //  extend this makeshift parser combinator library
    let id: PlayerID | undefined;
    let username: string | undefined;
    let teamSizes: {[P in PlayerID]: number} | undefined;
    let gen: number | undefined;
    let tier: string | undefined;
    let rated: boolean | undefined;
    const rules: string[] = [];
    const events: psevent.Any[] = [];

    while (!input.done)
    {
        const prefix = input.get();
        switch (prefix)
        {
            case "player":
            {
                const r = messageBattleInitPlayer(input, info);
                ({id, username} = r.result);
                input = r.remaining;
                break;
            }
            case "teamsize":
            {
                const r = messageBattleInitTeamSize(input, info);
                if (!teamSizes)
                {
                    teamSizes = {} as psmsg.BattleInit["teamSizes"];
                }
                teamSizes[r.result.id] = r.result.size;
                input = r.remaining;
                break;
            }
            case "gen":
                ({result: gen, remaining: input} =
                    messageBattleInitGen(input, info));
                break;
            case "tier":
                ({result: tier, remaining: input} =
                    messageBattleInitTier(input, info));
                break;
            case "rated":
                ({result: rated, remaining: input} =
                    messageBattleInitRated(input, info));
                break;
            case "rule":
                ({result: rules[rules.length], remaining: input} =
                    messageBattleInitRule(input, info));
                break;
            // TODO: team preview
            default:
                if (psevent.isType(prefix))
                {
                    // start of initial events
                    const r = battleEvents(input, info);
                    events.push(...r.result);
                    input = r.remaining;
                }
                // else ignore
        }

        // skip until next line (after the newline)
        input = skipLine(input, info).remaining.next();
    }

    // ignore invalid messages
    if (!id || !username || !teamSizes || !teamSizes.p1 || !teamSizes.p2 ||
        gen === undefined)
    {
        // a single initial |player| message was probably sent to identify the
        //  opponent (before the full init message), which we don't really need
        // TODO: support this and/or the separate gametype message?
        info.logger.debug("Ignoring invalid battleinit message");
        return {result: null, remaining: input};
    }
    return {
        result:
        {
            type: "battleInit", id, username, teamSizes, gen, ...tier && {tier},
            ...rated && {rated}, rules, events
        },
        remaining: input
    };
}

const messageBattleInitPlayer = transform(
    sequence(word("player"), playerId, anyWord),
    ([_, id, username]) => ({id, username}));

const messageBattleInitTeamSize = transform(
    sequence(word("teamsize"), playerId, integer),
    ([_, id, size]) => ({id, size}));

const messageBattleInitGen = transform(sequence(word("gen"), integer),
        ([_, gen]) => gen);

const messageBattleInitTier = transform(sequence(word("tier"), restOfLine),
        ([_, tier]) => tier);

const messageBattleInitRated = transform(sequence(word("rated"), restOfLine),
        () => true);

const messageBattleInitRule = transform(sequence(word("rule"), restOfLine),
        ([_, rule]) => rule);

/** Parses a `battleprogress` multiline message */
const messageBattleProgress: MessageParser<"battleProgress"> =
    transform(battleEvents, events => ({type: "battleProgress", events}));

// battle event parsers

type EventParser<T extends psevent.Type> = Parser<psevent.Event<T>, string>;
type EventResult<T extends psevent.Type> =
    Result<psevent.Event<T> | null, string>;

/** Parses any number of BattleEvents. */
function battleEvents(input: Input, info: Info): Result<psevent.Any[], string>
{
    const result: psevent.Any[] = [];

    while (!input.done)
    {
        // invalid BattleEvents can throw, so filter those out
        try
        {
            const r = battleEvent(input, info);
            if (r.result) result.push(r.result);
            input = r.remaining;
        }
        catch (e) { info.logger.error(e); }

        // skip until next line (after the newline)
        input = skipLine(input, info).remaining.next();
    }

    return {result, remaining: input};
}

/**
 * Parses a BattleEvent with optional suffixes. Throws if invalid. Result
 * contains null if the event type is unsupported.
 */
function battleEvent(input: Input, info: Info): EventResult<psevent.Type>
{
    const r1 = battleEventHelper(input, info);
    if (!r1.result) return r1;

    // parse optional suffixes
    let event: psevent.Any = r1.result;
    while (!input.done && input.get() !== "\n")
    {
        const s = input.get();
        const matches = s.match(
            // matches "[x]" and "[x]y", where the named group "prefix" matches
            //  to "x" and "value" matches to "y" or the empty string
            /^\[(?<prefix>\w+)\](?<value>.*)/);
        if (matches && matches.groups)
        {
            const prefix = matches.groups.prefix;
            const value = matches.groups.value.trim();
            if (prefix === "of")
            {
                event = {...event, of: parsePokemonID(value)};
            }
            else if (prefix === "from")
            {
                // istanbul ignore else: not useful to test
                if (value) event = {...event, from: value};
            }
            else if (prefix === "fatigue") event = {...event, fatigue: true};
            else if (prefix === "eat") event = {...event, eat: true};
            else if (prefix === "miss") event = {...event, miss: true};
        }
        input = input.next();
    }

    r1.result = event;
    return r1;
}

/**
 * Parses a BattleEvent. Throws if invalid. Can also return null in the result
 * if the failure is meant to be silent.
 */
function battleEventHelper(input: Input, info: Info): EventResult<psevent.Type>
{
    switch (input.get() as psevent.Type)
    {
        case "\n": return eventEmpty(input, info);
        case "-ability": return eventAbility(input, info);
        case "-activate": return eventActivate(input, info);
        case "detailschange": case "drag": case "-formechange": case "switch":
            return eventAllDetails(input, info);
        case "-boost": return eventBoost(input, info);
        case "cant": return eventCant(input, info);
        case "-clearallboost": return eventClearAllBoost(input, info);
        case "-clearboost": return eventClearBoost(input, info);
        case "-clearnegativeboost": return eventClearNegativeBoost(input, info);
        case "-clearpositiveboost": return eventClearPositiveBoost(input, info);
        case "-copyboost": return eventCopyBoost(input, info);
        case "-crit": return eventCrit(input, info);
        case "-curestatus": return eventCureStatus(input, info);
        case "-cureteam": return eventCureTeam(input, info);
        case "-damage": case "-heal": case "-sethp":
            return eventDamage(input, info);
        case "-end": return eventEnd(input, info);
        case "-endability": return eventEndAbility(input, info);
        case "-fail": return eventFail(input, info);
        case "faint": return eventFaint(input, info);
        case "-fieldstart": case "-fieldend": return eventField(input, info);
        case "-hitcount": return eventHitCount(input, info);
        case "-immune": return eventImmune(input, info);
        case "-invertboost": return eventInvertBoost(input, info);
        case "-item": case "-enditem": return eventItem(input, info);
        case "-message": return eventMessage(input, info);
        case "-miss": return eventMiss(input, info);
        case "move": return eventMove(input, info);
        case "-mustrecharge": return eventMustRecharge(input, info);
        case "-notarget": return eventNoTarget(input, info);
        case "-prepare": return eventPrepare(input, info);
        case "-resisted": return eventResisted(input, info);
        case "-setboost": return eventSetBoost(input, info);
        case "-sideend": case "-sidestart": return eventSide(input, info);
        case "-singlemove": return eventSingleMove(input, info);
        case "-singleturn": return eventSingleTurn(input, info);
        case "-start": return eventStart(input, info);
        case "-status": return eventStatus(input, info);
        case "-supereffective": return eventSuperEffective(input, info);
        case "-swapboost": return eventSwapBoost(input, info);
        case "tie": return eventTie(input, info);
        case "-transform": return eventTransform(input, info);
        case "turn": return eventTurn(input, info);
        case "-unboost": return eventUnboost(input, info);
        case "upkeep": return eventUpkeep(input, info);
        case "-weather": return eventWeather(input, info);
        case "win": return eventWin(input, info);
        default:
            // silently ignore this message line
            return {result: null, remaining: input};
    }
}

/**
 * Parses an EmptyEvent.
 *
 * Format:
 * @example
 * |
 */
const eventEmpty: EventParser<"\n"> = (input, info) =>
    ({result: {type: "\n"}, remaining: input});

/**
 * Parses an AbilityEvent.
 *
 * Format:
 * @example
 * |-ability|<PokemonID>|<ability name>
 */
const eventAbility: EventParser<"-ability"> = transform(
    sequence(word("-ability"), pokemonId, anyWord),
    ([type, id, ability]) => ({type, id, ability}));

/**
 * Parses an ActivateEvent.
 *
 * Format:
 * @example
 * |-activate|<PokemonID>|<volatile status>
 */
const eventActivate: EventParser<"-activate"> = transform(
    sequence(word("-activate"), pokemonId, anyWord, eventActivateHelper),
    ([type, id, volatile, otherArgs]) => ({type, id, volatile, otherArgs}));

/**
 * Parses the `otherArgs` part of an `|-activate|` or `|-start|` event
 * without accidentally parsing a suffix.
 */
function eventActivateHelper(input: Input, info: Info): Result<string[], string>
{
    const result: string[] = [];

    while (!input.done && input.get() !== "\n")
    {
        const s = input.get();
        if (!s.startsWith("[")) result.push(s);
        input = input.next();
    }

    return {result, remaining: input};
}

/**
 * Parses a BoostEvent.
 *
 * Format:
 * @example
 * |-boost|<PokemonID>|<stat name>|<amount>
 */
const eventBoost: EventParser<"-boost"> = transform(
    sequence(word("-boost"), pokemonId, boostName, integer),
    ([type, id, stat, amount]) => ({type, id, stat, amount}));

/**
 * Parses a CantEvent.
 *
 * Format:
 * @example
 * |cant|<PokemonID>|<reason>|<move (optional)>
 */
const eventCant: EventParser<"cant"> = transform(
    sequence(word("cant"), pokemonId, anyWord, eventCantHelper),
    ([type, id, reason, moveName]) =>
        moveName ? {type, id, reason, moveName} : {type, id, reason});

/**
 * Parses the `moveName` part of a `|cant|` message without accidentally parsing
 * a suffix.
 */
function eventCantHelper(input: Input, info: Info):
    Result<string | undefined, string>
{
    const s = input.get();
    if (s.startsWith("[") || s === "\n")
    {
        return {result: undefined, remaining: input};
    }
    return {result: s, remaining: input.next()};
}

/**
 * Parses a ClearAllBoostEvent.
 *
 * Format:
 * @example
 * |-clearallboost
 */
const eventClearAllBoost: EventParser<"-clearallboost"> =
    transform(word("-clearallboost"), type => ({type}));

/**
 * Parses a ClearBoostEvent.
 *
 * Format:
 * @example
 * |-clearboost|<PokemonID>
 */
const eventClearBoost: EventParser<"-clearboost"> = transform(
    sequence(word("-clearboost"), pokemonId), ([type, id]) => ({type, id}));

/**
 * Parses a ClearNegativeBoostEvent.
 *
 * Format:
 * @example
 * |-clearnegativeboost|<PokemonID>
 */
const eventClearNegativeBoost: EventParser<"-clearnegativeboost"> = transform(
    sequence(word("-clearnegativeboost"), pokemonId),
    ([type, id]) => ({type, id}));

/**
 * Parses a ClearPositiveBoostEvent.
 *
 * Format:
 * @example
 * |-clearpositiveboost|<PokemonID>
 */
const eventClearPositiveBoost: EventParser<"-clearpositiveboost"> = transform(
    sequence(word("-clearpositiveboost"), pokemonId),
    ([type, id]) => ({type, id}));

/**
 * Parses a CopyBoostEvent.
 *
 * Format:
 * @example
 * |-copyboost|<source PokemonID>|<target PokemonID>
 */
const eventCopyBoost: EventParser<"-copyboost"> = transform(
    sequence(word("-copyboost"), pokemonId, pokemonId),
    ([type, source, target]) => ({type, source, target}));

/**
 * Parses a CritEvent.
 *
 * Format:
 * @example
 * |-crit|<PokemonID>
 */
const eventCrit: EventParser<"-crit"> =
    transform(sequence(word("-crit"), pokemonId), ([type, id]) => ({type, id}));

/**
 * Parses a CureStatusEvent.
 *
 * Format:
 * @example
 * |-curestatus|<PokemonID>|<cured MajorStatus>
 */
const eventCureStatus: EventParser<"-curestatus"> = transform(
    sequence(word("-curestatus"), pokemonId, majorStatus),
    ([type, id, status]) => ({type, id, majorStatus: status}));

/**
 * Parses a CureTeamEvent.
 *
 * Format:
 * @example
 * |-cureteam|<PokemonID>
 */
const eventCureTeam: EventParser<"-cureteam"> = transform(
    sequence(word("-cureteam"), pokemonId), ([type, id]) => ({type, id}));

/**
 * Parses a DamageEvent, HealEvent, or SetHPEvent.
 *
 * Format:
 * @example
 * |<-damage or -heal or -sethp>|<PokemonID>|<new PokemonStatus>
 */
const eventDamage: EventParser<"-damage" | "-heal" | "-sethp"> = transform(
    sequence(word("-damage", "-heal", "-sethp"), pokemonId, pokemonStatus),
    ([type, id, status]) => ({type, id, status}));

/**
 * Parses an EndEvent.
 *
 * Format:
 * @example
 * |-end|<PokemonID>|<volatile status>
 */
const eventEnd: EventParser<"-end"> = transform(
    sequence(word("-end"), pokemonId, anyWord),
    ([type, id, volatile]) => ({type, id, volatile}));

/**
 * Parses an EndAbilityEvent.
 *
 * Format:
 * @example
 * |-endability|<PokemonID>|<ability name>
 */
const eventEndAbility: EventParser<"-endability"> = transform(
    sequence(word("-endability"), pokemonId, anyWord),
    ([type, id, ability]) => ({type, id, ability}));

/**
 * Parses a FailEvent.
 *
 * Format:
 * @example
 * |-fail|<PokemonID>
 */
const eventFail: EventParser<"-fail"> =
    transform(sequence(word("-fail"), pokemonId, maybe(anyWord)),
        ([type, id, reason]) => ({type, id, ...(reason && {reason})}));

/**
 * Parses a FaintEvent.
 *
 * Format:
 * @example
 * |faint|<PokemonID>
 */
const eventFaint: EventParser<"faint"> =
    transform(sequence(word("faint"), pokemonId), ([type, id]) => ({type, id}));

/**
 * Parses a FieldStartEvent or FieldEndEvent.
 *
 * Format:
 * @example
 * |<-fieldstart or -fieldend>|<effect>
 */
const eventField: EventParser<"-fieldend" | "-fieldstart"> = transform(
    sequence(word("-fieldend", "-fieldstart"), anyWord),
    ([type, effect]) => ({type, effect}));

/**
 * Parses a HitCountEvent.
 *
 * Format:
 * @example
 * |<-hitcount>|<PokemonID>|<# of hits>
 */
const eventHitCount: EventParser<"-hitcount"> = transform(
    sequence(word("-hitcount"), pokemonId, integer),
    ([type, id, count]) => ({type, id, count}));

/**
 * Parses an ImmuneEvent.
 *
 * Format:
 * @example
 * |-immune|<PokemonID>
 */
const eventImmune: EventParser<"-immune"> = transform(
    sequence(word("-immune"), pokemonId), ([type, id]) => ({type, id}));

/**
 * Parses an InvertBoostEvent.
 *
 * Format:
 * @example
 * |-invertboost|<PokemonID>
 */
const eventInvertBoost: EventParser<"-invertboost"> = transform(
    sequence(word("-invertboost"), pokemonId), ([type, id]) => ({type, id}));

/**
 * Parses an ItemEvent or EndItemEvent.
 *
 * Format:
 * @example
 * |<-item or -enditem>|<PokemonID>|<item name>
 */
const eventItem: EventParser<"-enditem" | "-item"> = transform(
    sequence(word("-enditem", "-item"), pokemonId, anyWord),
    ([type, id, item]) => ({type, id, item}));

/**
 * Parses a Message event.
 *
 * Format:
 * @example
 * |-message|MESSAGE
 */
const eventMessage: EventParser<"-message"> = transform(
    sequence(word("-message"), restOfLine),
    ([type, msg]) => ({type, message: msg}));

/**
 * Parses a MissEvent.
 *
 * Format:
 * @example
 * |-miss|<user PokemonID>|<target PokemonID>
 */
const eventMiss: EventParser<"-miss"> = transform(
    sequence(word("-miss"), pokemonId, pokemonId),
    ([type, id, targetId]) => ({type, id, targetId}));

/**
 * Parses a MoveEvent.
 *
 * Format:
 * @example
 * |move|<user PokemonID>|<move name>|<optional target PokemonID>
 *
 * // optional message suffixes (may parse later?)
 * |[miss]
 * |[still]
 */
const eventMove: EventParser<"move"> = transform(
    sequence(word("move"), pokemonId, anyWord, maybe(pokemonId)),
    ([type, id, moveName, targetId]) =>
        targetId ? {type, id, moveName, targetId} : {type, id, moveName});

/**
 * Parses a MustRechargeEvent.
 *
 * Format:
 * @example
 * |-mustrecharge|<PokemonID>
 */
const eventMustRecharge: EventParser<"-mustrecharge"> = transform(
    sequence(word("-mustrecharge"), pokemonId), ([type, id]) => ({type, id}));

/**
 * Parses a NoTargetEvent.
 *
 * Format:
 * @example
 * |-notarget|<PokemonID>
 */
const eventNoTarget: EventParser<"-notarget"> = transform(
    sequence(word("-notarget"), pokemonId), ([type, id]) => ({type, id}));

/**
 * Parses a PrepareEvent.
 *
 * Format:
 * @example
 * |-prepare|<user PokemonID>|<move name>|<optional target PokemonID>
 */
const eventPrepare: EventParser<"-prepare"> = transform(
    sequence(word("-prepare"), pokemonId, anyWord, maybe(pokemonId)),
    ([type, id, moveName, targetId]) =>
        targetId ? {type, id, moveName, targetId} : {type, id, moveName});

/**
 * Parses a ResistedEvent.
 *
 * Format:
 * @example
 * |-resisted|<PokemonID>
 */
const eventResisted: EventParser<"-resisted"> = transform(
    sequence(word("-resisted"), pokemonId), ([type, id]) => ({type, id}));

/**
 * Parses a SetBoostEvent.
 *
 * Format:
 * @example
 * |-setboost|<PokemonID>|<stat name>|<amount>
 */
const eventSetBoost: EventParser<"-setboost"> = transform(
    sequence(word("-setboost"), pokemonId, boostName, integer),
    ([type, id, stat, amount]) => ({type, id, stat, amount}));

/**
 * Parses a SideEndEvent or SideStartEvent.
 *
 * Format:
 * @example
 * |<-sideend or -sidestart>|<PlayerID>: <username>|<condition>
 */
const eventSide: EventParser<"-sideend" | "-sidestart"> = transform(
    sequence(word("-sideend", "-sidestart"), playerIdWithName, anyWord),
    ([type, {id}, condition]) => ({type, id, condition}));

/**
 * Parses a SingleMoveEvent.
 *
 * Format:
 * @example
 * |-singlemove|<PokemonID>|<move name>
 */
const eventSingleMove: EventParser<"-singlemove"> = transform(
    sequence(word("-singlemove"), pokemonId, anyWord),
    ([type, id, move]) => ({type, id, move}));

/**
 * Parses a SingleTurnEvent.
 *
 * Format:
 * @example
 * |-singleturn|<PokemonID>|<status>
 */
const eventSingleTurn: EventParser<"-singleturn"> = transform(
    sequence(word("-singleturn"), pokemonId, anyWord),
    ([type, id, status]) => ({type, id, status}));

/**
 * Parses a StartEvent.
 *
 * Format:
 * @example
 * |-start|<PokemonID>|<volatile>|<other args>
 *
 * // optional message suffixes:
 * [fatigue]
 */
const eventStart: EventParser<"-start"> = transform(
    sequence(word("-start"), pokemonId, anyWord, eventActivateHelper),
    ([type, id, volatile, otherArgs]) => ({type, id, volatile, otherArgs}));

/**
 * Parses a StatusEvent.
 *
 * Format:
 * @example
 * |-status|<PokemonID>|<new MajorStatus>
 */
const eventStatus: EventParser<"-status"> = transform(
    sequence(word("-status"), pokemonId, majorStatus),
    ([type, id, status]) => ({type, id, majorStatus: status}));

/**
 * Parses a SuperEffectiveEvent.
 *
 * Format:
 * @example
 * |-supereffective|<PokemonID>
 */
const eventSuperEffective: EventParser<"-supereffective"> = transform(
    sequence(word("-supereffective"), pokemonId), ([type, id]) => ({type, id}));

/**
 * Parses a SwapBoostEvent.
 *
 * Format:
 * @example
 * |-swapboost|<PokemonID>|<other PokemonID>|<optional <stat1>, <stat2>, <...>>
 */
const eventSwapBoost: EventParser<"-swapboost"> = transform(
    sequence(
        word("-swapboost"), pokemonId, pokemonId,
        maybe(
            // parse comma-separated list of boost names
            input =>
            ({
                result: input.get().split(", ").map(parseBoostName),
                remaining: input.next()
            }),
            // if omitted, assume all boosts
            Object.keys(boostNames) as BoostName[])),
    ([type, source, target, stats]) => ({type, source, target, stats}));

/**
 * Parses a DetailsChangeEvent, DragEvent, FormeChangeEvent, or SwitchEvent.
 *
 * Format:
 * @example
 * |<switch or drag or detailschange or -formechange>|<replacing PokemonID>|\
 * <PokemonDetails>|<PokemonStatus>
 */
const eventAllDetails:
    EventParser<"switch" | "drag" | "detailschange" | "-formechange"> =
    transform(
        sequence(
            word("switch", "drag", "detailschange", "-formechange"), pokemonId,
            pokemonDetails, pokemonStatus),
        ([type, id, details, status]) => ({type, id, ...details, ...status}));

/**
 * Parses an UnboostEvent.
 *
 * Format:
 * @example
 * |-unboost|<PokemonID>|<stat name>|<amount>
 */
const eventUnboost: EventParser<"-unboost"> = transform(
    sequence(word("-unboost"), pokemonId, boostName, integer),
    ([type, id, stat, amount]) => ({type, id, stat, amount}));

/**
 * Parses an UpkeepEvent.
 *
 * Format:
 * @example
 * |upkeep
 */
const eventUpkeep: EventParser<"upkeep"> =
    transform(word("upkeep"), () => ({type: "upkeep"}));

/**
 * Parses a TurnEvent.
 *
 * Format:
 * @example
 * |turn|<new turn number>
 */
const eventTurn: EventParser<"turn"> =
    transform(sequence(word("turn"), integer), ([type, num]) => ({type, num}));

/**
 * Parses a TieEvent.
 *
 * Format:
 * @example
 * |tie
 */
const eventTie: EventParser<"tie"> =
    transform(word("tie"), () => ({type: "tie"}));

/**
 * Parses a TransformEvent.
 *
 * Format:
 * @example
 * |-transform|<source PokemonID>|<target PokemonID>
 */
const eventTransform: EventParser<"-transform"> = transform(
    sequence(word("-transform"), pokemonId, pokemonId),
    ([type, source, target]) => ({type, source, target}));

/**
 * Parses a WeatherEvent.
 *
 * Format:
 * @example
 * |-weather|<WeatherType>|<optional [upkeep] or AbilityCause or MoveCause>
 */
const eventWeather: EventParser<"-weather"> = transform(
    sequence(
        word("-weather"),
        weatherTypeOrNone,
        // transform presence of upkeep word into boolean
        transform(maybe(word("[upkeep]")), upkeep => !!upkeep)),
    ([type, weatherType, upkeep]) => ({type, weatherType, upkeep}));

/**
 * Parses a WinEvent.
 *
 * Format:
 * @example
 * |win|<username>
 */
const eventWin: EventParser<"win"> = transform(
    sequence(word("win"), restOfLine), ([type, winner]) => ({type, winner}));
