/**
 * @file Specifies how events are parsed during the initialization of a battle
 * room.
 */
import { Protocol } from "@pkmn/protocol";
import { GenerationNum, StatID } from "@pkmn/types";
import { expectEvents } from "../../../../../../battle/parser/inference";
import { Event } from "../../../../../parser";
import { ParserContext } from "../../formats";
import { HPType } from "../dex";
import { BattleState } from "../state";
import { TeamRevealOptions } from "../state/Team";
import { singleEventInference, SingleEventInfPredicate } from "./helpers";

export async function init(ctx: ParserContext<"gen4">)
{
    // initialization events
    await expectEvents(ctx,
    [
        initBattle(), gameType(), player(1), request(/*first*/ true), player(2),
        teamSize(1), teamSize(2), gen(4), tier()
        // TODO: |rated|, |seed|, |split|, |teampreview|, |clearpoke|, |poke|
        // TODO: how to ignore irrelevant events?
    ]);
    // blank
    await expectEvents(ctx, [done()]);
    // |start event indicating the start of the battle event loop
    await expectEvents(ctx, [start()]);
}

const initBattle = () =>
    singleEventInference(
        (event => event.args[0] === "init") as
            SingleEventInfPredicate<Event<"|init|">>,
        async function initBattleParser(ctx, event)
        {
            if (event.args[1] !== "battle")
            {
                throw new Error("Expected room type 'battle' but got " +
                    `'${event.args[1]}'`)
            }
        },
        // this message isn't shown if we're not in a battle room, e.g. when
        //  using the sim's battle stream api
        () => {});

const gameType = () =>
    singleEventInference(
        (event => event.args[0] === "gametype") as
            SingleEventInfPredicate<Event<"|gametype|">>,
        async function gameTypeParser(_ctx, event)
        {
            if (event.args[1] !== "singles")
            {
                throw new Error("Expected game type 'singles' but got " +
                    `'${event.args[1]}'`);
            }
        },
        () => { throw new Error("Expected |gametype| event"); });

const player = (num: 1 | 2) =>
    singleEventInference(
        (event => event.args[0] === "player" &&
                event.args[1] === `p${num}` as const) as
            SingleEventInfPredicate<Event<"|player|">>,
        async function playerParser(ctx, event)
        {
            if (ctx.state.username !== event.args[2]) return;
            ctx.state.ourSide = event.args[1];
        },
        () => { throw new Error(`Expected |player|p${num}| event`); });

const request = (first?: boolean) =>
    singleEventInference(
        (event => event.args[0] === "request") as
            SingleEventInfPredicate<Event<"|request|">>,
        async function requestParser(ctx, event)
        {
            // only the first |request| msg can be used to initialize the
            //  client's team
            if (!first) return;
            initRequest(ctx.state, Protocol.parseRequest(event.args[1]))
        },
        () => { throw new Error("Expected |request| event"); });

const teamSize = (num: 1 | 2) =>
    singleEventInference(
        (event => event.args[0] === "teamsize" &&
                event.args[1] === `p${num}` as const) as
            SingleEventInfPredicate<Event<"|teamsize|">>,
        async function teamSizeParser(ctx, event)
        {
            // client's side should be initialized by the first |request| msg
            const [_, sideId, sizeStr] = event.args;
            if (ctx.state.ourSide === sideId) return;
            const size = Number(sizeStr);
            ctx.state.getTeam(sideId).size = size;
        },
        () => { throw new Error(`Expected |teamsize|p${num}| event`); });

const gen = (num: GenerationNum) =>
    singleEventInference(
        (event => event.args[0] === "gen") as
            SingleEventInfPredicate<Event<"|gen|">>,
        async function genParser(ctx, event)
        {
            const [_, genNum] = event.args;
            if (num !== genNum)
            {
                throw new Error(`Expected |gen|${num} event but got ` +
                    `|gen|${genNum}`);
            }
            // TODO: record gen?
        });

const tier = () =>
    singleEventInference(
        (event => event.args[0] === "tier") as
            SingleEventInfPredicate<Event<"|tier|">>,
        async function tierParser(ctx, event)
        {
            // TODO: record tier?
        });

const rule = () =>
    singleEventInference(
        (event => event.args[0] === "rule") as
            SingleEventInfPredicate<Event<"|rule|">>,
        async function ruleParser(ctx, event)
        {
            // TODO: record rules/mods?
            // recursion in order to parse multiple rules
            await expectEvents(ctx, [rule()]);
        });

const done = () =>
    singleEventInference(
        (event => event.args[0] === "done") as
            SingleEventInfPredicate<Event<"|done|">>,
        async () => {},
        () => { throw new Error(`Expected |done| event`); });

const start = () =>
    singleEventInference(
        (event => event.args[0] === "start") as
            SingleEventInfPredicate<Event<"|start|">>,
        async () => {},
        () => { throw new Error(`Expected |start event`); });

function initRequest(state: BattleState, req: Protocol.Request)
{
    if (!req.side) return;

    if (state.ourSide)
    {
        if (req.side.id !== state.ourSide)
        {
            throw new Error("Expected |request| with " +
                `side.id = '${state.ourSide}' but got ` +
                `'${req.side.id}'`);
        }
    }
    else state.ourSide = req.side.id;

    if (req.side.name !== state.username)
    {
        throw new Error("Expected |request| with " +
            `side.name = '${state.username}' but got ` +
            `'${req.side.name}'`);
    }

    const team = state.getTeam(state.ourSide);
    team.size = req.side.pokemon.length;
    for (const reqMon of req.side.pokemon)
    {
        // preprocess moves to possibly extract hiddenpower type and happiness
        const moves: string[] = [];
        let hpType: HPType | null = null;
        let happiness: number | null = null;
        for (const moveId of reqMon.moves)
        {
            if (moveId.startsWith("hiddenpower") &&
                moveId.length > "hiddenpower".length)
            {
                // format: hiddenpower<type><base power if gen2-5>
                hpType = moveId.substr("hiddenpower".length)
                        .replace(/\d+/, "") as HPType;
                moves.push("hiddenpower");
            }
            else if (moveId.startsWith("return") &&
                moveId.length > "return".length)
            {
                // format: return<base power>
                // equation: base power = happiness / 2.5
                happiness = 2.5 *
                    parseInt(moveId.substr("return".length), 10);
                moves.push("return");
            }
            else if (moveId.startsWith("frustration") &&
                moveId.length > "frustration".length)
            {
                // format: frustration<base power>
                // equation: base power = (255-happiness) / 2.5
                happiness = 255 - 2.5 *
                        parseInt(moveId.substr("frustration".length), 10);
                moves.push("frustration");
            }
            else moves.push(moveId);
        }

        const revealOpts: TeamRevealOptions =
        {
            species: reqMon.name, level: reqMon.level,
            gender: reqMon.gender ?? null, hp: reqMon.hp, hpMax: reqMon.maxhp,
            moves
        };
        const mon = team.reveal(revealOpts)!;

        if (hpType) mon.hpType.narrow(hpType);
        mon.happiness = happiness;

        mon.baseTraits.stats.hp.set(reqMon.maxhp);
        for (const stat in reqMon.stats)
        {
            // istanbul ignore if
            if (!reqMon.stats.hasOwnProperty(stat)) continue;
            const id = stat as Exclude<StatID, "hp">;
            mon.baseTraits.stats[id].set(reqMon.stats[id]);
        }

        mon.baseTraits.ability.narrow(reqMon.baseAbility)
        mon.setItem(reqMon.item);
    }
}
