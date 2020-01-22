import { expect } from "chai";
import "mocha";
import { PSBattle } from "../../src/psbot/PSBattle";
import { BattleAgent } from "../../src/battle/agent/BattleAgent";
import { Sender } from "../../src/psbot/PSBot";
import { Logger } from "../../src/Logger";
import { RequestMessage } from "../../src/psbot/parser/Message";

describe("PSBattle", function()
{
    const username = "username";
    const agent: BattleAgent = {async decide() {}};

    let sender: Sender;
    let sent: string[];

    let battle: PSBattle;

    beforeEach("Initialize sender", function()
    {
        sent = [];
        sender = msg => sent.push(msg);
    });

    beforeEach("Initialize PSBattle", function()
    {
        battle = new PSBattle(username, agent, sender, Logger.null);
    });

    describe("ability trapping", function()
    {
        it("Should handle unavailable choice", async function()
        {
            // configure agent to try and switch out each turn
            agent.decide = async function(state, choices)
            {
                // swap in a switch choice into the top slot
                const i = choices.indexOf("switch 2");
                if (i < 0) return;
                [choices[0], choices[i]] = [choices[i], choices[0]];
            };

            // receive request
            const request: RequestMessage =
            {
                type: "request",
                active:
                [
                    {
                        moves:
                        [
                            {
                                move: "Splash", id: "splash", pp: 64, maxpp: 64,
                                target: "self", disabled: false
                            },
                            {
                                move: "Tackle", id: "tackle", pp: 56, maxpp: 56,
                                target: "adjacentFoe", disabled: false
                            },
                            {
                                move: "Bounce", id: "bounce", pp: 8, maxpp: 8,
                                target: "adjacentFoe", disabled: false
                            },
                            {
                                move: "Flail", id: "Flail", pp: 24, maxpp: 24,
                                target: "adjacentFoe", disabled: false
                            }
                        ]
                    }
                ],
                side: {pokemon:
                [
                    {
                        owner: "p1", nickname: "Magikarp", species: "Magikarp",
                        shiny: true, gender: "M", level: 50, hp: 100,
                        hpMax: 100, condition: null, active: true,
                        stats: {atk: 30, def: 75, spa: 35, spd: 40, spe: 100},
                        moves: ["splash", "tackle", "bounce", "flail"],
                        baseAbility: "swiftswim", item: "lifeorb",
                        pokeball: "pokeball"
                    },
                    {
                        owner: "p1", nickname: "Mewtwo",
                        species: "Mewtwo", shiny: false, gender: null,
                        level: 100, hp: 353, hpMax: 353, condition: null,
                        active: false,
                        stats:
                        {
                            atk: 256, def: 216, spa: 344, spd: 216, spe: 296
                        },
                        moves: ["psychocut"], baseAbility: "pressure",
                        item: "leftovers", pokeball: "masterball"
                    }
                ]}
            };
            await battle.request(request);

            // receive switchins
            // opponent switches in a pokemon that can have shadowtag,
            await battle.init(
            {
                type: "battleinit", id: "p1", username, gameType: "singles",
                gen: 4, teamSizes: {p1: 2, p2: 1},
                events:
                [
                    {
                        type: "switch", id: {owner: "p1", nickname: "Magikarp"},
                        species: "Magikarp", shiny: true, gender: "M",
                        level: 50, hp: 100, hpMax: 100, condition: null
                    },
                    {
                        type: "switch",
                        id: {owner: "p2", nickname: "Wobbuffet"},
                        species: "Wobbuffet", shiny: false, gender: "M",
                        level: 50, hp: 100, hpMax: 100, condition: null
                    }
                ]
            });

            // client sends a switch decision
            expect(sent).to.have.members(["|/choose switch 2"]);

            // unavailable choice
            await battle.error(
            {
                type: "error",
                reason: "[Unavailable choice] Can't switch: The active " +
                    "Pokémon is trapped"
            });

            // new request with trapped=true
            await battle.request(
            {
                ...request,
                active:
                [{
                    ...request.active![0],
                    trapped: true
                }]
            });

            // make a move decision
            expect(sent).to.have.members(
                ["|/choose switch 2", "|/choose move 2"]);
        });
    });
});
