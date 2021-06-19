/**
 * @file Specifies how events are parsed during the initialization phase of a
 * battle.
 */
import { Protocol } from "@pkmn/protocol";
import { GenerationNum, StatID } from "@pkmn/types";
import { BattleParserContext, consume, peek, unordered } from "../../../parser";
import { HPType } from "../dex";
import { BattleState } from "../state";
import { TeamRevealOptions } from "../state/Team";

/**
 * Parses the initialization step of a battle up to but not including the first
 * switch-ins.
 */
export async function init(ctx: BattleParserContext<"gen4">)
{
    // initialization events
    await unordered.expectUnordered(ctx,
    [
        ignoredUpToStart(), initBattle(), gameType(), player(1),
        request(/*first*/ true), player(2), teamSize(1), teamSize(2), gen(4),
        tier()
        // TODO: |rated|, |seed|, |split|, |teampreview|, |clearpoke|, |poke|,
        //  |rule|
    ]);
}

/** Consumes all irrelevant events up to the final `|start` event. */
const ignoredUpToStart = () =>
    unordered.createUnorderedDeadline(
        async function ignoredEventsParser(ctx, accept)
        {
            const event = await peek(ctx);
            switch (event.args[0])
            {
                case "init": case "gametype": case "player": case "request":
                case "player": case "teamsize": case "gen": case "tier":
                    break;
                case "start":
                    // initialization phase ends on the |start event
                    accept();
                    // fallthrough
                default:
                    // consume event but don't accept it so the parser can be
                    //  called again later to consume another irrelevant event
                    await consume(ctx);
            }
        },
        () => { throw new Error("Expected |start event"); });

const initBattle = () =>
    unordered.createUnorderedDeadline(
        async function initBattleParser(ctx, accept)
        {
            const event = await peek(ctx);
            if (event.args[0] !== "init") return;
            accept();

            if (event.args[1] !== "battle")
            {
                throw new Error("Expected room type 'battle' but got " +
                    `'${event.args[1]}'`)
            }
            await consume(ctx);
        }
        // note: this message isn't shown if we're not in a battle room, e.g.
        //  when using the sim's battle stream api, hence why reject is empty
        );

const gameType = () =>
    unordered.createUnorderedDeadline(
        async function gameTypeParser(ctx, accept)
        {
            const event = await peek(ctx);
            if (event.args[0] !== "gametype") return;
            accept();

            if (event.args[1] !== "singles")
            {
                throw new Error("Expected game type 'singles' but got " +
                    `'${event.args[1]}'`);
            }
            await consume(ctx);
        },
        () => { throw new Error("Expected |gametype|singles event"); });

const player = (num: 1 | 2) =>
    unordered.createUnorderedDeadline(
        async function playerParser(ctx, accept)
        {
            const event = await peek(ctx);
            if (event.args[0] !== "player" ||
                event.args[1] !== `p${num}` as const)
            {
                return;
            }
            accept();

            if (ctx.state.username === event.args[2])
            {
                ctx.state.ourSide = event.args[1];
            }
            await consume(ctx);
        },
        () => { throw new Error(`Expected |player|p${num}| event`); });

const request = (first?: boolean) =>
    unordered.createUnorderedDeadline(
        async function requestParser(ctx, accept)
        {
            const event = await peek(ctx);
            if (event.args[0] !== "request") return;
            accept();

            // only the first |request| msg can be used to initialize the
            //  client's team
            if (first)
            {
                initRequest(ctx.state, Protocol.parseRequest(event.args[1]))
            }
            await consume(ctx);
        },
        () => { throw new Error("Expected |request| event"); });

const teamSize = (num: 1 | 2) =>
    unordered.createUnorderedDeadline(
        async function teamSizeParser(ctx, accept)
        {
            const event = await peek(ctx);
            if (event.args[0] !== "teamsize" ||
                event.args[1] !== `p${num}` as const)
            {
                return;
            }
            accept();

            // client's side should be initialized by the first |request| msg
            const [_, sideId, sizeStr] = event.args;
            if (ctx.state.ourSide !== sideId)
            {
                const size = Number(sizeStr);
                ctx.state.getTeam(sideId).size = size;
            }
            await consume(ctx);
        },
        () => { throw new Error(`Expected |teamsize|p${num}| event`); });

const gen = (num: GenerationNum) =>
    unordered.createUnorderedDeadline(
        async function genParser(ctx, accept)
        {
            const event = await peek(ctx);
            if (event.args[0] !== "gen") return;
            accept();

            const [_, genNum] = event.args;
            if (num !== genNum)
            {
                throw new Error(`Expected |gen|${num} event but got ` +
                    `|gen|${genNum}`);
            }
            // TODO: record gen?
            await consume(ctx);
        });

const tier = () =>
    unordered.createUnorderedDeadline(
        async function tierParser(ctx, accept)
        {
            const event = await peek(ctx);
            if (event.args[0] !== "tier") return;
            accept();

            // TODO: record tier?
            await consume(ctx);
        });

const rule = () =>
    unordered.createUnorderedDeadline(
        async function ruleParser(ctx, accept)
        {
            const event = await peek(ctx);
            if (event.args[0] !== "rule") return;
            accept();

            // TODO: record rules/mods?
            // recursion in order to parse multiple rules
            await consume(ctx);
            await unordered.expectUnordered(ctx, [rule()]);
        });

/**
 * Initializes the client's side of the battle using an initial `|request|`
 * message JSON.
 */
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
            gender: reqMon.gender ?? "N", hp: reqMon.hp, hpMax: reqMon.maxhp,
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
