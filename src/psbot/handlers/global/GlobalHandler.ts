import { Args, Protocol } from "@pkmn/protocol";
import { Event } from "../../parser";
import { RoomHandler } from "../RoomHandler";

/**
 * Handles global PS messages such as login/initialization and PMs/challenges.
 */
export class GlobalHandler implements RoomHandler, Protocol.Handler
{
    /** Callback to update the client's username. */
    public updateUser: ((username: string) => void) | null = null;
    /** Callback to receive a battle challenge from another user. */
    public respondToChallenge: ((user: string, format: string) => void) | null =
        null;

    /** Promise to get the login challstr. */
    public readonly challstr = new Promise<string>(
            res => this.challstrRes = res)
        .finally(() => this.challstrRes = null);
    private challstrRes: ((challstr: string) => void) | null = null;

    /** @override */
    public handle(event: Event): void
    {
        const key = Protocol.key(event.args);
        if (!key) return;
        ((this as Protocol.Handler)[key] as any)?.(event.args, event.kwArgs);
    }

    // list taken from Protocol.GlobalArgs

    "|popup|"(args: Args["|popup|"]) {}
    "|pm|"(args: Args["|pm|"]) {}
    "|usercount|"(args: Args["|usercount|"]) {}
    "|nametaken|"(args: Args["|nametaken|"]) {}

    "|challstr|"(args: Args["|challstr|"])
    {
        if (!this.challstrRes) throw new Error("Received a second challstr");
        this.challstrRes(args[1]);
    }

    "|updateuser|"(args: Args["|updateuser|"])
    {
        this.updateUser?.(args[1]);
    }

    "|formats|"(args: Args["|formats|"]) {}

    "|updatesearch|"(args: Args["|updatesearch|"]) {}

    "|updatechallenges|"(args: Args["|updatechallenges|"])
    {
        if (!this.respondToChallenge) return;

        // weird typing behavior in Protocol helper
        // see https://github.com/pkmn/ps/issues/7
        const json = Protocol.parseChallenges(args[1]) as any as
            Protocol.SearchState;
        for (const [user, format] of Object.entries(json.challengesFrom))
        {
            this.respondToChallenge(user, format);
        }
    }

    "|queryresponse|"(args: Args["|queryresponse|"]) {}
}
