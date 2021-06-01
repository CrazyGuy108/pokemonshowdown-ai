import { Protocol } from "@pkmn/protocol";
import { Transform, TransformCallback } from "stream";
import { RoomEvent } from "./Event";

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
        try { this.tryParse(chunk); }
        catch (e) { return callback(e); }
        callback();
    }

    private tryParse(chunk: string): void
    {
        if (!chunk) return;
        const lines = chunk.split("\n");
        if (lines.length <= 0) return;

        let roomid: Protocol.RoomID;
        if (lines[0].charAt(0) === ">")
        {
            roomid = lines.shift()!.substr(1) as Protocol.RoomID;
        }
        else roomid = "" as Protocol.RoomID;

        for (const line of lines)
        {
            if (!line) continue;

            let msg: RoomEvent;
            if (line === "|deinit")
            {
                // custom deinit wrapper
                // see https://github.com/pkmn/ps/issues/8
                msg =
                    {roomid, args: ["", line as Protocol.Message], kwArgs: {}};
            }
            else
            {
                const {args, kwArgs} = Protocol.parseBattleLine(line);
                msg = {roomid, args, kwArgs};
            }
            this.push(msg);
        }
    }
}
