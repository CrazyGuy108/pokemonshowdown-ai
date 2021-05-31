import { BattleState } from "../../psbot/handlers/battle/formats/gen4/state/BattleState";
import * as events from "./BattleEvent";
import { BattleParser, BattleParserConfig, SubParser, SubParserConfig,
    SubParserResult } from "./BattleParser";

/** Maps BattleEvent type to a SubParser handler. */
export type EventHandlerMap<TResult extends SubParserResult = SubParserResult> =
{
    readonly [TEventType in events.Type]: SubParser<TResult>
};

/**
 * Creates a SubParser that dispatches to an appropriate event handler using the
 * given map.
 */
export function createDispatcher(handlers: EventHandlerMap): SubParser
{
    return async function dispatchEvent(cfg: SubParserConfig):
        Promise<SubParserResult>
    {
        const result = await cfg.iter.peek();
        if (result.done || !result.value) return {permHalt: true};
        const event = result.value;
        // handler should be responsible for verifying and consuming the event
        return handlers[event.type](cfg);
    }
}

/**
 * Creates a top-level BattleParser that loops a SubParser.
 * @param parser Parser function to use. Should be able to accept any
 * BattleEvent.
 * @param stateCtor Function for constructing the BattleState.
 */
export function baseEventLoop(parser: SubParser, stateCtor: () => BattleState):
    BattleParser
{
    return async function baseLoopParser(cfg: BattleParserConfig):
        Promise<BattleState>
    {
        // create initial battle state
        const subConfig: SubParserConfig = {...cfg, state: stateCtor()};
        // dispatch loop
        while (true)
        {
            const {value: preEvent} = await cfg.iter.peek();
            const result = await parser(subConfig);
            if (result.permHalt) break;
            // guard against infinite loops
            const {value: postEvent} = await cfg.iter.peek();
            if (preEvent === postEvent)
            {
                throw new Error("Parser rejected the first event it was " +
                    `given: '${JSON.stringify(postEvent)}'`);
            }
        }
        return subConfig.state;
    };
}

/**
 * Keeps calling a SubParser with the given args until it doesn't consume an
 * event or until the end of the event stream.
 */
export async function eventLoop<TArgs extends any[]>(cfg: SubParserConfig,
    parser: SubParser<SubParserResult, TArgs>, ...args: TArgs):
    Promise<SubParserResult>
{
    while (true)
    {
        // "reject" in this case means the parser doesn't consume an event
        // TODO: should each (or the last?) SubParserResult be returned at the
        //  end of the eventLoop?
        const peek1 = await tryPeek(cfg);
        if (!peek1) return {permHalt: true};

        const result = await parser(cfg, ...args);
        if (result.permHalt) return {permHalt: true};

        const peek2 = await tryPeek(cfg);
        if (!peek2) return {permHalt: true};

        if (peek1 === peek2) return {};
    }
}

/** Peeks at the next BattleEvent. Throws if there are none left. */
export async function peek(cfg: SubParserConfig): Promise<events.Any>
{
    const event = await tryPeek(cfg);
    if (!event) throw new Error("Expected event");
    return event;
}

/** Peeks at the next BattleEvent. Returns null if there are none left. */
export async function tryPeek(cfg: SubParserConfig): Promise<events.Any | null>
{
    const result = await cfg.iter.peek();
    return result.done ? null : result.value;
}

/**
 * Peeks and verifies the next BattleEvent's type. Throws if there are none
 * left or if the event is invalid.
 */
export async function verify<T extends events.Type>(cfg: SubParserConfig,
    type: T): Promise<events.Event<T>>
{
    const event = await peek(cfg);
    if (event.type !== type)
    {
        throw new Error(`Invalid event type: Expected '${type}' but got ` +
            `'${event.type}'`);
    }
    return event as events.Event<T>;
}

/**
 * Consumes a BattleEvent. Should be called after `verify()` and/or after the
 * (peeked) event has been fully handled by the calling SubParser. Throws if
 * there are no events left.
 */
export async function consume(cfg: SubParserConfig): Promise<events.Any>
{
    const result = await cfg.iter.next(cfg.state);
    if (result.done) throw new Error("Expected event");
    return result.value;
}
