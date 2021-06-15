import { Protocol } from "@pkmn/protocol";
import fetch, { RequestInit } from "node-fetch";
import { client as WSClient } from "websocket";
import { Logger } from "../Logger";
import * as handlers from "./handlers";
import { MessageParser, RoomEvent } from "./parser";

/** Options for login. */
export interface LoginOptions
{
    /** Account username. */
    readonly username: string;
    /** Account password. */
    readonly password?: string;
    /** Server url used for login. */
    readonly loginServer: string;
}

/**
 * Function type for sending responses to a server.
 * @param responses Messages to send.
 * @returns False if the messages can't be sent, true otherwise.
 */
export type Sender = (...responses: string[]) => boolean;

/**
 * Creates a RoomHandler for a room that the PSBot has joined.
 * @param room Room name.
 * @param username Username of the PSBot.
 * @param sender The function that will be used for sending responses.
 */
export type HandlerFactory = (room: string, username: string, sender: Sender) =>
    handlers.RoomHandler;

/** Manages the connection to a PokemonShowdown server. */
export class PSBot
{
    /** Websocket client. Used for connecting to the server. */
    private readonly client = new WSClient();
    /** Current active rooms. */
    private readonly rooms = new Map<Protocol.RoomID, handlers.RoomHandler>();
    /** Dictionary of accepted formats for battle challenges. */
    private readonly formats = new Map<string, HandlerFactory>();

    /** Whether we've already logged in. */
    private loggedIn = false;
    /** Username of the client. Initialized on login. */
    private username?: string;

    /** Sends a response to the server. */
    private sender: Sender =
        () => { throw new Error("Sender not initialized"); }

    /** Promise that resolves once we've connected to the server. */
    private connected = new Promise<void>((res, rej) =>
        this.connectedRes = err =>
        {
            this.connectedRes = () => {};
            if (!err) res();
            else rej(err);
        });
    /** Callback to resolve the `#connected` Promise. */
    private connectedRes: (err?: Error) => void = () => {};

    /** Used for handling global PS messages. */
    private readonly globalHandler = new handlers.global.GlobalHandler();
    /** Stream used for parsing PS protocol messages. */
    private readonly parser = new MessageParser();

    /**
     * Creates a PSBot.
     * @param logger Used to log debug info.
     */
    constructor(private readonly logger = Logger.stderr)
    {
        this.addHandler("" as Protocol.RoomID, this.globalHandler);
        this.initClient();
        this.globalHandler.updateUser = username => this.updateUser(username);
        this.globalHandler.respondToChallenge =
            (user, format) => this.respondToChallenge(user, format);

        // async
        // TODO: tie this to a method that can be awaited after setting up the
        //  PSBot
        this.parserReadLoop();
    }

    /**
     * Allows the PSBot to accept battle challenges for the given format.
     * @param format Name of the format to use.
     * @param f Room handler factory function.
     */
    public acceptChallenges(format: string, f: HandlerFactory): void
    {
        this.formats.set(format, f);
    }

    /**
     * Adds a handler for a room.
     * @param roomid Room id.
     * @param handler Object that handles messages coming from the given room.
     */
    public addHandler(roomid: Protocol.RoomID, handler: handlers.RoomHandler):
        void
    {
        if (this.rooms.has(roomid))
        {
            throw new Error(`Already have a handler for room '${roomid}'`);
        }
        this.rooms.set(roomid, handler);
    }

    // TODO: support reconnects/disconnects
    /** Connects to the server and starts handling messages. */
    public async connect(url: string): Promise<void>
    {
        this.client.connect(url);
        return await this.connected;
    }

    /**
     * Sets up this PSBot to login once connected.
     * @param options Login options.
     * @returns A Promise that resolves once logged in.
     */
    public async login(options: LoginOptions): Promise<void>
    {
        if (this.loggedIn)
        {
            // TODO: add logout functionality?
            return this.logger.error("Already logged in");
        }

        this.logger.debug("Configured to login under username " +
            `'${options.username}'`);

        const challstr = await this.globalHandler.challstr;

        const init: RequestInit =
        {
            method: "POST",
            headers: {"Content-Type": "application/x-www-form-urlencoded"}
        };

        // get the assertion string used to confirm login
        let assertion: string;

        if (!options.password)
        {
            // login without password
            init.body = `act=getassertion&userid=${options.username}` +
                `&challstr=${challstr}`;
            const result = await fetch(options.loginServer, init);
            assertion = await result.text();

            if (assertion.startsWith(";"))
            {
                // login attempt was rejected
                if (assertion.startsWith(";;"))
                {
                    // error message was provided
                    throw new Error(assertion.substr(2));
                }
                throw new Error("A password is required for user " +
                    `'${options.username}'`);
            }
        }
        else
        {
            // login with password
            init.body = `act=login&name=${options.username}` +
                `&pass=${options.password}&challstr=${challstr}`;
            const result = await fetch(options.loginServer, init);
            const text = await result.text();
            // response text returns "]" followed by json
            const json = JSON.parse(text.substr(1));

            assertion = json.assertion;
            if (!json.actionsuccess)
            {
                // login attempt was rejected
                if (assertion.startsWith(";;"))
                {
                    // error message was provided
                    throw new Error(assertion.substr(2));
                }
                throw new Error("Invalid password");
            }
        }

        // complete the login
        this.loggedIn =
            this.addResponses("", `|/trn ${options.username},0,${assertion}`);
    }

    /** Sets avatar id. */
    public setAvatar(avatar: number): void
    {
        this.addResponses("", `|/avatar ${avatar}`);
    }

    private initClient(): void
    {
        this.client.on("connect", connection =>
        {
            this.logger.debug("Connected");

            this.sender = (...responses: string[]) =>
            {
                if (!connection.connected) return false;
                for (const response of responses)
                {
                    connection.sendUTF(response);
                    this.logger.debug(`Sent: ${response}`);
                }
                return true;
            };

            connection.on("error", error =>
                this.logger.error(`Connection error: ${error.toString()}`));
            connection.on("close", (code, reason) =>
                this.logger.debug(`Closing connection (${code}): ${reason}`));
            connection.on("message", data =>
            {
                if (data.type === "utf8" && data.utf8Data)
                {
                    this.logger.debug(`Received:\n${data.utf8Data}`);
                    this.parser.write(data.utf8Data);
                }
            });

            this.connectedRes();
        });
        this.client.on("connectFailed", err =>
        {
            this.logger.error(`Failed to connect: ${err.stack ?? err}`);
            this.connectedRes(err);
        });
    }

    private updateUser(username: string): void
    {
        this.username = username;
    }

    private respondToChallenge(user: string, format: string): void
    {
        if (this.formats.hasOwnProperty(format))
        {
            this.addResponses("", `|/accept ${user}`);
        }
        else this.addResponses("", `|/reject ${user}`);
    }

    /**
     * Sets up a read loop from the MessageParser stream and dispatches parsed
     * messages to their respective room handlers.
     */
    private async parserReadLoop(): Promise<void>
    {
        for await (const msg of this.parser)
        {
            const pmsg = msg as RoomEvent;
            await this.dispatch(pmsg);
        }
    }

    /** Handles parsed protocol messages received from the PS serer. */
    private async dispatch<T extends Protocol.ArgName>(
        {roomid, args, kwArgs}: RoomEvent<T>): Promise<void>
    {
        let handler = this.rooms.get(roomid);
        if (!handler)
        {
            // first msg when joining a battle room must be |init|battle
            if (args[0] === "init" && args[1] === "battle")
            {
                // battle rooms follow a naming convention: battle-<format>-<id>
                const format = roomid.split("-")[1];
                const f = this.formats.get(format);
                if (f)
                {
                    if (!this.username)
                    {
                        this.logger.error("Could not join battle room " +
                            `'${roomid}': Username not initialized`);
                        return;
                    }
                    const sender: Sender = (...responses: string[]) =>
                        this.addResponses(roomid, ...responses);

                    handler = f(roomid, this.username, sender);
                    this.addHandler(roomid, handler);
                }
                else
                {
                    this.logger.error("Could not join battle room " +
                        `'${roomid}': Format '${format}' not supported`);
                    return;
                }
            }
            else
            {
                this.logger.error(`Could not join chat room '${roomid}': ` +
                    "No handlers found");
                return;
            }
        }

        await handler.handle({args, kwArgs});

        if (args[0] === "deinit")
        {
            // roomid defaults to lobby if deinit didn't come from a room
            this.rooms.delete(roomid || "lobby" as Protocol.RoomID);
        }
        // leave respectfully once the battle ends
        // TODO: move this to BattleHandler
        else if (args[0] === "tie" || args[0] === "win")
        {
            this.addResponses(roomid, "|gg", "|/leave");
        }
    }

    /**
     * Sends a list of responses to the server.
     * @param room Room to send the response from. Can be empty if no room in
     * particular.
     * @param responses Responses to be sent to the server.
     * @returns False if the messages can't be sent, true otherwise.
     */
    private addResponses(room: string, ...responses: string[]): boolean
    {
        return this.sender(...responses.map(res => room + res));
    }
}
