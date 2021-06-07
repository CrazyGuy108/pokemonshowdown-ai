import { Protocol } from "@pkmn/protocol";
import { BattleIterator, BattleParserResult, ChoiceSender, SenderResult } from
    "../../../battle/parser";
import { Logger } from "../../../Logger";
import { Event } from "../../parser";
import { Sender } from "../../PSBot";
import { RoomHandler } from "../RoomHandler";
import * as formats from "./formats";

/**
 * Args for BattleHandler constructor.
 * @template TFormatType Battle format for this room.
 * @template TAgent Battle agent type.
 */
export interface BattleHandlerArgs
<
    TFormatType extends formats.FormatType = formats.FormatType,
    TAgent extends formats.Agent<TFormatType> = formats.Agent<TFormatType>
>
{
    /** Battle format for this room. */
    readonly format: TFormatType;
    /** Client's username. */
    readonly username: string;
    /** BattleParser config. Defaults to format default. */
    /**
     * Function for building up a battle state for the BattleAgent. Defaults to
     * format default.
     */
    readonly parser?: formats.Parser<TFormatType, TAgent>;
    /** Function for deciding what to do. */
    readonly agent: TAgent;
    /** Used for sending messages to the assigned server room. */
    readonly sender: Sender;
    /** Logger object. Default stderr. */
    readonly logger?: Logger;
}

/**
 * Base handler for battle rooms.
 * @template TFormatType Battle format for this room.
 * @template TAgent Battle agent type.
 */
export class BattleHandler
<
    TFormatType extends formats.FormatType = formats.FormatType,
    TAgent extends formats.Agent<TFormatType> = formats.Agent<TFormatType>
>
    implements RoomHandler
{
    /** Battle format for this room. */
    public readonly format: TFormatType;
    /** Client's username. */
    private readonly username: string;
    /** Used for sending messages to the assigned server room. */
    private readonly sender: Sender;
    /** Logger object. */
    private readonly logger: Logger;

    /** Pending Request message to process into an UpdateMoves event. */
    private lastRequest: Protocol.Request | null = null;

    /**
     * Callback to resolve the BattleParser's last ChoiceSender call. The next
     * event received after this call is treated as a response to it.
     */
    private choiceSenderRes: ((result: SenderResult) => void) | null = null;
    /**
     * If the last unhandled `|error|` message indicated an unavailable
     * choice, this field describes the type of rejected Choice, and the next
     * message should be a `|request|` to reveal new info.
     */
    private unavailableChoice: "move" | "switch" | null = null;

    /** Iterator for sending PS Events to the BattleParser. */
    private readonly iter: BattleIterator<Event>;
    /** Promise for the entire BattleParser to finish. */
    private readonly finishPromise: Promise<BattleParserResult>;

    constructor({format, username, parser, agent, sender, logger}:
        BattleHandlerArgs<TFormatType, TAgent>)
    {
        this.format = format;
        this.username = username;
        this.sender = sender;
        this.logger = logger ?? Logger.stderr;

        const choiceSender: ChoiceSender =
            choice =>
                new Promise<SenderResult>(res =>
                {
                    this.choiceSenderRes = res;
                    if (!this.sender(`|/choose ${choice}`))
                    {
                        this.logger.debug(
                            "Can't send Choice, force accept");
                        res();
                    }
                })
                .finally(() => this.choiceSenderRes = null);

        const cfg: formats.StartParserArgs<TFormatType, TAgent> =
        {
            agent, logger: this.logger, sender: choiceSender,
            getState: () => new formats.state[format]()
        };

        const {iter, finish} = formats.startParser(cfg,
                parser ?? formats.map[format].parser);
        this.iter = iter;
        this.finishPromise = finish;
    }

    /** @override */
    public async handle(event: Event): Promise<void>
    {
        if (event.args[0] === "request")
        {
            this.handleRequest(event as Event<"|request|">);
        }
        else if (event.args[0] === "error")
        {
            this.handleError(event as Event<"|error|">);
        }
        else this.choiceSenderRes?.();

        if ((await this.iter.next(event)).done) await this.finish();
    }

    /**
     * Waits for the internal BattleParser to return after handling a game-over.
     */
    public async finish(): Promise<void>
    {
        await this.finishPromise;
    }

    /** Forces the internal BattleParser to finish. */
    public async forceFinish(): Promise<void>
    {
        await this.iter.return();
        await this.finish();
    }

    private handleRequest(event: Event<"|request|">): void
    {
        const [, json] = event.args;
        const lastRequest = this.lastRequest;
        this.lastRequest = Protocol.parseRequest(json);

        if (!this.unavailableChoice) return;

        // new info may be revealed
        if (this.unavailableChoice === "switch" &&
            lastRequest?.requestType === "move" &&
            lastRequest.active[0] && !lastRequest.active[0].trapped &&
            this.lastRequest.requestType === "move" &&
            this.lastRequest.active[0]?.trapped)
        {
            this.choiceSenderRes?.("trapped");
        }
        else if (this.unavailableChoice === "move" &&
            this.lastRequest.requestType === "move" &&
            this.lastRequest.active[0])
        {
            this.choiceSenderRes?.("disabled");
        }
        else this.choiceSenderRes?.(true);

        this.unavailableChoice = null;
    }

    private handleError(event: Event<"|error|">): void
    {
        const [, reason] = event.args;
        if (reason.startsWith("[Unavailable choice] Can't "))
        {
            // rejected last choice based on unknown info
            // wait for another (guaranteed) request message before proceeding
            const s = reason.substr("[Unavailable choice] Can't ".length);
            // TODO: does this distinction matter?
            if (s.startsWith("move")) this.unavailableChoice = "move";
            else if (s.startsWith("switch")) this.unavailableChoice = "switch";
            // now that this info has been revealed, we should get an updated
            //  |request| message
        }
        else if (reason.startsWith("[Invalid choice]"))
        {
            // rejected last choice based on unrevealed or already-known info
            this.choiceSenderRes?.(true);
        }
    }
}
