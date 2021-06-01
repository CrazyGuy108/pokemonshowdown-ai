import { Event } from "../parser";

/** Handles messages that come from a battle room. */
export interface RoomHandler
{
    /** Handles an Event. */
    handle(event: Event): void | Promise<void>;
}
