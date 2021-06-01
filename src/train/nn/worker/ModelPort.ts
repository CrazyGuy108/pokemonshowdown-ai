import { MessagePort } from "worker_threads";
import { alloc, battleStateEncoder } from "../../../ai/encoder/encoders";
import { policyAgent, PolicyType } from "../../../ai/policyAgent";
import { BattleAgent, intToChoice } from "../../../battle/agent";
import { ExperienceAgentData } from "../../sim/helpers/Experience";
import { AsyncPort, PortRequestBase, PortResultBase } from
    "./helpers/AsyncPort";

/** Base interface for the predict request protocol. */
type PredictRequestBase = PortRequestBase<"predict">;

/** Prediction request message format. */
export interface PredictMessage extends PredictRequestBase
{
    /** State data. */
    state: Float32Array;
}

/** Data returned by the network processor port. */
export interface PredictWorkerResult extends PortResultBase<"predict">,
    PredictResult
{
    /**
     * Guaranteed one reply per message.
     * @override
     */
    done: true;
}

/** Result from a prediction. */
export type PredictResult = Omit<ExperienceAgentData, "state">;

/**
 * Abstracts the interface between a game worker and the master NetworkProcessor
 * worker. Intended to be used by only one BattleAgent within a game worker that
 * received a port to connect to a neural network.
 */
export class ModelPort extends
    AsyncPort<
        {predict: {message: PredictMessage, result: PredictWorkerResult}},
        MessagePort>
{
    /** @override */
    public async close(): Promise<void> { this.port.close(); }

    /**
     * Creates a BattleAgent from this port.
     * @param policy Action selection method. See `policyAgent()` for details.
     * @see policyAgent
     */
    public getAgent(policy: PolicyType): BattleAgent<ExperienceAgentData>
    {
        let data: ExperienceAgentData | null = null;

        const innerAgent = policyAgent(
            async state =>
            {
                const arr = alloc(battleStateEncoder, /*shared*/ true);
                battleStateEncoder.encode(arr, state);
                let i = ModelPort.verifyInput(arr);
                if (i >= 0)
                {
                    throw new Error("Neural network input contains an " +
                        `invalid value (${arr[i]}) at index ${i}\n` +
                        `State:\n${state.toString()}`);
                }

                const result = await this.predict(arr, /*shared*/ true);
                i = ModelPort.verifyOutput(result.probs);
                if (i >= 0)
                {
                    throw new Error("Neural network output contains an " +
                        `invalid value at index ${i} (${intToChoice[i]})`);
                }

                data = {...result, state: arr};
                return result.probs;
            },
            policy);

        return async function portAgent(state, choices, logger)
        {
            await innerAgent(state, choices, logger);
            if (!data)
            {
                throw new Error("ModelPort agent didn't collect experience " +
                    "data");
            }
            const result = data;
            data = null;
            return result;
        };
    }

    /**
     * Makes sure that the input doesn't contain invalid values, i.e. NaNs or
     * values outside the range `[-1, 1]`.
     * @param arr Array input.
     * @returns The index of an invalid value, or -1 if none found.
     */
    private static verifyInput(arr: Float32Array): number
    {
        for (let i = 0; i < arr.length; ++i)
        {
            if (isNaN(arr[i])) return i;
            if (Math.abs(arr[i]) > 1) return i;
        }
        return -1;
    }

    /**
     * Makes sure that the output doesn't contain invalid values, i.e. NaNs or
     * very small softmax outputs which tend to mess with `policyAgent`'s
     * weighted shuffle algorithm.
     * @param arr Array input.
     * @returns The index of an invalid value, or -1 if none found.
     */
    private static verifyOutput(arr: Float32Array): number
    {
        for (let i = 0; i < arr.length; ++i)
        {
            if (isNaN(arr[i])) return i;
            if (arr[i] < 1e-4) return i;
        }
        return -1;
    }

    /**
     * Requests a prediction from the neural network.
     * @param state State data.
     * @param shared Whether the array uses a SharedArrayBuffer.
     */
    public predict(state: Float32Array, shared = false): Promise<PredictResult>
    {
        const msg: PredictMessage =
            {type: "predict", rid: this.generateRID(), state};
        // SharedArrayBuffers can't be in the transfer list since they're
        //  already accessible from both threads
        const transferList = shared ? [] : [state.buffer];

        return new Promise((res, rej) =>
            this.postMessage(msg, transferList,
                result =>
                    result.type === "error" ? rej(result.err) : res(result)));
    }
}
