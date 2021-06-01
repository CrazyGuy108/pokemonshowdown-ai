import * as tf from "@tensorflow/tfjs";
import { BattleAgent, intToChoice } from "../battle/agent";
import { allocUnsafe, battleStateEncoder } from "./encoder/encoders";
import { policyAgent, PolicyType } from "./policyAgent";

/** Contains the tensors used by the neural network. */
export type NetworkData =
{
    /** State input as a column vector. */
    state: tf.Tensor2D;
    /** Action-probability outputs. */
    probs: tf.Tensor1D;
    /** State-value output. */
    value: tf.Scalar;
};

/**
 * Creates a BattleAgent that uses a neural network for choice selection. Uses
 * `policyAgent()` for configuring action selection.
 * @param model The neural network.
 * @param policy Action selection method. See `policyAgent()` for details.
 * @param callback Optional. Observes the tensor inputs and outputs of the
 * neural network. This function will own the tensors, so it should take care of
 * disposing them.
 * @throws Error if the given model does not have the right input and output
 * shapes.
 * @see policyAgent
 */
export function networkAgent(model: tf.LayersModel, policy: PolicyType,
    callback: (data: NetworkData) => void = tf.dispose):
    BattleAgent
{
    verifyModel(model);
    return policyAgent(async function(state)
        {
            const stateData = allocUnsafe(battleStateEncoder);
            battleStateEncoder.encode(stateData, state);
            const stateTensor = tf.tensor2d(stateData,
                [1, battleStateEncoder.size]);

            const [probsTensor, valueTensor] = tf.tidy(function()
            {
                const [actProbs, stateValue] =
                    model.predict(stateTensor) as tf.Tensor[];
                return [actProbs.as1D(), stateValue.asScalar()];
            });
            const probsData = await probsTensor.data() as Float32Array;
            callback(
                {state: stateTensor, probs: probsTensor, value: valueTensor});
            return probsData;
        },
        policy);
}

/**
 * Verifies a neural network model to make sure its input and output shapes
 * are acceptable for constructing a `networkAgent()` with. Throws if invalid.
 */
export function verifyModel(model: tf.LayersModel): void
{
    // loaded models must have the correct input/output shape
    if (Array.isArray(model.input))
    {
        throw new Error("Loaded LayersModel should have only one input " +
            `layer but found ${model.input.length}`);
    }
    if (!isValidInput(model.input))
    {
        throw new Error("Loaded LayersModel has invalid input shape " +
            `(${model.input.shape.join(", ")}). Try to create a new ` +
            `model with an input shape of (, ${battleStateEncoder.size})`);
    }
    if (!Array.isArray(model.output) || model.output.length !== 2)
    {
        const length = Array.isArray(model.output) ?
            model.output.length : 1;
        throw new Error("Loaded LayersModel should have two output " +
            `layers but found ${length}`);
    }
    if (!isValidOutput(model.output))
    {
        const shapeStr =
            `[${model.output.map(t => `(${t.shape.join(", ")})`)}]`;
        throw new Error("Loaded LayersModel has invalid output shapes " +
            `(${shapeStr}). Try to create a new model with the correct ` +
            `shapes: [(, ${intToChoice.length}), (, 1)]`);
    }
}

/** Ensures that a network input shape is valid. */
function isValidInput(input: tf.SymbolicTensor): boolean
{
    const shape = input.shape;
    return shape.length === 2 && shape[0] === null &&
        shape[1] === battleStateEncoder.size;
}

/** Ensures that a network output shape is valid. */
function isValidOutput(output: tf.SymbolicTensor[]): boolean
{
    if (output.length !== 2) return false;
    const actionShape = output[0].shape;
    const valueShape = output[1].shape;
    // actionShape should be [null, intToChoice.length]
    return actionShape.length === 2 && actionShape[0] === null &&
        actionShape[1] === intToChoice.length &&
        // valueShape should be [null, 1]
        valueShape.length === 2 && valueShape[0] === null &&
            valueShape[1] === 1;
}
