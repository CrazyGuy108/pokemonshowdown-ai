import { expect } from "chai";
import "mocha";
import { isNumber } from "util";
import { encodeBattleState, encodeHP, encodeMove, encodeMoveset,
    encodePokemon, encodePossiblityClass, encodeRoomStatus, encodeTeam,
    encodeTeamStatus, encodeVolatileStatus, encodeWeather, limitedStatusTurns,
    oneHot, sizeActivePokemon, sizeBattleState, sizeMove, sizeMoveset,
    sizePokemon, sizeRoomStatus, sizeTeam, sizeTeamStatus, sizeVolatileStatus,
    sizeWeather, tempStatusTurns } from "../../src/ai/encodeBattleState";
import { BattleState } from "../../src/battle/state/BattleState";
import { HP } from "../../src/battle/state/HP";
import { Move } from "../../src/battle/state/Move";
import { Moveset } from "../../src/battle/state/Moveset";
import { Pokemon } from "../../src/battle/state/Pokemon";
import { PossibilityClass } from "../../src/battle/state/PossibilityClass";
import { RoomStatus } from "../../src/battle/state/RoomStatus";
import { Team } from "../../src/battle/state/Team";
import { TeamStatus } from "../../src/battle/state/TeamStatus";
import { VolatileStatus } from "../../src/battle/state/VolatileStatus";
import { Weather } from "../../src/battle/state/Weather";

describe("BattleState encoders", function()
{
    describe("oneHot()", function()
    {
        it("Should encode class of values", function()
        {
            expect(oneHot(1, 3)).to.have.members([0, 1, 0]);
        });

        it("Should output 0's if index is null", function()
        {
            expect(oneHot(null, 3)).to.have.members([0, 0, 0]);
        });
    });

    describe("tempStatusTurns()", function()
    {
        it("Should return 0 if given 0", function()
        {
            expect(tempStatusTurns(0)).to.equal(0);
        });

        it("Should decrease status likelihood", function()
        {
            expect(tempStatusTurns(2)).to.equal(1 / 2);
        });
    });

    describe("limitedStatusTurns()", function()
    {
        it("Should interpolate status turns", function()
        {
            expect(limitedStatusTurns(3, 5)).to.equal(1 / 5);
        });

        it("Should return 0 if no more turns left", function()
        {
            expect(limitedStatusTurns(1, 2)).to.equal(0);
        });

        it("Should return 0 if at/over duration", function()
        {
            expect(limitedStatusTurns(2, 2)).to.equal(0);
        });
    });

    interface CaseArgsBase<TState>
    {
        name?: string;
        init(): TState;
    }

    interface CaseArgsSize<TState> extends CaseArgsBase<TState>
    {
        size: number;
        values?: undefined;
    }

    interface CaseArgsValues<TState> extends CaseArgsBase<TState>
    {
        size?: undefined;
        values?: number[];
    }

    type CaseArgs<TState> = CaseArgsSize<TState> | CaseArgsValues<TState>;

    function testEncoder<TState>(name: string,
        encoder: (state: TState) => number[], ...cases: CaseArgs<TState>[]):
        void
    {
        describe(`encode${name}()`, function()
        {
            for (let i = 0; i < cases.length; ++i)
            {
                const c = cases[i];
                describe(`Case ${i + 1}${c.name ? ` (${c.name})` : ""}`,
                function()
                {
                    let state: TState;

                    beforeEach(`Initialize ${name}`, function()
                    {
                        state = c.init();
                    });

                    if (c.values)
                    {
                        const values = c.values;
                        it(`Should be [${values.join(", ")}]`, function()
                        {
                            expect(encoder(state)).to.have.members(values);
                        });
                    }
                    else if (c.size)
                    {
                        const size = c.size;
                        it(`Should have length of ${size} and contain only ` +
                            "finite numbers", function()
                        {
                            const data = encoder(state);
                            expect(data).to.have.lengthOf(size);
                            for (const x of data)
                            {
                                expect(isNumber(x)).to.be.true;
                                expect(isFinite(x)).to.be.true;
                            }
                        });
                    }
                });
            }
        });
    }

    const map = {a: 0, b: 1, c: 2};
    testEncoder("PossibilityClass",
        (pc: PossibilityClass<number>) => encodePossiblityClass(pc, x => x, 3),
    {
        init: () => new PossibilityClass(map),
        values: [1 / 3, 1 / 3, 1 / 3]
    },
    {
        name: "Fully narrowed",
        init()
        {
            const pc = new PossibilityClass(map);
            pc.narrow("b");
            return pc;
        },
        values: [0, 1, 0]
    },
    {
        name: "Overnarrowed",
        init()
        {
            const pc = new PossibilityClass(map);
            expect(() => pc.narrow()).to.throw();
            return pc;
        },
        values: [0, 0, 0]
    });

    testEncoder("VolatileStatus", encodeVolatileStatus,
    {
        init: () => new VolatileStatus(),
        size: sizeVolatileStatus
    });

    testEncoder("Move", encodeMove,
    {
        init: () => new Move(),
        size: sizeMove
    });

    testEncoder("Moveset", encodeMoveset,
    {
        init: () => new Moveset(),
        size: sizeMoveset
    });

    testEncoder("HP", encodeHP,
    {
        name: "Uninitialized",
        init: () => new HP(/*isPercent*/false),
        values: [0, 0]
    },
    {
        name: "Initialized",
        init()
        {
            const hp = new HP(/*isPercent*/false);
            hp.set(50, 100);
            return hp;
        },
        values: [50, 100]
    });

    testEncoder("Pokemon", encodePokemon,
    {
        name: "Inactive",
        init: () => new Pokemon("Magikarp", /*hpPercent*/false),
        size: sizePokemon
    },
    {
        name: "Active",
        init()
        {
            const mon = new Pokemon("Magikarp", /*hpPercent*/false);
            mon.switchIn();
            return mon;
        },
        size: sizeActivePokemon
    });

    testEncoder("TeamStatus", encodeTeamStatus,
    {
        init: () => new TeamStatus(),
        size: sizeTeamStatus
    });

    testEncoder("Team", encodeTeam,
    {
        init()
        {
            const team = new Team("us");
            team.size = 1;
            team.switchIn("Magikarp", 100, "M", 100, 100);
            return team;
        },
        size: sizeTeam
    });

    testEncoder("Weather", encodeWeather,
    {
        init: () => new Weather(),
        size: sizeWeather
    });

    testEncoder("RoomStatus", encodeRoomStatus,
    {
        init: () => new RoomStatus(),
        size: sizeRoomStatus
    });

    testEncoder("BattleState", encodeBattleState,
    {
        init()
        {
            const state = new BattleState();
            state.teams.us.size = 1;
            state.teams.us.switchIn("Magikarp", 100, "M", 100, 100);
            state.teams.them.size = 1;
            state.teams.them.switchIn("Magikarp", 100, "M", 100, 100);
            return state;
        },
        size: sizeBattleState
    });
});