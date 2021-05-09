import { inspect } from "util";
import { BattleAgent } from "../battle/agent/BattleAgent";
import { HaltReason } from "../battle/parser/BattleEvent";
import { BattleIterator, SenderResult, startBattleParser } from
    "../battle/parser/BattleParser";
import * as parsers from "../battle/parser/parsers";
import { BattleState } from "../battle/state/BattleState";
import { Logger } from "../Logger";
import * as psmsg from "./parser/PSMessage";
import { Sender } from "./PSBot";
import { PSEventHandler } from "./PSEventHandler";
import { RoomHandler } from "./RoomHandler";

/** Translates server messages to PSEventHandler calls. */
export class PSBattle implements RoomHandler
{
    /** Iterator for sending BattleEvents to the BattleParser. */
    protected readonly iter: BattleIterator;
    /** Translates game events to sim-agnostic BattleEvents. */
    protected readonly eventHandler: PSEventHandler;
    /** Pending Request message to process into an UpdateMoves event. */
    protected lastRequest: psmsg.Request | null = null;

    /**
     * If the last unhandled `|error|` message indicated an unavailable
     * choice, this field describes the type of rejected Choice, and the next
     * message should be a `|request|` to reveal new info.
     */
    private unavailableChoice: "move" | "switch" | null = null;

    /** Used for controlling the BattleParser's ChoiceSender Promise. */
    private parserSendCallback: null | ((result?: SenderResult) => void) = null;

    /** Promise for the BattleParser to finish handling a `halt` event. */
    private haltPromise: ReturnType<BattleIterator["next"]> | null = null;
    /** Promise for the entire BattleParser to finish. */
    private readonly finishPromise: Promise<BattleState>;

    /**
     * Creates a PSBattle.
     * @param username Client's username.
     * @param agent Makes the decisions for this battle.
     * @param sender Used to send messages to the server.
     * @param logger Logger object.
     * @param parser BattleEvent handler.
     * @param eventHandlerCtor The type of PSEventHandler to use.
     */
    constructor(protected readonly username: string, agent: BattleAgent,
        private readonly sender: Sender, protected readonly logger: Logger,
        parser = parsers.gen4, eventHandlerCtor = PSEventHandler)
    {
        const {iter, finish} = startBattleParser(
            {
                agent, logger: logger.addPrefix("BattleParser: "),
                sender: choice =>
                    new Promise<SenderResult>(res =>
                    {
                        this.parserSendCallback = res;
                        if (!this.sender(`|/choose ${choice}`))
                        {
                            logger.debug("Can't send Choice, force accept");
                            res();
                        }
                    })
                    .finally(() => this.parserSendCallback = null)
            },
            parser);
        this.iter = iter;
        this.finishPromise = finish;
        // suppress unhandled rejection warnings until #finish() is called
        finish.catch(() => {});

        this.eventHandler = new eventHandlerCtor(this.username,
            logger.addPrefix("PSEventHandler: "));
    }

    /** @override */
    public async init(msg: psmsg.BattleInit): Promise<void>
    {
        const events = this.eventHandler.initBattle(msg);
        this.logger.debug("Init:\n" +
            inspect(events, {colors: false, depth: null}));
        for (const event of events)
        {
            if ((await this.iter.next(event)).done) return await this.finish();
        }

        // possibly send a response
        return this.haltParser();
    }

    /** @override */
    public async progress(msg: psmsg.BattleProgress): Promise<void>
    {
        // indicate that the last choice was accepted
        this.parserSendCallback?.();
        if (this.haltPromise && (await this.haltPromise).done)
        {
            return await this.finish();
        }

        const events = this.eventHandler.handleEvents(msg.events);
        if (events.length <= 0) return;
        this.logger.debug("Progress:\n" +
            inspect(events, {colors: false, depth: null}));
        for (const event of events)
        {
            if ((await this.iter.next(event)).done) return await this.finish();
        }

        // possibly send a response
        return this.haltParser();
    }

    /** @override */
    public async request(msg: psmsg.Request): Promise<void>
    {
        const lastRequest = this.lastRequest;
        this.lastRequest = msg;
        if (this.unavailableChoice)
        {
            // new info may be revealed
            if (this.unavailableChoice === "switch" &&
                !lastRequest?.active?.[0].trapped &&
                msg.active?.[0].trapped)
            {
                this.parserSendCallback?.("trapped");
            }
            else if (this.unavailableChoice === "move" && msg.active)
            {
                this.parserSendCallback?.("disabled");
            }
            else this.parserSendCallback?.(true);

            this.unavailableChoice = null;
            return;
        }

        const events = this.eventHandler.handleRequest(msg);
        if (events.length <= 0) return;
        this.logger.debug("Request:\n" +
            inspect(events, {colors: false, depth: null}));
        for (const event of events)
        {
            if ((await this.iter.next(event)).done) return await this.finish();
        }
    }

    /** @override */
    public async error(msg: psmsg.Error): Promise<void>
    {
        if (msg.reason.startsWith("[Unavailable choice] Can't "))
        {
            // rejected last choice based on unknown info
            // wait for another (guaranteed) request message before proceeding
            const s = msg.reason.substr("[Unavailable choice] Can't ".length);
            // TODO: does this distinction matter?
            if (s.startsWith("move")) this.unavailableChoice = "move";
            else if (s.startsWith("switch")) this.unavailableChoice = "switch";
        }
        else if (msg.reason.startsWith("[Invalid choice]"))
        {
            // rejected last choice based on known info
            this.parserSendCallback?.(true);
        }
    }

    /**
     * Waits for the internal BattleParser to return after handling a game-over.
     */
    public async finish(): Promise<void>
    {
        if (this.haltPromise)
        {
            const haltResult = await this.haltPromise;
            if (!haltResult.done)
            {
                throw new Error("Last halt should've ended the BattleParser");
            }
        }
        await this.finishPromise;
    }

    /** Forces the internal BattleParser to finish. */
    public async forceFinish(): Promise<void>
    {
        await this.iter.return();
        await this.finish();
    }

    /**
     * Indicates to the BattleParser that the stream of BattleEvents has
     * temporarily halted, awaiting a response from the user or opponent based
     * on `#lastRequest`.
     */
    private async haltParser(): Promise<void>
    {
        // consume lastRequest
        const lastRequest = this.lastRequest;
        this.lastRequest = null;

        // already terminated
        if (!this.eventHandler.battling) return;

        // should never happen
        if (this.haltPromise) throw new Error("Already halted");

        // function that emits the halt event
        const halt = (reason: HaltReason) =>
            this.haltPromise = this.iter.next({type: "halt", reason})
                .finally(() => this.haltPromise = null);

        // set haltPromise field to parser.next(halt)
        // on next accept(), await it then reset it

        // waiting for opponent
        if (lastRequest?.wait) halt("wait");
        // being forced to switch
        else if (lastRequest?.forceSwitch) halt("switch");
        // making a normal move/switch selection
        else
        {
            if (lastRequest)
            {
                // see if we're locked into a multi-turn/recharge move
                const active = lastRequest.active?.[0];
                if (active?.trapped && active.moves.length === 1 &&
                    active.moves[0].pp == null && active.moves[0].maxpp == null)
                {
                    halt("wait");
                    this.sender("|/choose move 1");
                    return;
                }

                const event = this.eventHandler.updateMoves(lastRequest);
                this.logger.debug("Update moves:\n" +
                    inspect(event, {colors: false, depth: null}));
                if (event) await this.iter.next(event);
            }
            halt("decide");
        }
    }
}
