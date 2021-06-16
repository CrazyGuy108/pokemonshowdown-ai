import { Protocol } from "@pkmn/protocol";
import { Transform, TransformCallback } from "stream";

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
        try
        {
            for (const msg of Protocol.parse(chunk))
            {
                this.push(msg);
            }
            // TODO: send a "halt" signal after parsing a block
        }
        catch (e) { return callback(e); }
        callback();
    }
}
