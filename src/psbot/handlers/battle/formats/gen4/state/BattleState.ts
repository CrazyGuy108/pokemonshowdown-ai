import { SideID } from "@pkmn/sim";
import { ReadonlyRoomStatus, RoomStatus } from "./RoomStatus";
import { ReadonlyTeam, Team } from "./Team";

/** Readonly BattleState representation. */
export interface ReadonlyBattleState
{
    /** Team data. */
    readonly teams: {readonly [S in SideID]?: ReadonlyTeam};
    /** Global status conditions for the entire room. */
    readonly status: ReadonlyRoomStatus;
    /** The player's username. */
    readonly username: string;
    /** Side of the player's perspective. */
    readonly ourSide?: SideID;
}

/** Holds all the data about a particular battle. */
export class BattleState implements ReadonlyBattleState
{
    /** @override */
    public get teams(): {readonly [S in SideID]?: Team} { return this._teams; }
    private readonly _teams: {[S in SideID]?: Team} = {};
    /** @override */
    public readonly status = new RoomStatus();
    /** @override */
    public readonly username: string;
    /** @override */
    public ourSide?: SideID;

    /**
     * Creates a BattleState.
     * @param username The player's username.
     * @param numTeams Number of teams to initialize. Default 2.
     */
    constructor(username: string, public readonly numTeams: 2 | 3 | 4 = 2)
    {
        this.username = username;
        for (let i = 1; i <= numTeams; ++i)
        {
            const sideId: SideID = `p${i as 1 | 2 | 3 | 4}` as const;
            this._teams[sideId] = new Team(sideId, this);
        }
    }

    /** Gets a team. Throws if invalid. */
    public getTeam(sideId: SideID): Team
    {
        const team = this.tryGetTeam(sideId);
        if (!team) throw new Error(`Unknown SideID '${sideId}'`);
        return team;
    }

    /** Gets a team. Returns `undefined` if invalid. */
    public tryGetTeam(sideId: SideID): Team | undefined
    {
        return this._teams[sideId];
    }

    /** Called at the beginning of every turn to update temp statuses. */
    public preTurn(): void
    {
        for (const sideId in this._teams)
        {
            if (!this._teams.hasOwnProperty(sideId)) continue;
            this._teams[sideId as SideID]?.preTurn();
        }
    }

    /** Called at the end of every turn to update temp statuses. */
    public postTurn(): void
    {
        this.status.postTurn();
        for (const sideId in this._teams)
        {
            if (!this._teams.hasOwnProperty(sideId)) continue;
            this._teams[sideId as SideID]?.postTurn();
        }
    }

    // istanbul ignore next: only used for logging
    /**
     * Encodes all state data into a string.
     * @param indent Indentation level to use.
     * @returns The BattleState in string form.
     */
    public toString(indent = 0): string
    {
        const s = " ".repeat(indent);
        let res = `${s}status: ${this.status.toString()}`;
        for (const sideId in this._teams)
        {
            if (!this._teams.hasOwnProperty(sideId)) continue;
            const team = this._teams[sideId as SideID];
            res += `\n${s}${sideId}`;
            if (sideId === this.ourSide) res += "(us)";
            res += ":";
            if (!team) res += ` <empty>`;
            else res += `\n${team.toString(indent + 4)}`;
        }
        return res;
    }
}
