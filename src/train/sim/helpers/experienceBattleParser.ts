import { Choice, choiceIds } from "../../../battle/agent/Choice";
import { BattleParser, BattleParserConfig } from
    "../../../battle/parser/BattleParser";
import { BattleState, ReadonlyBattleState } from
    "../../../psbot/handlers/battle/formats/gen4/state/BattleState";
import { Experience, ExperienceAgent, ExperienceAgentData } from "./Experience";

/**
 * Wraps a BattleParser to track rewards/decisions and emit Experience objects.
 * @param parser Parser function to wrap.
 * @param callback Callback for emitting Experience objs.
 * @returns The wrapped BattleParser function.
 */
export function experienceBattleParser(parser: BattleParser,
    callback: (exp: Experience) => void): BattleParser<ExperienceAgent>
{
    return async function _experienceBattleParser(
        cfg: BattleParserConfig<ExperienceAgent>): Promise<BattleState>
    {
        let expAgentData: ExperienceAgentData | null = null as any;
        let lastChoice: Choice | null = null as any;
        let reward = 0;
        function emitExperience()
        {
            if (!expAgentData || !lastChoice) return;
            // collect data to emit an experience
            const action = choiceIds[lastChoice];
            cfg.logger.debug(`Emitting experience, reward=${reward}`);
            callback({...expAgentData, action, reward});
            // reset collected data for the next decision
            expAgentData = null;
            lastChoice = null;
            reward = 0;
        }

        // start tracking the game
        const finished = await parser(
        {
            ...cfg,
            // extract additional info from the ExperienceAgent
            async agent(state, choices, logger)
            {
                emitExperience();
                expAgentData = await cfg.agent(state, choices, logger);
            },
            iter:
            {
                ...cfg.iter,
                async next(state: ReadonlyBattleState)
                {
                    // observe events before the parser consumes them
                    const result = await cfg.iter.next(state);
                    if (!result.done && result.value.type === "halt" &&
                        result.value.reason === "gameOver")
                    {
                        // add win/loss reward
                        reward += result.value.winner === "us" ? 1 : -1;
                    }
                    return result;
                }
            },
            // extract the last choice that was accepted
            async sender(choice)
            {
                const result = await cfg.sender(choice);
                if (!result) lastChoice = choice;
                return result;
            }
        });

        // emit final experience at the end of the game
        // FIXME: in startPSBattle(), forcing a tie after reaching maxTurns will
        //  cause an extra Experience to be emitted between the last decision
        //  and the tie event
        emitExperience();
        return finished;
    };
}
