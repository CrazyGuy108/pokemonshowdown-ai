import { Choice } from "../../agent/Choice";
import { ReadonlyBattleState } from "../../state/BattleState";
import * as events from "../BattleEvent";
import { ParserState, SenderResult, SubParser } from "../BattleParser";

/**
 * Handles a halt event. If the event requests a decision from the ParserState's
 * BattleAgent, this function will handle that logic.
 * @returns True if this is a game-over halt, falsy otherwise.
 */
export async function* halt(pstate: ParserState, initialEvent: events.Halt):
    SubParser
{
    switch (initialEvent.reason)
    {
        case "gameOver": return {permHalt: true}; // stop the parser
        case "switch": await decide(pstate, /*switchOnly*/true); break;
        case "decide": await decide(pstate, /*switchOnly*/false); break;
    }
    return {};
}

/**
 * Asks the BattleAgent for a decision.
 * @param pstate Parser state.
 * @param switchOnly Whether we're being forced to switch out.
 */
async function decide(pstate: ParserState, switchOnly: boolean): Promise<void>
{
    // go over what we can and can't do
    let choices = getChoices(pstate.state, switchOnly);
    pstate.logger.debug(`Choices: [${choices.join(", ")}]`);
    if (choices.length <= 0) throw new Error("Empty choices array on halt");

    // make a decision
    const agentLogger = pstate.logger.addPrefix("BattleAgent: ");
    await pstate.agent(pstate.state, choices, agentLogger);
    pstate.logger.debug(`Sorted choices: [${choices.join(", ")}]`);

    // keep retrying until valid
    let result: SenderResult;
    while (result = await pstate.sender(choices[0]))
    {
        // remove invalid choice
        const lastChoice = choices.shift()!;

        let newInfo = false;
        if (result === "disabled")
        {
            // move is now known to be disabled by an unknown effect
            if (!lastChoice.startsWith("move"))
            {
                throw new Error(`Non-move Choice ${lastChoice} rejected ` +
                    "as 'disabled'");
            }

            // TODO: imprison
            // TODO: handle all other move restrictions before testing for
            //  imprison
        }
        else if (result === "trapped")
        {
            if (!lastChoice.startsWith("switch"))
            {
                throw new Error(`Non-switch Choice ${lastChoice} ` +
                    "rejected as 'trapped'");
            }

            // now known to be trapped by the opponent, all other switch choices
            //  are therefore invalid
            choices = choices.filter(c => !c.startsWith("switch"));

            // try to infer a trapping ability
            rejectSwitchTrapped(pstate);
            newInfo = true;
        }
        else
        {
            pstate.logger.error(`Choice '${lastChoice}' rejected without a ` +
                "reason, BattleParser may be incomplete");
        }

        pstate.logger.debug(`Revised choices: [${choices.join(", ")}]`);
        if (choices.length <= 0)
        {
            throw new Error("Empty choices array on reject");
        }

        if (newInfo)
        {
            // re-sort choices based on new info
            await pstate.agent(pstate.state, choices, agentLogger);
            pstate.logger.debug(`Sorted choices: [${choices.join(", ")}]`);
        }
    }
}

/** Gets the available choices for the current decision. */
export function getChoices(state: ReadonlyBattleState, switchOnly: boolean):
    Choice[]
{
    const team = state.teams.us;
    const mon = team.active;

    const result: Choice[] = [];

    // add move choices
    const them = state.teams.them.active;
    if (!switchOnly)
    {
        const moves = [...mon.moveset.moves];
        for (let i = 0; i < moves.length; ++i)
        {
            const [moveName, move] = moves[i];

            // can't select without pp
            if (move.pp <= 0) continue;
            // can't select status moves if Taunted
            if (mon.volatile.taunt.isActive &&
                move.data.category === "status")
            {
                continue;
            }
            // can't select a Disabled move
            if (mon.volatile.disabled.ts.isActive &&
                moveName === mon.volatile.disabled.move)
            {
                continue;
            }
            // can't select if Imprisoned
            if (them.volatile.imprison && them.moveset.moves.has(moveName))
            {
                continue;
            }
            // locked into one move if Encored
            if (mon.volatile.encore.ts.isActive &&
                moveName !== mon.volatile.encore.move)
            {
                continue;
            }
            const ability = mon.volatile.suppressAbility ? undefined
                : mon.traits.ability;
            const ignoringItem = mon.volatile.embargo.isActive ||
                (ability &&
                    [...ability.possibleValues]
                        .every(n => ability.map[n].flags?.ignoreItem));
            // locked into one move if choice item lock
            if (!ignoringItem && mon.volatile.choiceLock &&
                moveName !== mon.volatile.choiceLock)
            {
                continue;
            }
            // TODO: torment, etc
            // TODO: is that all?
            // if not, should be able to recover from choice rejection

            result.push(`move ${i + 1}` as Choice);
        }

        // can always struggle if unable to use any move
        if (result.length <= 0) result.push("move 1");

        // see if we can possibly switch out
        // can always switch if holding shedshell (TODO: add to dex)
        if (mon.item.definiteValue !== "shedshell")
        {
            // trapped by a trapping move
            if (mon.volatile.trapped) return result;
            // gen4: shadowtag cancels the other's trapping effect
            if (them.ability === "shadowtag" && mon.ability !== "shadowtag")
            {
                return result;
            }
            // magnetpull traps steel types
            if (them.ability === "magnetpull" &&
                mon.types.includes("steel"))
            {
                return result;
            }
            // arenatrap traps grounded opponents
            if (them.ability === "arenatrap" && mon.grounded)
            {
                return result;
            }
            // TODO: is this all?
            // if not, should be able to recover from choice rejection
        }
    }

    // add switch choices
    const teamList = team.pokemon;
    for (let i = 0; i < teamList.length; ++i)
    {
        const slot = teamList[i];
        // can't select empty slot
        if (!slot) continue;
        // can't select self
        if (slot === team.active) continue;
        // can't select other active pokemon
        if (slot.active) continue;
        // can't select fainted pokemon
        if (slot.fainted) continue;
        // TODO: is this all?
        // if not, should be able to recover from choice rejection

        result.push(`switch ${i + 1}` as Choice);
    }

    return result;
}

/** Makes an inference if a switch choice was rejected. */
function rejectSwitchTrapped(pstate: ParserState): void
{
    pstate.state.teams.us.active.trapped(pstate.state.teams.them.active);
}
