import { SelfSwitch } from "../dex/dex-types";

/** Temporary status conditions for a certain team. */
export class TeamStatus
{
    public selfSwitch: SelfSwitch = false;

    /** Starts the Wish move countdown if not already started. */
    public wish(): void
    {
        if (!this.wishDuration) this.wishDuration = 2;
    }
    public get isWishing(): boolean { return this.wishDuration !== 0; }
    private wishDuration = 0;

    /**
     * Called at the end of the turn, after a Choice has been sent to the
     * server.
     */
    public postTurn(): void
    {
        if (this.wishDuration) --this.wishDuration;
    }

    /**
     * Gets the size of the return value of `toArray()`.
     * @returns The size of the return value of `toArray()`.
     */
    public static getArraySize(): number
    {
        return /*selfSwitch*/ 2 + /*wish*/ 1;
    }

    // istanbul ignore next: unstable, hard to test
    /**
     * Formats team status info into an array of numbers.
     * @returns All team status data in array form.
     */
    public toArray(): number[]
    {
        const result =
        [
            this.selfSwitch ? 1 : 0, this.selfSwitch === "copyvolatile" ? 1 : 0,
            this.wishDuration ? 1 : 0
        ];
        return result;
    }

    // istanbul ignore next: only used for logging
    /**
     * Encodes all team status data into a string
     * @returns The TeamStatus in string form.
     */
    public toString(): string
    {
        return `[${([] as string[]).concat(
                this.selfSwitch ? [`selfSwitch: ${this.selfSwitch}`] : [],
                this.wishDuration ? ["wishing"] : []
            ).join(", ")}]`;
    }
}