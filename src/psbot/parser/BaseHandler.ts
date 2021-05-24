import { Args, KWArgs, Protocol } from "@pkmn/protocol";

type MaybeKWArgs<T extends Protocol.ArgName> =
    T extends Protocol.ArgsWithKWArgName ? KWArgs[T] : undefined;

/** Base Protocol.Handler implementation. */
export class BaseHandler<T = void> implements Protocol.Handler<T | void>
{
    public dispatch<N extends Protocol.ArgName>(args: Args[N],
        kwArgs: MaybeKWArgs<N>): T | void
    {
        const key = Protocol.key(args);
        if (key && key in this && this[key])
        {
            return (this[key] as
                    (args: Args[N], kwArgs: MaybeKWArgs<N>) => T)(
                args, kwArgs);
        }
    }

    public "|init|"(args: Args["|init|"]) {}
    public "|title|"(args: Args["|title|"]) {}
    public "|userlist|"(args: Args["|userlist|"]) {}
    public "||"(args: Args["||"]) {}
    public "|html|"(args: Args["|html|"]) {}
    public "|uhtml|"(args: Args["|uhtml|"]) {}
    public "|uhtmlchange|"(args: Args["|uhtmlchange|"]) {}
    public "|join|"(args: Args["|join|"]) {}
    public "|leave|"(args: Args["|leave|"]) {}
    public "|name|"(args: Args["|name|"]) {}
    public "|chat|"(args: Args["|chat|"]) {}
    public "|notify|"(args: Args["|notify|"]) {}
    public "|:|"(args: Args["|:|"]) {}
    public "|c:|"(args: Args["|c:|"]) {}
    public "|t:|"(args: Args["|t:|"]) {}
    public "|battle|"(args: Args["|battle|"]) {}
    public "|popup|"(args: Args["|popup|"]) {}
    public "|pm|"(args: Args["|pm|"]) {}
    public "|usercount|"(args: Args["|usercount|"]) {}
    public "|nametaken|"(args: Args["|nametaken|"]) {}
    public "|challstr|"(args: Args["|challstr|"]) {}
    public "|updateuser|"(args: Args["|updateuser|"]) {}
    public "|formats|"(args: Args["|formats|"]) {}
    public "|updatesearch|"(args: Args["|updatesearch|"]) {}
    public "|message|"(args: Args["|message|"]) {}
    public "|updatechallenges|"(args: Args["|updatechallenges|"]) {}
    public "|queryresponse|"(args: Args["|queryresponse|"]) {}
    public "|unlink|"(args: Args["|unlink|"]) {}
    public "|raw|"(args: Args["|raw|"]) {}
    public "|error|"(args: Args["|error|"]) {}
    public "|bigerror|"(args: Args["|bigerror|"]) {}
    public "|chatmsg|"(args: Args["|chatmsg|"]) {}
    public "|chatmsg-raw|"(args: Args["|chatmsg-raw|"]) {}
    public "|controlshtml|"(args: Args["|controlshtml|"]) {}
    public "|fieldhtml|"(args: Args["|fieldhtml|"]) {}
    public "|debug|"(args: Args["|debug|"]) {}
    public "|tournament|create|"(args: Args["|tournament|create|"]) {}
    public "|tournament|update|"(args: Args["|tournament|update|"]) {}
    public "|tournament|updateEnd|"(args: Args["|tournament|updateEnd|"]) {}
    public "|tournament|error|"(args: Args["|tournament|error|"]) {}
    public "|tournament|forceend|"(args: Args["|tournament|forceend|"]) {}
    public "|tournament|join|"(args: Args["|tournament|join|"]) {}
    public "|tournament|leave|"(args: Args["|tournament|leave|"]) {}
    public "|tournament|replace|"(args: Args["|tournament|replace|"]) {}
    public "|tournament|start|"(args: Args["|tournament|start|"]) {}
    public "|tournament|disqualify|"(args: Args["|tournament|disqualify|"]) {}
    public "|tournament|battlestart|"(args: Args["|tournament|battlestart|"]) {}
    public "|tournament|battleend|"(args: Args["|tournament|battleend|"]) {}
    public "|tournament|end|"(args: Args["|tournament|end|"]) {}
    public "|tournament|scouting|"(args: Args["|tournament|scouting|"]) {}
    public "|tournament|autostart|"(args: Args["|tournament|autostart|"]) {}
    public "|tournament|autodq|"(args: Args["|tournament|autodq|"]) {}
    public "|player|"(args: Args["|player|"]) {}
    public "|teamsize|"(args: Args["|teamsize|"]) {}
    public "|gametype|"(args: Args["|gametype|"]) {}
    public "|gen|"(args: Args["|gen|"]) {}
    public "|tier|"(args: Args["|tier|"]) {}
    public "|rated|"(args: Args["|rated|"]) {}
    public "|seed|"(args: Args["|seed|"]) {}
    public "|rule|"(args: Args["|rule|"]) {}
    public "|split|"(args: Args["|split|"]) {}
    public "|teampreview|"(args: Args["|teampreview|"]) {}
    public "|clearpoke|"(args: Args["|clearpoke|"]) {}
    public "|poke|"(args: Args["|poke|"]) {}
    public "|start|"(args: Args["|start|"]) {}
    public "|done|"(args: Args["|done|"]) {}
    public "|request|"(args: Args["|request|"]) {}
    public "|inactive|"(args: Args["|inactive|"]) {}
    public "|inactiveoff|"(args: Args["|inactiveoff|"]) {}
    public "|upkeep|"(args: Args["|upkeep|"]) {}
    public "|turn|"(args: Args["|turn|"]) {}
    public "|win|"(args: Args["|win|"]) {}
    public "|tie|"(args: Args["|tie|"]) {}
    public "|move|"(args: Args["|move|"], kwArgs: KWArgs["|move|"]) {}
    public "|switch|"(args: Args["|switch|"], kwArgs: KWArgs["|switch|"]) {}
    public "|drag|"(args: Args["|drag|"]) {}
    public "|detailschange|"(args: Args["|detailschange|"],
        kwArgs: KWArgs["|detailschange|"]) {}
    public "|replace|"(args: Args["|replace|"]) {}
    public "|swap|"(args: Args["|swap|"], kwArgs: KWArgs["|swap|"]) {}
    public "|cant|"(args: Args["|cant|"], kwArgs: KWArgs["|cant|"]) {}
    public "|faint|"(args: Args["|faint|"]) {}
    public "|-formechange|"(args: Args["|-formechange|"],
        kwArgs: KWArgs["|-formechange|"]) {}
    public "|-fail|"(args: Args["|-fail|"], kwArgs: KWArgs["|-fail|"]) {}
    public "|-block|"(args: Args["|-block|"], kwArgs: KWArgs["|-block|"]) {}
    public "|-notarget|"(args: Args["|-notarget|"]) {}
    public "|-miss|"(args: Args["|-miss|"], kwArgs: KWArgs["|-miss|"]) {}
    public "|-damage|"(args: Args["|-damage|"], kwArgs: KWArgs["|-damage|"]) {}
    public "|-heal|"(args: Args["|-heal|"], kwArgs: KWArgs["|-heal|"]) {}
    public "|-sethp|"(args: Args["|-sethp|"], kwArgs: KWArgs["|-sethp|"]) {}
    public "|-status|"(args: Args["|-status|"], kwArgs: KWArgs["|-status|"]) {}
    public "|-curestatus|"(args: Args["|-curestatus|"],
        kwArgs: KWArgs["|-curestatus|"]) {}
    public "|-cureteam|"(args: Args["|-cureteam|"],
        kwArgs: KWArgs["|-cureteam|"]) {}
    public "|-boost|"(args: Args["|-boost|"], kwArgs: KWArgs["|-boost|"]) {}
    public "|-unboost|"(args: Args["|-unboost|"],
        kwArgs: KWArgs["|-unboost|"]) {}
    public "|-setboost|"(args: Args["|-setboost|"],
        kwArgs: KWArgs["|-setboost|"]) {}
    public "|-swapboost|"(args: Args["|-swapboost|"],
        kwArgs: KWArgs["|-swapboost|"]) {}
    public "|-invertboost|"(args: Args["|-invertboost|"],
        kwArgs: KWArgs["|-invertboost|"]) {}
    public "|-clearboost|"(args: Args["|-clearboost|"],
        kwArgs: KWArgs["|-clearboost|"]) {}
    public "|-clearallboost|"(args: Args["|-clearallboost|"],
        kwArgs: KWArgs["|-clearallboost|"]) {}
    public "|-clearpositiveboost|"(args: Args["|-clearpositiveboost|"],
        kwArgs: KWArgs["|-clearpositiveboost|"]) {}
    public "|-ohko|"(args: Args["|-ohko|"]) {}
    public "|-clearnegativeboost|"(args: Args["|-clearnegativeboost|"],
        kwArgs: KWArgs["|-clearnegativeboost|"]) {}
    public "|-copyboost|"(args: Args["|-copyboost|"],
        kwArgs: KWArgs["|-copyboost|"]) {}
    public "|-weather|"(args: Args["|-weather|"],
        kwArgs: KWArgs["|-weather|"]) {}
    public "|-fieldstart|"(args: Args["|-fieldstart|"],
        kwArgs: KWArgs["|-fieldstart|"]) {}
    public "|-fieldend|"(args: Args["|-fieldend|"],
        kwArgs: KWArgs["|-fieldend|"]) {}
    public "|-sidestart|"(args: Args["|-sidestart|"],
        kwArgs: KWArgs["|-sidestart|"]) {}
    public "|-sideend|"(args: Args["|-sideend|"],
        kwArgs: KWArgs["|-sideend|"]) {}
    public "|-start|"(args: Args["|-start|"], kwArgs: KWArgs["|-start|"]) {}
    public "|-end|"(args: Args["|-end|"], kwArgs: KWArgs["|-end|"]) {}
    public "|-crit|"(args: Args["|-crit|"]) {}
    public "|-supereffective|"(args: Args["|-supereffective|"]) {}
    public "|-resisted|"(args: Args["|-resisted|"]) {}
    public "|-immune|"(args: Args["|-immune|"], kwArgs: KWArgs["|-immune|"]) {}
    public "|-item|"(args: Args["|-item|"], kwArgs: KWArgs["|-item|"]) {}
    public "|-enditem|"(args: Args["|-enditem|"],
        kwArgs: KWArgs["|-enditem|"]) {}
    public "|-ability|"(args: Args["|-ability|"],
        kwArgs: KWArgs["|-ability|"]) {}
    public "|-endability|"(args: Args["|-endability|"],
        kwArgs: KWArgs["|-endability|"]) {}
    public "|-transform|"(args: Args["|-transform|"],
        kwArgs: KWArgs["|-transform|"]) {}
    public "|-mega|"(args: Args["|-mega|"]) {}
    public "|-primal|"(args: Args["|-primal|"]) {}
    public "|-burst|"(args: Args["|-burst|"]) {}
    public "|-zpower|"(args: Args["|-zpower|"]) {}
    public "|-zbroken|"(args: Args["|-zbroken|"]) {}
    public "|-activate|"(args: Args["|-activate|"],
        kwArgs: KWArgs["|-activate|"]) {}
    public "|-fieldactivate|"(args: Args["|-fieldactivate|"],
        kwArgs: KWArgs["|-fieldactivate|"]) {}
    public "|-hint|"(args: Args["|-hint|"]) {}
    public "|-center|"(args: Args["|-center|"]) {}
    public "|-message|"(args: Args["|-message|"]) {}
    public "|-combine|"(args: Args["|-combine|"]) {}
    public "|-waiting|"(args: Args["|-waiting|"]) {}
    public "|-prepare|"(args: Args["|-prepare|"]) {}
    public "|-mustrecharge|"(args: Args["|-mustrecharge|"]) {}
    public "|-hitcount|"(args: Args["|-hitcount|"]) {}
    public "|-singlemove|"(args: Args["|-singlemove|"],
        kwArgs: KWArgs["|-singlemove|"]) {}
    public "|-singleturn|"(args: Args["|-singleturn|"],
        kwArgs: KWArgs["|-singleturn|"]) {}
    public "|-anim|"(args: Args["|-anim|"], kwArgs: KWArgs["|-anim|"]) {}
    public "|warning|"(args: Args["|warning|"]) {}
    public "|-candynamax|"(args: Args["|-candynamax|"]) {}
    public "|updatepoke|"(args: Args["|updatepoke|"]) {}
}
