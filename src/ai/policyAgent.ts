import { BattleAgent } from "../battle/agent/BattleAgent";
import { Choice, choiceIds, intToChoice } from "../battle/agent/Choice";
import { ReadonlyBattleState } from "../psbot/handlers/battle/formats/gen4/state/BattleState";
import { Logger } from "../Logger";
import { weightedShuffle } from "./helpers";

/**
 * Policy type for `policyAgent()`.
 * @see policyAgent
 */
export type PolicyType = "deterministic" | "stochastic";

/**
 * Function type for sorters.
 * @param probs Probabilities of each choice, in order of `choiceIds`.
 * @param choices Available choices to choose from. The function should sort
 * this array in-place.
 * @see choiceIds
 */
type Sorter = (probs: Float32Array, choices: Choice[]) => void;
/** Choice sorters for each PolicyType. */
const sorters: {readonly [T in PolicyType]: Sorter} =
{
    deterministic(probs, choices)
    {
        choices.sort((a, b) =>
            probs[choiceIds[b]] - probs[choiceIds[a]]);
    },
    stochastic(probs, choices)
    {
        const allChoices = [...intToChoice];
        weightedShuffle([...probs], allChoices);
        // sort actual choices array in-place based on the positions within the
        //  shuffled allChoices array
        const choiceSet = new Set(choices);
        let j = 0;
        for (const choice of allChoices)
        {
            if (choiceSet.has(choice)) choices[j++] = choice;
        }
    }
};

// tslint:disable:no-trailing-whitespace
/**
 * Creates a BattleAgent that runs a deterministic or stochastic policy.
 * @param getProbs Function for getting the probabilities of each choice.
 * @param type Action selection method after getting decision data.  
 * `deterministic` - Choose the action deterministically with the highest
 * probability.  
 * `stochastic` - Choose the action semi-randomly based on a discrete
 * probability distribution for each action.
 * @returns A suitable BattleAgent for running the policy.
 */
// tslint:enable:no-trailing-whitespace
export function policyAgent(
    getProbs: (state: ReadonlyBattleState) =>
            Float32Array | Promise<Float32Array>,
    type: PolicyType): BattleAgent
{
    const sorter = sorters[type];
    return async function(state: ReadonlyBattleState, choices: Choice[],
        logger?: Logger): Promise<void>
    {
        const probs = await getProbs(state);
        logger?.debug("Ranked choices: {" +
            intToChoice.map((c, i) => `${c}: ${(probs[i] * 100).toFixed(3)}%`)
                .join(", ") + "}");
        sorter(probs, choices);
    };
}
