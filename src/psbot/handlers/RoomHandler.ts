import * as psmsg from "../parser/PSMessage";

/** Handles messages that come from a battle room. */
export interface RoomHandler
{
    /** Handles initial BattleEvents. */
    init(msg: Omit<psmsg.BattleInit, "type">): Promise<void>;

    /** Handles a group of parsed BattleEvents. */
    progress(msg: Omit<psmsg.BattleProgress, "type">): Promise<void>;

    /** Handles a request for a battle choice. */
    request(msg: Omit<psmsg.Request, "type">): Promise<void>;

    /** Handles an error message from the server. */
    error(msg: Omit<psmsg.Error, "type">): Promise<void>;
}
