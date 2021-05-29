import { Args, KWArgs } from "@pkmn/protocol";
import { isPlayerID } from "../helpers";
import { BaseHandler } from "./BaseHandler";
import * as psmsg from "./PSMessage";

type Writable<T> = {-readonly [K in keyof T]: T[K]};

type BattleInitContext =
    Partial<Writable<Omit<psmsg.BattleInit, "type" | "teamSizes">>> &
{
    type: psmsg.BattleInit["type"];
    teamSizes?: Partial<Writable<psmsg.BattleInit["teamSizes"]>>;
};

type MessageHandlerContext = BattleInitContext;

export class MessageHandler extends BaseHandler<psmsg.Any>
{
    private context: MessageHandlerContext | null = null;

    public done(): psmsg.Any | null
    {
        const ctx = this.context;
        switch (ctx?.type)
        {
            case "battleInit":
                if (MessageHandler.validateBattleInit(ctx))
                {
                    const event: psmsg.BattleInit = ctx;
                    this.context = null;
                    return event;
                }
                break;
        }
        return null;
    }

    private static validateBattleInit(ctx: BattleInitContext):
        ctx is psmsg.BattleInit
    {
        ctx.rules ??= [];
        ctx.events ??= [];
        return !!(ctx.id && ctx.username && ctx.teamSizes?.p1 &&
            ctx.teamSizes.p2 && ctx.gen);
    }

    public "|init|"(args: Args["|init|"]): psmsg.Init
    {
        return {type: "init", roomType: args[1]};
    }
    public "|challstr|"(args: Args["|challstr|"]): psmsg.ChallStr
    {
        return {type: "challstr", challstr: args[1]};
    }
    public "|updateuser|"(args: Args["|updateuser|"]): psmsg.UpdateUser
    {
        return {
            type: "updateUser", username: args[1], isGuest: args[2] === "1"
        };
    }
    public "|updatechallenges|"(args: Args["|updatechallenges|"]):
        psmsg.UpdateChallenges
    {
        // TODO: Protocol.parseChallenges(args[1]);
        return {type: "updateChallenges", ...JSON.parse(args[1])}
    }
    public "|error|"(args: Args["|error|"]): psmsg.Error
    {
        return {type: "error", reason: args[1]};
    }
    public "|player|"(args: Args["|player|"])
    {
        const id = args[1];
        if (!isPlayerID(id)) return;
        const username = args[2];
        if (!username) return;

        this.context ??= {type: "battleInit"};
        this.context.id = id;
        this.context.username = username;
    }
    public "|teamsize|"(args: Args["|teamsize|"])
    {
        const id = args[1];
        if (!isPlayerID(id)) return;
        const size = parseInt(args[2], 10);
        if (size <= 0) return;

        this.context ??= {type: "battleInit"};
        this.context.teamSizes ??= {};
        this.context.teamSizes[id] = size;
    }
    public "|gametype|"(args: Args["|gametype|"])
    {
    }
    public "|gen|"(args: Args["|gen|"])
    {
        const gen = args[1];
        this.context ??= {type: "battleInit"};
        this.context.gen = gen;
    }
    public "|tier|"(args: Args["|tier|"])
    {
        const tier = args[1];
        this.context ??= {type: "battleInit"};
        this.context.tier = tier;
    }
    public "|rated|"(args: Args["|rated|"])
    {
        this.context ??= {type: "battleInit"};
        this.context.rated = true;
    }
    public "|rule|"(args: Args["|rule|"])
    {
        this.context ??= {type: "battleInit"};
        this.context.rules ??= [];
        this.context.rules.push(args[1]);
        // TODO: how to emit the entire BattleInit msg with the initial
        //  BattleEvents?
    }
    // TODO: support team preview
    public "|teampreview|"(args: Args["|teampreview|"]) {}
    public "|clearpoke|"(args: Args["|clearpoke|"]) {}
    public "|poke|"(args: Args["|poke|"]) {}
    public "|start|"(args: Args["|start|"])
    {
    }
    public "|request|"(args: Args["|request|"]): psmsg.Request
    {
        // TODO: Protocol.parseRequest(args[1]);
        return {type: "request", ...JSON.parse(args[1])};
    }
    public "|inactive|"(args: Args["|inactive|"]) {
    }
    public "|inactiveoff|"(args: Args["|inactiveoff|"]) {
    }
    public "|upkeep|"(args: Args["|upkeep|"]) {
    }
    public "|turn|"(args: Args["|turn|"]) {
    }
    public "|win|"(args: Args["|win|"]) {
    }
    public "|tie|"(args: Args["|tie|"]) {
    }
    public "|move|"(args: Args["|move|"], kwArgs: KWArgs["|move|"]) {
    }
    public "|switch|"(args: Args["|switch|"], kwArgs: KWArgs["|switch|"]) {
    }
    public "|drag|"(args: Args["|drag|"]) {
    }
    public "|detailschange|"(args: Args["|detailschange|"], kwArgs: KWArgs["|detailschange|"]) {
    }
    public "|replace|"(args: Args["|replace|"]) {
    }
    public "|swap|"(args: Args["|swap|"], kwArgs: KWArgs["|swap|"]) {
    }
    public "|cant|"(args: Args["|cant|"], kwArgs: KWArgs["|cant|"]) {
    }
    public "|faint|"(args: Args["|faint|"]) {
    }
    public "|-formechange|"(args: Args["|-formechange|"], kwArgs: KWArgs["|-formechange|"]) {
    }
    public "|-fail|"(args: Args["|-fail|"], kwArgs: KWArgs["|-fail|"]) {
    }
    public "|-block|"(args: Args["|-block|"], kwArgs: KWArgs["|-block|"]) {
    }
    public "|-notarget|"(args: Args["|-notarget|"]) {
    }
    public "|-miss|"(args: Args["|-miss|"], kwArgs: KWArgs["|-miss|"]) {
    }
    public "|-damage|"(args: Args["|-damage|"], kwArgs: KWArgs["|-damage|"]) {
    }
    public "|-heal|"(args: Args["|-heal|"], kwArgs: KWArgs["|-heal|"]) {
    }
    public "|-sethp|"(args: Args["|-sethp|"], kwArgs: KWArgs["|-sethp|"]) {
    }
    public "|-status|"(args: Args["|-status|"], kwArgs: KWArgs["|-status|"]) {
    }
    public "|-curestatus|"(args: Args["|-curestatus|"], kwArgs: KWArgs["|-curestatus|"]) {
    }
    public "|-cureteam|"(args: Args["|-cureteam|"], kwArgs: KWArgs["|-cureteam|"]) {
    }
    public "|-boost|"(args: Args["|-boost|"], kwArgs: KWArgs["|-boost|"]) {
    }
    public "|-unboost|"(args: Args["|-unboost|"], kwArgs: KWArgs["|-unboost|"]) {
    }
    public "|-setboost|"(args: Args["|-setboost|"], kwArgs: KWArgs["|-setboost|"]) {
    }
    public "|-swapboost|"(args: Args["|-swapboost|"], kwArgs: KWArgs["|-swapboost|"]) {
    }
    public "|-invertboost|"(args: Args["|-invertboost|"], kwArgs: KWArgs["|-invertboost|"]) {
    }
    public "|-clearboost|"(args: Args["|-clearboost|"], kwArgs: KWArgs["|-clearboost|"]) {
    }
    public "|-clearallboost|"(args: Args["|-clearallboost|"], kwArgs: KWArgs["|-clearallboost|"]) {
    }
    public "|-clearpositiveboost|"(args: Args["|-clearpositiveboost|"], kwArgs: KWArgs["|-clearpositiveboost|"]) {
    }
    public "|-ohko|"(args: Args["|-ohko|"]) {
    }
    public "|-clearnegativeboost|"(args: Args["|-clearnegativeboost|"], kwArgs: KWArgs["|-clearnegativeboost|"]) {
    }
    public "|-copyboost|"(args: Args["|-copyboost|"], kwArgs: KWArgs["|-copyboost|"]) {
    }
    public "|-weather|"(args: Args["|-weather|"], kwArgs: KWArgs["|-weather|"]) {
    }
    public "|-fieldstart|"(args: Args["|-fieldstart|"], kwArgs: KWArgs["|-fieldstart|"]) {
    }
    public "|-fieldend|"(args: Args["|-fieldend|"], kwArgs: KWArgs["|-fieldend|"]) {
    }
    public "|-sidestart|"(args: Args["|-sidestart|"], kwArgs: KWArgs["|-sidestart|"]) {
    }
    public "|-sideend|"(args: Args["|-sideend|"], kwArgs: KWArgs["|-sideend|"]) {
    }
    public "|-start|"(args: Args["|-start|"], kwArgs: KWArgs["|-start|"]) {
    }
    public "|-end|"(args: Args["|-end|"], kwArgs: KWArgs["|-end|"]) {
    }
    public "|-crit|"(args: Args["|-crit|"]) {
    }
    public "|-supereffective|"(args: Args["|-supereffective|"]) {
    }
    public "|-resisted|"(args: Args["|-resisted|"]) {
    }
    public "|-immune|"(args: Args["|-immune|"], kwArgs: KWArgs["|-immune|"]) {
    }
    public "|-item|"(args: Args["|-item|"], kwArgs: KWArgs["|-item|"]) {
    }
    public "|-enditem|"(args: Args["|-enditem|"], kwArgs: KWArgs["|-enditem|"]) {
    }
    public "|-ability|"(args: Args["|-ability|"], kwArgs: KWArgs["|-ability|"]) {
    }
    public "|-endability|"(args: Args["|-endability|"], kwArgs: KWArgs["|-endability|"]) {
    }
    public "|-transform|"(args: Args["|-transform|"], kwArgs: KWArgs["|-transform|"]) {
    }
    public "|-mega|"(args: Args["|-mega|"]) {
    }
    public "|-primal|"(args: Args["|-primal|"]) {
    }
    public "|-burst|"(args: Args["|-burst|"]) {
    }
    public "|-zpower|"(args: Args["|-zpower|"]) {
    }
    public "|-zbroken|"(args: Args["|-zbroken|"]) {
    }
    public "|-activate|"(args: Args["|-activate|"], kwArgs: KWArgs["|-activate|"]) {
    }
    public "|-fieldactivate|"(args: Args["|-fieldactivate|"], kwArgs: KWArgs["|-fieldactivate|"]) {
    }
    public "|-hint|"(args: Args["|-hint|"]) {
    }
    public "|-center|"(args: Args["|-center|"]) {
    }
    public "|-message|"(args: Args["|-message|"]) {
    }
    public "|-combine|"(args: Args["|-combine|"]) {
    }
    public "|-waiting|"(args: Args["|-waiting|"]) {
    }
    public "|-prepare|"(args: Args["|-prepare|"]) {
    }
    public "|-mustrecharge|"(args: Args["|-mustrecharge|"]) {
    }
    public "|-hitcount|"(args: Args["|-hitcount|"]) {
    }
    public "|-singlemove|"(args: Args["|-singlemove|"], kwArgs: KWArgs["|-singlemove|"]) {
    }
    public "|-singleturn|"(args: Args["|-singleturn|"], kwArgs: KWArgs["|-singleturn|"]) {
    }
    public "|-anim|"(args: Args["|-anim|"], kwArgs: KWArgs["|-anim|"]) {
    }
    public "|warning|"(args: Args["|warning|"]) {
    }
    public "|-candynamax|"(args: Args["|-candynamax|"]) {
    }
    public "|updatepoke|"(args: Args["|updatepoke|"]) {
    }
}
