import { expect } from "chai";
import "mocha";
import { dex } from "../../../src/battle/dex/dex";
import { BoostName, boostNames } from "../../../src/battle/dex/dex-util";
import { Pokemon } from "../../../src/battle/state/Pokemon";
import { VolatileStatus } from "../../../src/battle/state/VolatileStatus";

describe("VolatileStatus", function()
{
    let volatile: VolatileStatus;

    beforeEach("Initialize VolatileStatus", function()
    {
        volatile = new VolatileStatus();
    });

    function setEverything()
    {
        volatile.aquaRing = true;
        volatile.boosts.atk = 1;
        volatile.confusion.start();
        volatile.embargo.start();
        volatile.focusEnergy = true;
        volatile.gastroAcid = true;
        volatile.ingrain = true;
        volatile.leechSeed = true;
        volatile.magnetRise.start();
        volatile.substitute = true;
        volatile.bide.start();
        volatile.charge.start();
        volatile.disabledMoves[0].start();
        volatile.encore.start();
        volatile.identified = "foresight";
        volatile.lastUsed = 1;
        volatile.lockedMove.start("outrage");
        volatile.minimize = true;
        volatile.mustRecharge = true;
        volatile.setOverrideSpecies(dex.pokemon.Slaking); // has truant ability
        volatile.overrideStats.linked = new Pokemon("Slaking", false);
        volatile.overrideStats.level = 100;
        volatile.addedType = "ice";
        volatile.roost = true;
        volatile.slowStart.start();
        volatile.stall(true);
        volatile.taunt.start();
        volatile.torment = true;
        volatile.twoTurn.start("solarbeam");
        volatile.unburden = true;
        volatile.uproar.start();
        volatile.activateTruant();
    }

    describe("#clear()", function()
    {
        it("Should clear all statuses", function()
        {
            setEverything();
            volatile.clear();

            expect(volatile.aquaRing).to.be.false;
            expect(volatile.boosts.atk).to.equal(0);
            expect(volatile.confusion.isActive).to.be.false;
            expect(volatile.embargo.isActive).to.be.false;
            expect(volatile.focusEnergy).to.be.false;
            expect(volatile.gastroAcid).to.be.false;
            expect(volatile.ingrain).to.be.false;
            expect(volatile.leechSeed).to.be.false;
            expect(volatile.magnetRise.isActive).to.be.false;
            expect(volatile.substitute).to.be.false;
            expect(volatile.bide.isActive).to.be.false;
            expect(volatile.charge.isActive).to.be.false;
            expect(volatile.disabledMoves[0].isActive).to.be.false;
            expect(volatile.encore.isActive).to.be.false;
            expect(volatile.identified).to.be.null;
            expect(volatile.lastUsed).to.equal(-1);
            expect(volatile.lockedMove.isActive).to.be.false;
            expect(volatile.minimize).to.be.false;
            expect(volatile.mustRecharge).to.be.false;
            expect(volatile.overrideAbility.definiteValue).to.be.null;
            expect(volatile.overrideSpecies).to.be.null;
            expect(volatile.overrideTypes).to.have.members(["???", "???"]);
            expect(volatile.addedType).to.equal("???");
            expect(volatile.roost).to.be.false;
            expect(volatile.slowStart.isActive).to.be.false;
            expect(volatile.stallTurns).to.equal(0);
            expect(volatile.taunt.isActive).to.be.false;
            expect(volatile.torment).to.be.false;
            expect(volatile.twoTurn.isActive).to.be.false;
            expect(volatile.unburden).to.be.false;
            expect(volatile.uproar.isActive).to.be.false;
            expect(volatile.willTruant).to.be.false;
        });
    });

    describe("#shallowClone()", function()
    {
        it("Should copy only passable statuses", function()
        {
            setEverything();

            const newVolatile = volatile.shallowClone();
            volatile.clear();
            expect(newVolatile).to.not.equal(volatile);
            // passed
            expect(newVolatile.aquaRing).to.be.true;
            expect(newVolatile.boosts).to.not.equal(volatile.boosts);
            expect(newVolatile.boosts.atk).to.equal(1);
            expect(newVolatile.confusion.isActive).to.be.true;
            expect(newVolatile.confusion.turns).to.equal(1);
            expect(newVolatile.embargo.isActive).to.be.true;
            expect(newVolatile.embargo.turns).to.equal(1);
            expect(newVolatile.focusEnergy).to.be.true;
            expect(newVolatile.gastroAcid).to.be.true;
            expect(newVolatile.ingrain).to.be.true;
            expect(newVolatile.leechSeed).to.be.true;
            expect(newVolatile.magnetRise.isActive).to.be.true;
            expect(newVolatile.magnetRise.turns).to.equal(1);
            expect(newVolatile.substitute).to.be.true;
            // not passed
            expect(newVolatile.bide.isActive).to.be.false;
            expect(newVolatile.charge.isActive).to.be.false;
            expect(newVolatile.disabledMoves[0].isActive).to.be.false;
            expect(newVolatile.encore.isActive).to.be.false;
            expect(newVolatile.identified).to.be.null;
            expect(newVolatile.lastUsed).to.equal(-1);
            expect(newVolatile.lockedMove.isActive).to.be.false;
            expect(newVolatile.minimize).to.be.false;
            expect(newVolatile.mustRecharge).to.be.false;
            expect(newVolatile.overrideAbility.definiteValue).to.be.null;
            expect(newVolatile.overrideSpecies).to.be.null;
            expect(newVolatile.overrideTypes).to.have.members(["???", "???"]);
            expect(newVolatile.addedType).to.equal("???");
            expect(newVolatile.roost).to.be.false;
            expect(newVolatile.slowStart.isActive).to.be.false;
            expect(newVolatile.stallTurns).to.equal(0);
            expect(newVolatile.taunt.isActive).to.be.false;
            expect(newVolatile.torment).to.be.false;
            expect(newVolatile.twoTurn.isActive).to.be.false;
            expect(newVolatile.unburden).to.be.false;
            expect(newVolatile.uproar.isActive).to.be.false;
            expect(newVolatile.willTruant).to.be.false;
        });
    });

    describe("#boosts", function()
    {
        it("Should not be boosted initially", function()
        {
            for (const stat of Object.keys(boostNames) as BoostName[])
            {
                expect(volatile.boosts[stat]).to.equal(0);
            }
        });
    });

    describe("#embargo", function()
    {
        it("Should tick embargo on #postTurn()", function()
        {
            volatile.embargo.start();
            volatile.postTurn();
            expect(volatile.embargo.turns).to.equal(2);
        });
    });

    describe("#magnetRise", function()
    {
        it("Should tick magnet rise on #postTurn()", function()
        {
            volatile.magnetRise.start();
            volatile.postTurn();
            expect(volatile.magnetRise.turns).to.equal(2);
        });
    });

    describe("#overrideAbility", function()
    {
        it("Should reset #willTruant", function()
        {
            volatile.overrideAbility.narrow("truant");
            volatile.activateTruant();
            expect(volatile.willTruant).to.be.true;
            volatile.resetOverrideAbility();
            volatile.overrideAbility.narrow("swiftswim");
            expect(volatile.willTruant).to.be.false;
        });
    });

    describe("#charge", function()
    {
        it("Should have silent=true", function()
        {
            expect(volatile.charge).to.have.property("silent", true);
        });

        it("Should tick on #postTurn()", function()
        {
            volatile.charge.start();
            expect(volatile.charge.turns).to.equal(1);
            volatile.postTurn();
            expect(volatile.charge.turns).to.equal(2);
        });
    });

    describe("#disabledMoves/#enableMoves()", function()
    {
        it("Should not be disabled initially", function()
        {
            for (let i = 0; i < volatile.disabledMoves.length; ++i)
            {
                expect(volatile.disabledMoves[i].isActive).to.equal(false,
                    `Move ${i + 1} was expected to not be disabled`);
            }
        });

        it("Should end disabled status", function()
        {
            // disable moves
            for (const d of volatile.disabledMoves) d.start();
            for (let i = 0; i < volatile.disabledMoves.length; ++i)
            {
                expect(volatile.disabledMoves[i].isActive).to.equal(true,
                    `Move ${i + 1} was expected to be disabled`);
            }

            // re-enable moves
            volatile.enableMoves();
            for (let i = 0; i < volatile.disabledMoves.length; ++i)
            {
                expect(volatile.disabledMoves[i].isActive).to.equal(false,
                    `Move ${i + 1} was expected to not be disabled`);
            }
        });

        it("Should tick on #postTurn()", function()
        {
            volatile.disabledMoves[0].start();
            volatile.postTurn();
            expect(volatile.disabledMoves[0].turns).to.equal(2);
        });
    });

    describe("#lastUsed", function()
    {
        it("Should be reset on #preTurn()", function()
        {
            volatile.lastUsed = 0;
            volatile.preTurn();
            expect(volatile.lastUsed).to.equal(-1);
        });
    });

    describe("#lockedMove", function()
    {
        it("Should not stop on #postTurn() if #lastUsed is set", function()
        {
            volatile.preTurn();
            volatile.lastUsed = 0;
            volatile.lockedMove.start("outrage");
            volatile.postTurn();

            expect(volatile.lockedMove.isActive).to.be.true;
        });

        it("Should stop on #postTurn() if #lastUsed is not set", function()
        {
            volatile.preTurn();
            volatile.lockedMove.start("petaldance");
            volatile.postTurn();

            expect(volatile.lockedMove.isActive).to.be.false;
        });
    });

    describe("#setOverrideSpecies()", function()
    {
        it("Should set override species", function()
        {
            volatile.setOverrideSpecies(dex.pokemon.Magikarp);
            expect(volatile.overrideSpecies).to.not.be.null;
            expect(volatile.overrideSpecies!.name).to.equal("Magikarp");
        });

        it("Should link to #overrideStats and #overrideTypes", function()
        {
            volatile.setOverrideSpecies(dex.pokemon.Magikarp);
            expect(volatile.overrideStats.data).to.equal(dex.pokemon.Magikarp);
            expect(volatile.overrideTypes)
                .to.have.members(dex.pokemon.Magikarp.types);
        });

        it("Should reset override ability if setAbility=true", function()
        {
            volatile.overrideAbility.narrow("keeneye");
            volatile.setOverrideSpecies(dex.pokemon.Magikarp);
            expect(volatile.overrideAbility.possibleValues)
                .to.have.all.keys("swiftswim");
        });

        it("Should not reset override ability if setAbility=false", function()
        {
            volatile.overrideAbility.narrow("keeneye");
            volatile.setOverrideSpecies(dex.pokemon.Magikarp, false);
            expect(volatile.overrideAbility.possibleValues)
                .to.have.all.keys("keeneye");
            expect(volatile.overrideAbility.possibleValues)
                .to.not.have.any.keys(...dex.pokemon.Magikarp.abilities);
        });
    });

    describe("#roost", function()
    {
        it("Should reset on #postTurn()", function()
        {
            volatile.roost = true;
            volatile.postTurn();
            expect(volatile.roost).to.be.false;
        });
    });

    describe("#stallTurns/#stall()", function()
    {
        it("Should increment/reset stallTurns", function()
        {
            expect(volatile.stallTurns).to.equal(0);
            volatile.stall(true);
            expect(volatile.stallTurns).to.equal(1);
            volatile.stall(true);
            expect(volatile.stallTurns).to.equal(2);
            volatile.stall(false);
            expect(volatile.stallTurns).to.equal(0);
        });

        it("Should reset stallTurns on #postTurn() if no stall happened this " +
            "turn", function()
        {
            volatile.stall(true);
            volatile.postTurn();
            volatile.postTurn();
            expect(volatile.stallTurns).to.equal(0);
        });

        it("Should not reset stallTurns on #postTurn() if a stall happened " +
            "this turn", function()
        {
            volatile.stall(true);
            volatile.postTurn();
            expect(volatile.stallTurns).to.equal(1);
        });
    });

    describe("#twoTurn", function()
    {
        it("Should have silent=true", function()
        {
            expect(volatile.twoTurn).to.have.property("silent", true);
        });

        it("Should not stop on #postTurn() if #lastUsed is set", function()
        {
            volatile.preTurn();
            volatile.lastUsed = 0;
            volatile.twoTurn.start("dig");
            volatile.postTurn();

            expect(volatile.twoTurn.isActive).to.be.true;
        });

        it("Should stop on #postTurn() if #lastUsed is not set", function()
        {
            volatile.preTurn();
            volatile.twoTurn.start("dig");
            volatile.postTurn();

            expect(volatile.twoTurn.isActive).to.be.false;
        });
    });

    describe("#willTruant/#activateTruant()", function()
    {
        it("Should set #willTruant if ability is truant", function()
        {
            volatile.overrideAbility.narrow("truant");
            volatile.activateTruant();
            expect(volatile.willTruant).to.be.true;
        });

        it("Should fail if ability is not truant", function()
        {
            expect(() => volatile.activateTruant()).to.throw();
        });

        it("Should reset if ability changed from truant", function()
        {
            volatile.overrideAbility.narrow("truant");
            volatile.activateTruant();
            volatile.resetOverrideAbility();
            expect(volatile.willTruant).to.be.false;
        });

        it("Should toggle on #postTurn() if ability is truant", function()
        {
            volatile.overrideAbility.narrow("truant");
            volatile.activateTruant();
            volatile.postTurn();
            expect(volatile.willTruant).to.be.false;
            volatile.postTurn();
            expect(volatile.willTruant).to.be.true;
        });

        it("Should not toggle on #postTurn() if ability is not truant",
        function()
        {
            volatile.postTurn();
            expect(volatile.willTruant).to.be.false;
        });
    });
});
