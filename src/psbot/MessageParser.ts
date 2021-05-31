import { Protocol } from "@pkmn/protocol";
import { Transform, TransformCallback } from "stream";

/** Protocol message type for a single message line. */
export interface ProtocolMsg<T extends Protocol.ArgName = Protocol.ArgName>
{
    /** Room that the message came from. */
    roomid: Protocol.RoomID;
    /** Array args including message type. */
    args: Protocol.Args[T];
    /** Additional keyword args if applicable. */
    kwArgs: T extends Protocol.ArgsWithKWArgName ? Protocol.KWArgs[T] : {};
}

/**
 * Transform stream that parses PS protocol messages in chunks. Takes in
 * `string`s (in object mode), outputs `ProtocolMsg`s.
 */
export class MessageParser extends Transform
{
    constructor()
    {
        super({objectMode: true});
    }

    /** @override */
    _transform(chunk: string, encoding: BufferEncoding,
        callback: TransformCallback): void
    {
        (async () =>
        {
            try
            {
                for await (const msg of Protocol.parse(chunk))
                {
                    this.push(msg as ProtocolMsg);
                }
            }
            catch (e) { callback(e); return; }
            callback();
        })();
    }
}
