import { Protocol } from "@pkmn/protocol";
import { toIdName } from "../../../../../helpers";
import { BattleParserContext, consume, createDispatcher, verify } from
    "../../../parser";

/**
 * BattleParser handlers for each event type. Larger handler functions are moved
 * to a separate file.
 */
const handlers =
{
    async "|init|"(ctx: BattleParserContext<"gen4">)
    {
        // optional room initializer
        const event = await verify(ctx, "|init|");
        if (event.args[1] !== "battle")
        {
            throw new Error("Expected room type 'battle' but got " +
                `'${event.args[1]}'`)
        }
        await consume(ctx);
    },
    async "|title|"(ctx: BattleParserContext<"gen4">) {},
    async "|userlist|"(ctx: BattleParserContext<"gen4">) {},
    async "||"(ctx: BattleParserContext<"gen4">) {},
    async "|html|"(ctx: BattleParserContext<"gen4">) {},
    async "|uhtml|"(ctx: BattleParserContext<"gen4">) {},
    async "|uhtmlchange|"(ctx: BattleParserContext<"gen4">) {},
    async "|join|"(ctx: BattleParserContext<"gen4">) {},
    async "|leave|"(ctx: BattleParserContext<"gen4">) {},
    async "|name|"(ctx: BattleParserContext<"gen4">) {},
    async "|chat|"(ctx: BattleParserContext<"gen4">) {},
    async "|notify|"(ctx: BattleParserContext<"gen4">) {},
    async "|:|"(ctx: BattleParserContext<"gen4">) {},
    async "|c:|"(ctx: BattleParserContext<"gen4">) {},
    async "|t:|"(ctx: BattleParserContext<"gen4">) {},
    async "|battle|"(ctx: BattleParserContext<"gen4">) {},
    async "|popup|"(ctx: BattleParserContext<"gen4">) {},
    async "|pm|"(ctx: BattleParserContext<"gen4">) {},
    async "|usercount|"(ctx: BattleParserContext<"gen4">) {},
    async "|nametaken|"(ctx: BattleParserContext<"gen4">) {},
    async "|challstr|"(ctx: BattleParserContext<"gen4">) {},
    async "|updateuser|"(ctx: BattleParserContext<"gen4">) {},
    async "|formats|"(ctx: BattleParserContext<"gen4">) {},
    async "|updatesearch|"(ctx: BattleParserContext<"gen4">) {},
    async "|message|"(ctx: BattleParserContext<"gen4">) {},
    async "|updatechallenges|"(ctx: BattleParserContext<"gen4">) {},
    async "|queryresponse|"(ctx: BattleParserContext<"gen4">) {},
    async "|unlink|"(ctx: BattleParserContext<"gen4">) {},
    async "|raw|"(ctx: BattleParserContext<"gen4">) {},
    async "|error|"(ctx: BattleParserContext<"gen4">) {},
    async "|bigerror|"(ctx: BattleParserContext<"gen4">) {},
    async "|chatmsg|"(ctx: BattleParserContext<"gen4">) {},
    async "|chatmsg-raw|"(ctx: BattleParserContext<"gen4">) {},
    async "|controlshtml|"(ctx: BattleParserContext<"gen4">) {},
    async "|fieldhtml|"(ctx: BattleParserContext<"gen4">) {},
    async "|debug|"(ctx: BattleParserContext<"gen4">) {},
    async "|deinit|"(ctx: BattleParserContext<"gen4">) {},
    async "|selectorhtml|"(ctx: BattleParserContext<"gen4">) {},
    async "|refresh|"(ctx: BattleParserContext<"gen4">) {},
    async "|tempnotify|"(ctx: BattleParserContext<"gen4">) {},
    async "|tempnotifyoff|"(ctx: BattleParserContext<"gen4">) {},
    async "|noinit|"(ctx: BattleParserContext<"gen4">) {},
    async "|hidelines|"(ctx: BattleParserContext<"gen4">) {},
    async "|expire|"(ctx: BattleParserContext<"gen4">) {},
    async "|askreg|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|create|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|update|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|updateEnd|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|error|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|forceend|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|join|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|leave|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|replace|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|start|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|disqualify|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|battlestart|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|battleend|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|end|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|scouting|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|autostart|"(ctx: BattleParserContext<"gen4">) {},
    async "|tournament|autodq|"(ctx: BattleParserContext<"gen4">) {},
    async "|player|"(ctx: BattleParserContext<"gen4">) {},
    async "|teamsize|"(ctx: BattleParserContext<"gen4">) {},
    async "|gametype|"(ctx: BattleParserContext<"gen4">) {},
    async "|gen|"(ctx: BattleParserContext<"gen4">) {},
    async "|tier|"(ctx: BattleParserContext<"gen4">) {},
    async "|rated|"(ctx: BattleParserContext<"gen4">) {},
    async "|seed|"(ctx: BattleParserContext<"gen4">) {},
    async "|rule|"(ctx: BattleParserContext<"gen4">) {},
    async "|split|"(ctx: BattleParserContext<"gen4">) {},
    async "|teampreview|"(ctx: BattleParserContext<"gen4">) {},
    async "|clearpoke|"(ctx: BattleParserContext<"gen4">) {},
    async "|poke|"(ctx: BattleParserContext<"gen4">) {},
    async "|start|"(ctx: BattleParserContext<"gen4">) {},
    async "|done|"(ctx: BattleParserContext<"gen4">) {},
    async "|request|"(ctx: BattleParserContext<"gen4">) {},
    async "|inactive|"(ctx: BattleParserContext<"gen4">) {},
    async "|inactiveoff|"(ctx: BattleParserContext<"gen4">) {},
    async "|upkeep|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|turn|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|win|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|tie|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|move|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|switch|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|drag|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|detailschange|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|replace|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|swap|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|cant|"(ctx: BattleParserContext<"gen4">)
    {
        const event = await verify(ctx, "|cant|");

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
    async "|faint|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-formechange|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-fail|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-block|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-notarget|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-miss|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-damage|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-heal|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-sethp|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-status|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-curestatus|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-cureteam|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-boost|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-unboost|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-setboost|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-swapboost|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-invertboost|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-clearboost|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-clearallboost|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-clearpositiveboost|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-ohko|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-clearnegativeboost|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-copyboost|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-weather|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-fieldstart|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-fieldend|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-sidestart|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-sideend|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-start|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-end|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-crit|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-supereffective|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-resisted|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-immune|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-item|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-enditem|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-ability|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-endability|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-transform|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-mega|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-primal|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-burst|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-zpower|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-zbroken|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-activate|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-fieldactivate|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-hint|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-center|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-message|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-combine|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-waiting|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-prepare|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-mustrecharge|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-hitcount|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-singlemove|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-singleturn|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-anim|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|warning|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-candynamax|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|updatepoke|"(ctx: BattleParserContext<"gen4">)
    {
    },
    async "|-swapsideconditions|"(ctx: BattleParserContext<"gen4">)
    {
    }
} as const;

/** Dispatches event handler. */
export const dispatch = createDispatcher(handlers);
