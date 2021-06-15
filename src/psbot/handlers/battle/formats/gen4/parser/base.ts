import { Protocol } from "@pkmn/protocol";
import { consume, createDispatcher } from
    "../../../../../../battle/parser/helpers";
import { toIdName } from "../../../../../helpers";
import { verifyNext } from "../../../helpers";
import { ParserContext } from "../../formats";

/**
 * BattleParser handlers for each event type. Larger handler functions are moved
 * to a separate file.
 */
const handlers =
{
    async "|init|"(ctx: ParserContext<"gen4">)
    {
        // optional room initializer
        const event = await verifyNext(ctx, "|init|");
        if (event.args[1] !== "battle")
        {
            throw new Error("Expected room type 'battle' but got " +
                `'${event.args[1]}'`)
        }
    },
    async "|title|"(ctx: ParserContext<"gen4">) {},
    async "|userlist|"(ctx: ParserContext<"gen4">) {},
    async "||"(ctx: ParserContext<"gen4">) {},
    async "|html|"(ctx: ParserContext<"gen4">) {},
    async "|uhtml|"(ctx: ParserContext<"gen4">) {},
    async "|uhtmlchange|"(ctx: ParserContext<"gen4">) {},
    async "|join|"(ctx: ParserContext<"gen4">) {},
    async "|leave|"(ctx: ParserContext<"gen4">) {},
    async "|name|"(ctx: ParserContext<"gen4">) {},
    async "|chat|"(ctx: ParserContext<"gen4">) {},
    async "|notify|"(ctx: ParserContext<"gen4">) {},
    async "|:|"(ctx: ParserContext<"gen4">) {},
    async "|c:|"(ctx: ParserContext<"gen4">) {},
    async "|t:|"(ctx: ParserContext<"gen4">) {},
    async "|battle|"(ctx: ParserContext<"gen4">) {},
    async "|popup|"(ctx: ParserContext<"gen4">) {},
    async "|pm|"(ctx: ParserContext<"gen4">) {},
    async "|usercount|"(ctx: ParserContext<"gen4">) {},
    async "|nametaken|"(ctx: ParserContext<"gen4">) {},
    async "|challstr|"(ctx: ParserContext<"gen4">) {},
    async "|updateuser|"(ctx: ParserContext<"gen4">) {},
    async "|formats|"(ctx: ParserContext<"gen4">) {},
    async "|updatesearch|"(ctx: ParserContext<"gen4">) {},
    async "|message|"(ctx: ParserContext<"gen4">) {},
    async "|updatechallenges|"(ctx: ParserContext<"gen4">) {},
    async "|queryresponse|"(ctx: ParserContext<"gen4">) {},
    async "|unlink|"(ctx: ParserContext<"gen4">) {},
    async "|raw|"(ctx: ParserContext<"gen4">) {},
    async "|error|"(ctx: ParserContext<"gen4">) {},
    async "|bigerror|"(ctx: ParserContext<"gen4">) {},
    async "|chatmsg|"(ctx: ParserContext<"gen4">) {},
    async "|chatmsg-raw|"(ctx: ParserContext<"gen4">) {},
    async "|controlshtml|"(ctx: ParserContext<"gen4">) {},
    async "|fieldhtml|"(ctx: ParserContext<"gen4">) {},
    async "|debug|"(ctx: ParserContext<"gen4">) {},
    async "|deinit|"(ctx: ParserContext<"gen4">) {},
    async "|selectorhtml|"(ctx: ParserContext<"gen4">) {},
    async "|refresh|"(ctx: ParserContext<"gen4">) {},
    async "|tempnotify|"(ctx: ParserContext<"gen4">) {},
    async "|tempnotifyoff|"(ctx: ParserContext<"gen4">) {},
    async "|noinit|"(ctx: ParserContext<"gen4">) {},
    async "|hidelines|"(ctx: ParserContext<"gen4">) {},
    async "|expire|"(ctx: ParserContext<"gen4">) {},
    async "|askreg|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|create|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|update|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|updateEnd|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|error|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|forceend|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|join|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|leave|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|replace|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|start|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|disqualify|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|battlestart|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|battleend|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|end|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|scouting|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|autostart|"(ctx: ParserContext<"gen4">) {},
    async "|tournament|autodq|"(ctx: ParserContext<"gen4">) {},
    async "|player|"(ctx: ParserContext<"gen4">) {},
    async "|teamsize|"(ctx: ParserContext<"gen4">) {},
    async "|gametype|"(ctx: ParserContext<"gen4">) {},
    async "|gen|"(ctx: ParserContext<"gen4">) {},
    async "|tier|"(ctx: ParserContext<"gen4">) {},
    async "|rated|"(ctx: ParserContext<"gen4">) {},
    async "|seed|"(ctx: ParserContext<"gen4">) {},
    async "|rule|"(ctx: ParserContext<"gen4">) {},
    async "|split|"(ctx: ParserContext<"gen4">) {},
    async "|teampreview|"(ctx: ParserContext<"gen4">) {},
    async "|clearpoke|"(ctx: ParserContext<"gen4">) {},
    async "|poke|"(ctx: ParserContext<"gen4">) {},
    async "|start|"(ctx: ParserContext<"gen4">) {},
    async "|done|"(ctx: ParserContext<"gen4">) {},
    async "|request|"(ctx: ParserContext<"gen4">) {},
    async "|inactive|"(ctx: ParserContext<"gen4">) {},
    async "|inactiveoff|"(ctx: ParserContext<"gen4">) {},
    async "|upkeep|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|turn|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|win|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|tie|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|move|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|switch|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|drag|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|detailschange|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|replace|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|swap|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|cant|"(ctx: ParserContext<"gen4">)
    {
        const event = await verifyNext(ctx, "|cant|");

        const ident = Protocol.parsePokemonIdent(event.args[1]);
        const reason = event.args[2];
        const moveName = event.args[3] && toIdName(event.args[3]);
        const mon = ctx.state.getTeam(ident.player).active;

        // already handled by previous |move| event in this case
        if (reason === "Focus Punch") return;

        switch (reason)
        {
            case "imprison":
                // opponent's imprison caused the pokemon to be prevented from
                //  moving, so the revealed move can be revealed for both sides
                if (!moveName) break;
                ctx.state.getTeam(ident.player === "p1" ? "p2" : "p1").active
                    .moveset.reveal(moveName);
            case "recharge":
                mon.volatile.mustRecharge = false;
                break;
            case "slp":
                mon.majorStatus.assert("slp").tick(mon.ability);
                break;
            default:
                if (reason.startsWith("ability: "))
                {
                    // dealing with an ability activation
                    await activateAbility(ctx);
                }
        }

        mon.inactive();
        if (moveName) mon.moveset.reveal(moveName);

        await consume(ctx);
    },
    async "|faint|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-formechange|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-fail|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-block|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-notarget|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-miss|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-damage|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-heal|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-sethp|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-status|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-curestatus|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-cureteam|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-boost|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-unboost|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-setboost|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-swapboost|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-invertboost|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-clearboost|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-clearallboost|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-clearpositiveboost|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-ohko|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-clearnegativeboost|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-copyboost|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-weather|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-fieldstart|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-fieldend|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-sidestart|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-sideend|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-start|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-end|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-crit|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-supereffective|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-resisted|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-immune|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-item|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-enditem|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-ability|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-endability|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-transform|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-mega|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-primal|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-burst|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-zpower|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-zbroken|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-activate|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-fieldactivate|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-hint|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-center|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-message|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-combine|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-waiting|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-prepare|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-mustrecharge|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-hitcount|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-singlemove|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-singleturn|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-anim|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|warning|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-candynamax|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|updatepoke|"(ctx: ParserContext<"gen4">)
    {
    },
    async "|-swapsideconditions|"(ctx: ParserContext<"gen4">)
    {
    }
} as const;

/** Dispatches event handler. */
export const dispatch =
    createDispatcher(handlers, event => Protocol.key(event.args));
