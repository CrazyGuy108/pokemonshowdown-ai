import * as dex from "./handlers/battle/formats/gen4/dex/dex";
import * as dexutil from "./handlers/battle/formats/gen4/dex/dex-util";
import * as events from "../battle/parser/BattleEvent";
import { otherSide, Side } from "./handlers/battle/formats/gen4/state/Side";
import { Logger } from "../Logger";
import { isPlayerID, otherPlayerID, PlayerID, PokemonID, toIdName } from
    "./helpers";
import * as psevent from "./parser/PSBattleEvent";
import * as psmsg from "./parser/PSMessage";

/** Translates PSBattleEvents from the PS server into BattleEvents. */
export class PSEventHandler
{
    /** Whether the battle is still going on. */
    public get battling(): boolean { return this._battling; }
    private _battling = false;

    /** Client's username. */
    protected readonly username: string;
    /** Logger object. */
    protected readonly logger: Logger;
    /**
     * Determines which PlayerID (p1 or p2) corresponds to which Side (us or
     * them).
     */
    private sides?: {readonly [ID in PlayerID]: Side};
    /** Whether a TurnEvent was encountered in the last handleEvents call. */
    private newTurn = false;

    /**
     * Creates a PSEventHandler.
     * @param username Username of the client.
     * @param logger Logger object.
     */
    constructor(username: string, logger: Logger)
    {
        this.username = username;
        this.logger = logger;
    }

    /** Processes a `request` message. */
    public handleRequest(args: psmsg.Request): events.Any[]
    {
        // a request message is given at the start of the battle, before any
        //  other, which is all we need to initialize our side of the battle
        //  state before handling battleinit messages
        if (this._battling) return [];

        // first time: initialize client team data
        // copy pokemon array so we can modify it
        const team: events.InitPokemon[] = [...args.side.pokemon];

        // preprocess move names, which are encoded with additional features
        for (let i = 0; i < team.length; ++i)
        {
            // copy pokemon obj and moves so we can modify them
            const mon = {...team[i], species: toIdName(team[i].species)};
            team[i] = mon;

            const moves = [...team[i].moves];
            mon.moves = moves;

            for (let j = 0; j < moves.length; ++j)
            {
                if (moves[j].startsWith("hiddenpower") &&
                    moves[j].length > "hiddenpower".length)
                {
                    // set hidden power type
                    // format: hiddenpower<type><base power if gen2-5>
                    mon.hpType = moves[j].substr("hiddenpower".length)
                        .replace(/\d+/, "") as dexutil.HPType;
                    moves[j] = "hiddenpower";
                }
                else if (moves[j].startsWith("return") &&
                    moves[j].length > "return".length)
                {
                    // calculate happiness value from base power
                    mon.happiness = 2.5 *
                        parseInt(moves[j].substr("return".length), 10);
                    moves[j] = "return";
                }
                else if (moves[j].startsWith("frustration") &&
                    moves[j].length > "frustration".length)
                {
                    // calculate happiness value from base power
                    mon.happiness = 255 - 2.5 *
                            parseInt(moves[j].substr("frustration".length), 10);
                    moves[j] = "frustration";
                }
            }
        }

        return [{type: "initTeam", team}];
    }

    /** Gets the active moves part of a Request message. */
    public updateMoves(args: psmsg.Request): events.UpdateMoves | null
    {
        if (!args.active?.[0].moves) return null;
        const moves = args.active[0].moves
                .filter(({pp, maxpp}) => pp != null && maxpp != null)
                .map(({id, pp, maxpp}) => ({id, pp, maxpp}));
        if (moves.length <= 0) return null;
        return {type: "updateMoves", monRef: "us", moves};
    }

    /** Initializes the battle conditions. */
    public initBattle(args: psmsg.BattleInit): events.Any[]
    {
        this._battling = true;

        let sizeEvent: events.InitOtherTeamSize;

        // map player id to which side they represent
        const id = args.id;
        if (args.username === this.username)
        {
            this.sides = {[id]: "us", [otherPlayerID(id)]: "them"} as any;
            // we already know our team's size from the initial request
            //  message but not the other team
            sizeEvent =
            {
                type: "initOtherTeamSize",
                size: args.teamSizes[otherPlayerID(id)]
            };
        }
        else
        {
            this.sides = {[id]: "them", [otherPlayerID(id)]: "us"} as any;
            sizeEvent = {type: "initOtherTeamSize", size: args.teamSizes[id]};
        }

        const result = this.handleEvents(args.events);
        // put the team size initializer at the beginning
        result.unshift(sizeEvent);
        return result;
    }

    /**
     * Translates PS server BattleEvents into BattleEvents to update the battle
     * state.
     */
    public handleEvents(psEvents: readonly psevent.Any[]): events.Any[]
    {
        const result: events.Any[] = [];

        if (psEvents.length === 1 && psEvents[0].type === "-activate" &&
            psEvents[0].volatile === "move: Struggle")
        {
            return [];
        }

        // starting a new turn
        if (this.newTurn) result.push({type: "preTurn"});

        // this field should stay true if one of these events contains a Turn
        //  event
        this.newTurn = false;

        // handle events
        for (let i = 0; i < psEvents.length; ++i)
        {
            const psEvent = psEvents[i];
            const last = psEvents[i - 1];
            const battleEvents = this.handleEvent(psEvent, last);
            result.push(...battleEvents);
        }

        // TODO: factor out into a separate method to allow multiple
        //  handleEvents() calls but only one Trace check
        // if an activateAbility is found, but an activateAbility with Trace is
        //  found after, move the Trace events so they happen before the ability
        //  (while making sure the abilities/monRefs match)
        // this is due to a weird behavior in PS with gen4 battles, not sure if
        //  it's also the case on cartridge
        const abilityEvents: {i: number, event: events.ActivateAbility}[] = [];
        for (let i = 0; i < result.length; ++i)
        {
            const event = result[i];

            if (event.type !== "activateAbility") continue;
            if (event.ability !== "trace")
            {
                // track the ability events that happen before the next trace
                abilityEvents.push({i, event});
                continue;
            }
            // see if trace was activated and caused an ability event
            //  that copies the opponent's ability (while also revealing it)
            // trace handling should emit
            const nextEvent = result[i + 1];
            if (!nextEvent || nextEvent.type !== "activateAbility" ||
                nextEvent.monRef !== event.monRef)
            {
                continue;
            }
            const nextEvent2 = result[i + 2];
            if (!nextEvent2 || nextEvent2.type !== "activateAbility" ||
                nextEvent2.monRef === event.monRef ||
                nextEvent2.ability !== nextEvent.ability)
            {
                continue;
            }

            const tracedAbility = nextEvent.ability;
            // search past ability events for a match for the traced
            //  mon
            for (let j = 0; j < abilityEvents.length; ++j)
            {
                const data = abilityEvents[j];
                const abilityEvent = abilityEvents[j].event;
                if (abilityEvent.monRef !== event.monRef ||
                    abilityEvent.ability !== tracedAbility)
                {
                    continue;
                }

                // move the ability event + nextEvent/nextEvent2
                result.splice(data.i, 0, ...result.splice(i, 3));
                // move i to the end of this section of events
                // the 2 here accounts for nextEvent/nextEvent2
                i += 2;

                // all the other ability events that happened
                //  before are guaranteed to not be related to
                //  Trace
                abilityEvents.splice(0, j + 1);
                break;
            }
        }

        // ending the current turn
        if (this.newTurn) result.push({type: "postTurn"});

        return result;
    }

    /**
     * Translates a PS server BattleEvent into BattleEvents to update the battle
     * state. This method also handles suffixes.
     * @param event Event to translate.
     * @param it Points to the next BattleEvent.
     * @returns The translated BattleEvent and the remaining input Iter.
     */
    private handleEvent(event: psevent.Any, last?: psevent.Any): events.Any[]
    {
        const suffixEvents = this.handleSuffixes(event);
        const battleEvents = this.delegateEvent(event, last);

        return [...suffixEvents, ...battleEvents];
    }

    /** Translates a BattleEvent without parsing suffixes. */
    private delegateEvent(event: psevent.Any, last?: psevent.Any): events.Any[]
    {
        switch (event.type)
        {
            // major events
            case "cant": return this.handleCant(event);
            case "move": return this.handleMove(event);
            // while drag is a minor event's handled the same as switch
            case "drag": case "switch": return this.handleSwitch(event);

            // minor events
            case "-ability": return this.handleAbility(event);
            case "-endability": return this.handleEndAbility(event);
            case "-start": return this.handleStart(event);
            case "-activate": return this.handleActivate(event, last);
            case "-end": return this.handleEnd(event);
            case "-boost": return this.handleBoost(event);
            case "-clearallboost": return this.handleClearAllBoost(event);
            case "-clearnegativeboost":
                return this.handleClearNegativeBoost(event);
            case "-clearpositiveboost":
                return this.handleClearPositiveBoost(event);
            case "-copyboost": return this.handleCopyBoost(event);
            case "-crit": return this.handleCrit(event);
            case "-curestatus": return this.handleCureStatus(event);
            case "-cureteam": return this.handleCureTeam(event);
            case "-damage": case "-heal": case "-sethp":
                return this.handleDamage(event);
            case "detailschange": return this.handleDetailsChange(event);
            case "-fail": return this.handleFail(event);
            case "faint": return this.handleFaint(event);
            case "-fieldend": case "-fieldstart":
                return this.handleFieldEffect(event);
            case "-formechange": return this.handleFormeChange(event);
            case "-hitcount": return this.handleHitCount(event);
            case "-immune": return this.handleImmune(event);
            case "-invertboost": return this.handleInvertBoost(event);
            case "-item": return this.handleItem(event);
            case "-enditem": return this.handleEndItem(event);
            case "-message": return this.handleMessage(event);
            case "-miss": return this.handleMiss(event);
            case "-mustrecharge": return this.handleMustRecharge(event);
            case "-notarget": return this.handleNoTarget(event);
            case "-prepare": return this.handlePrepare(event);
            case "-resisted": return this.handleResisted(event);
            case "-setboost": return this.handleSetBoost(event);
            case "-sideend": case "-sidestart":
                return this.handleSideCondition(event);
            case "-singlemove": return this.handleSingleMove(event);
            case "-singleturn": return this.handleSingleTurn(event);
            case "-status": return this.handleStatus(event);
            case "-supereffective": return this.handleSuperEffective(event);
            case "-swapboost": return this.handleSwapBoost(event);
            case "tie": case "win": return this.handleGameOver(event);
            case "-transform": return this.handleTransform(event);
            case "turn": return this.handleTurn(event);
            case "-unboost": return this.handleUnboost(event);
            case "-weather": return this.handleWeather(event);
            default: return [];
        }
    }

    /** @virtual */
    protected handleCant(event: psevent.Cant): events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        let move: string | undefined;

        // already indicated by other events
        if (event.reason === "Focus Punch") return [];

        if (event.moveName)
        {
            // prevented from using a move, which might not have been revealed
            //  before
            move = toIdName(event.moveName);
        }

        if (event.reason === "imprison" || event.reason === "recharge" ||
            event.reason === "slp")
        {
            return [{
                type: "inactive", monRef, reason: event.reason,
                ...(move && {move})
            }];
        }
        if (event.reason.startsWith("ability: "))
        {
            // can't move due to an ability
            const ability = toIdName(
                event.reason.substr("ability: ".length));
            if (ability === "damp" && event.of)
            {
                // opponent's ability prevents a move from being used
                // TODO: could the ability=damp condition be removed?
                // in these cases, a useMove event is shown prior, so a fail
                //  event would be more appropriate
                return [
                    {
                        type: "activateAbility",
                        monRef: this.getSide(event.of.owner), ability
                    },
                    {type: "fail"}
                ];
            }
            return [
                {
                    type: "inactive", monRef,
                    // add in truant reason if applicable
                    ...(ability === "truant" && {reason: "truant"}),
                    ...(move && {move})
                },
                // TODO: switch these two events since the ability caused this
                {type: "activateAbility", monRef, ability}
            ];
        }
        return [{type: "inactive", monRef, ...(move && {move})}];
    }

    /** @virtual */
    protected handleMove(event: psevent.Move): events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        const move = toIdName(event.moveName);

        const prefix: events.Any[] = [];
        if (event.from === "Magic Coat")
        {
            // move is being reflected
            prefix.push({type: "block", monRef, effect: "magicCoat"});
        }

        // indicate that the pokemon has used this move
        return [...prefix, {type: "useMove", monRef, move}];
    }

    /** @virtual */
    protected handleSwitch(event: psevent.Drag | psevent.Switch): events.Any[]
    {
        return [
            (({id, species, level, gender, hp, hpMax}) =>
            ({
                type: "switchIn", monRef: this.getSide(id.owner),
                species: toIdName(species), level, gender, hp, hpMax
            } as const))(event)
        ];
    }

    /** @virtual */
    protected handleAbility(event: psevent.Ability): events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        const ability = toIdName(event.ability);

        const abilityEvent: events.ActivateAbility =
            {type: "activateAbility", monRef, ability};

        return event.from === "ability: Trace" && event.of ?
            [
                // |-ability|<holder>|<target's ability>|[from] ability: Trace|
                //  [of] target
                // initial trace activation should be handled by suffix handler
                // TODO: set/reveal ability, not activate
                abilityEvent,
                {
                    // TODO: reveal ability, not activate
                    type: "activateAbility",
                    monRef: this.getSide(event.of.owner), ability
                }
                // after these events we should get the traced ability's
                //  activation if possible
            ]
            : [abilityEvent];
    }

    /** @virtual */
    protected handleEndAbility(event: psevent.EndAbility): events.Any[]
    {
        // transform event was already taken care of, no need to handle
        //  this message
        // TODO: could this still be used to infer base ability?
        // typically this is never revealed this way in actual cartridge
        //  play, so best to leave it for now to preserve fairness
        if (event.from === "move: Transform") return [];

        // NOTE: may be replaced with "|-start|<PokemonID>|Gastro Acid" later

        const monRef = this.getSide(event.id.owner);
        const ability = toIdName(event.ability);
        return [
            // TODO: does cartridge also reveal ability?
            // when can this status be overwritten by an ability change?
            {type: "activateAbility", monRef, ability},
            {
                type: "activateStatusEffect", monRef, effect: "suppressAbility",
                start: true
            }
        ];
    }

    /** @virtual */
    protected handleStart(event: psevent.Start): events.Any[]
    {
        if (event.volatile === "ability: Flash Fire")
        {
            const monRef = this.getSide(event.id.owner);
            return [
                {type: "activateAbility", monRef, ability: "flashfire"},
                {
                    type: "activateStatusEffect", monRef, effect: "flashFire",
                    start: true
                }
            ];
        }
        if (event.volatile === "typeadd")
        {
            // set added type
            const monRef = this.getSide(event.id.owner);
            const thirdType = event.otherArgs[0].toLowerCase() as dexutil.Type;
            return [{type: "setThirdType", monRef, thirdType}];
        }
        if (event.volatile === "typechange")
        {
            // set types
            // format: Type1/Type2
            let newTypes: [dexutil.Type, dexutil.Type];

            if (event.otherArgs[0])
            {
                const parsedTypes = event.otherArgs[0].split("/")
                    .map(type => type.toLowerCase()) as dexutil.Type[];

                // make sure length is 2
                if (parsedTypes.length > 2)
                {
                    // TODO: throw
                    this.logger.error("Too many types given " +
                        `(${parsedTypes.join(", ")})`);
                    parsedTypes.splice(2);
                }
                else if (parsedTypes.length === 1) parsedTypes.push("???");
                newTypes = parsedTypes as [dexutil.Type, dexutil.Type];
            }
            else newTypes = ["???", "???"];

            const monRef = this.getSide(event.id.owner);
            return [{type: "changeType", monRef, newTypes}];
        }
        if (event.volatile.startsWith("perish") ||
            event.volatile.startsWith("stockpile"))
        {
            // update countable status effects
            const monRef = this.getSide(event.id.owner);
            const effect =
                event.volatile.startsWith("perish") ? "perish" : "stockpile";
            const amount = parseInt(event.volatile.substr(effect.length), 10);
            return [{type: "countStatusEffect", monRef, effect, amount}];
        }
        // trivial, handle using factored-out method
        return this.handleTrivialStatus(event);
    }

    /** @virtual */
    protected handleActivate(event: psevent.Activate, last?: psevent.Any):
        events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        const volatile = event.volatile.startsWith("move: ") ?
            event.volatile.substr("move: ".length) : event.volatile;
        switch (volatile)
        {
            case "ability: Forewarn":
                return [
                    {type: "activateAbility", monRef, ability: "forewarn"},
                    {
                        type: "revealMove",
                        monRef: event.of ?
                            this.getSide(event.of.owner) : otherSide(monRef),
                        move: toIdName(event.otherArgs[0])
                    }
                ]
            case "Bide":
                return [{type: "updateStatusEffect", monRef, effect: "bide"}];
            case "Charge":
                return [{
                    type: "activateStatusEffect", monRef, effect: "charge",
                    start: true
                }];
            case "confusion":
                return [{type: "updateStatusEffect", monRef, effect: volatile}];
            case "Endure": case "Mist": case "Protect": case "Safeguard":
            case "Substitute":
                return [{
                    type: "block", monRef,
                    effect: volatile.toLowerCase() as events.BlockEffect
                }];
            case "Feint":
                return [{type: "feint", monRef}];
            case "Grudge":
                return [{
                    type: "modifyPP", monRef,
                    move: toIdName(event.otherArgs[0]), amount: "deplete"
                }];
            case "item: Leppa Berry":
                return [{
                    type: "modifyPP", monRef,
                    move: toIdName(event.otherArgs[0]), amount: 10
                }]
            case "Lock-On": case "Mind Reader":
                return [{
                    type: "lockOn", monRef,
                    target: event.of ?
                        this.getSide(event.of.owner) : otherSide(monRef)
                }];
            case "Mimic":
            {
                const move = toIdName(event.otherArgs[0]);

                // use the last (move) event to see whether this is actually
                //  Sketch or Mimic
                if (last?.type !== "move" ||
                    JSON.stringify(last.id) !== JSON.stringify(event.id))
                {
                    throw new Error("Don't know how Mimic was caused");
                }

                if (last.moveName === "Mimic")
                {
                    return [{type: "mimic", monRef, move}];
                }
                if (last.moveName === "Sketch")
                {
                    return [{type: "sketch", monRef, move}];
                }
                throw new Error(
                    `Unknown Mimic-like move '${last.moveName}'`);
            }
            case "Spite":
                return [{
                    type: "modifyPP", monRef,
                    move: toIdName(event.otherArgs[0]),
                    amount: -parseInt(event.otherArgs[1], 10)
                }];
            case "Substitute":
                return [{type: "block", monRef, effect: "substitute"}];
            case "trapped":
                return [{type: "trap", target: monRef, by: otherSide(monRef)}];
            default:
                this.logger.debug(`Ignoring activate '${event.volatile}'`);
                return [];
        }
    }

    /** @virtual */
    protected handleEnd(event: psevent.End): events.Any[]
    {
        if (event.volatile === "Stockpile")
        {
            // end stockpile stacks
            return [{
                type: "countStatusEffect", monRef: this.getSide(event.id.owner),
                effect: "stockpile", amount: 0
            }];
        }
        return this.handleTrivialStatus(event);
    }

    /** @virtual */
    protected handleBoost(event: psevent.Boost): events.Any[]
    {
        return [{
            type: "boost", monRef: this.getSide(event.id.owner),
            stat: event.stat, amount: event.amount
        }];
    }

    /** @virtual */
    protected handleClearAllBoost(event: psevent.ClearAllBoost): events.Any[]
    {
        return [{type: "clearAllBoosts"}];
    }

    /** @virtual */
    protected handleClearNegativeBoost(event: psevent.ClearNegativeBoost):
        events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        return [{type: "clearNegativeBoosts", monRef}];
    }

    /** @virtual */
    protected handleClearPositiveBoost(event: psevent.ClearPositiveBoost):
        events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        return [{type: "clearPositiveBoosts", monRef}];
    }

    /** @virtual */
    protected handleCopyBoost(event: psevent.CopyBoost): events.Any[]
    {
        const from = this.getSide(event.target.owner);
        const to = this.getSide(event.source.owner);
        return [{type: "copyBoosts", from, to}];
    }

    /** @virtual */
    protected handleCrit(event: psevent.Crit): events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        return [{type: "crit", monRef}];
    }

    /** @virtual */
    protected handleCureStatus(event: psevent.CureStatus): events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        return [{
            type: "activateStatusEffect", monRef, effect: event.majorStatus,
            start: false
        }];
    }

    /** @virtual */
    protected handleCureTeam(event: psevent.CureTeam): events.Any[]
    {
        return [{type: "cureTeam", teamRef: this.getSide(event.id.owner)}];
    }

    /**
     * Handles a damage/heal/sethp event.
     * @virtual
     */
    protected handleDamage(
        event: psevent.Damage | psevent.Heal | psevent.SetHP): events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        const hp = event.status.hp;
        const damageEvent: events.TakeDamage = {type: "takeDamage", monRef, hp};

        switch (event.from)
        {
            case "drain": return [{...damageEvent, from: "drain"}];
            case "Recoil": return [{...damageEvent, from: "recoil"}];
            // TODO: also handle wish
            case "move: Healing Wish":
                return [
                    {
                        type: "activateTeamEffect", teamRef: monRef,
                        effect: "healingWish", start: false
                    },
                    damageEvent
                ];
            case "move: Lunar Dance":
                return [
                    {
                        type: "activateTeamEffect", teamRef: monRef,
                        effect: "lunarDance", start: false
                    },
                    damageEvent, {type: "restoreMoves", monRef}
                ];
            default: return [damageEvent];
        }
    }

    /** @virtual */
    protected handleDetailsChange(event: psevent.DetailsChange): events.Any[]
    {
        return [
            (({id, species, level, gender, hp, hpMax}) =>
            ({
                type: "formChange", monRef: this.getSide(id.owner), species,
                level, gender, hp, hpMax, perm: true
            } as const))(event)
        ];
    }

    /** @virtual */
    protected handleFail(event: psevent.Fail): events.Any[]
    {
        return [{type: "fail"}];
    }

    /** @virtual */
    protected handleFaint(event: psevent.Faint): events.Any[]
    {
        return [{type: "faint", monRef: this.getSide(event.id.owner)}];
    }

    /**
     * Handles a field end/start event.
     * @virtual
     */
    protected handleFieldEffect(event: psevent.FieldEnd | psevent.FieldStart):
        events.Any[]
    {
        switch (event.effect)
        {
            case "move: Gravity":
                return [{
                    type: "activateFieldEffect", effect: "gravity",
                    start: event.type === "-fieldstart"
                }];
            case "move: Trick Room":
                return [{
                    type: "activateFieldEffect", effect: "trickRoom",
                    start: event.type === "-fieldstart"
                }];
            default: return [];
        }
    }

    /** @virtual */
    protected handleFormeChange(event: psevent.FormeChange): events.Any[]
    {
        return [
            (({id, species, level, gender, hp, hpMax}) =>
            ({
                type: "formChange", monRef: this.getSide(id.owner), species,
                level, gender, hp, hpMax, perm: false
            } as const))(event)
        ];
    }

    /** @virtual */
    protected handleHitCount(event: psevent.HitCount): events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        return [{type: "hitCount", monRef, count: event.count}];
    }

    /** @virtual */
    protected handleImmune(event: psevent.Immune): events.Any[]
    {
        return [{type: "immune", monRef: this.getSide(event.id.owner)}];
    }

    /** @virtual */
    protected handleInvertBoost(event: psevent.InvertBoost): events.Any[]
    {
        return [{type: "invertBoosts", monRef: this.getSide(event.id.owner)}];
    }

    /** @virtual */
    protected handleItem(event: psevent.Item): events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        const item = toIdName(event.item);

        // item can be gained via a transfer move or recycle
        let gained: boolean | "recycle";
        if (event.from && event.from.startsWith("move: "))
        {
            const move = toIdName(event.from.substr("move: ".length));
            if (move === "recycle") gained = "recycle";
            else gained = dexutil.itemTransferMoves.includes(move);
        }
        else gained = false;

        return [{type: "revealItem", monRef, item, gained}];
    }

    /** @virtual */
    protected handleEndItem(event: psevent.EndItem): events.Any[]
    {
        const monRef = this.getSide(event.id.owner);

        // handle case where an item-removal or steal-eat move was used
        //  against us, which removes but doesn't consume our item
        // TODO: these should also specify the item being removed
        let consumed: boolean | string;
        if (event.from === "stealeat" ||
            (event.from && event.from.startsWith("move: ") &&
                dexutil.itemRemovalMoves.includes(
                    toIdName(event.from.substr("move: ".length)))))
        {
            consumed = false;
        }
        // in most other cases we can assume that the item can be brought
        //  back using Recycle
        else consumed = toIdName(event.item);

        // likely consuming the status, not actual item
        if (event.item === "micleberry" && !event.eat) return [];

        return [{type: "removeItem", monRef, consumed}];
    }

    protected handleMessage(event: psevent.Message): events.Any[]
    {
        if (event.message === "Sleep Clause Mod activated.")
        {
            return [{type: "clause", clause: "slp"}];
        }
        return [];
    }

    /** @virtual */
    protected handleMiss(event: psevent.Miss): events.Any[]
    {
        return [{type: "miss", monRef: this.getSide(event.targetId.owner)}];
    }

    /** @virtual */
    protected handleMustRecharge(event: psevent.MustRecharge): events.Any[]
    {
        return [{type: "mustRecharge", monRef: this.getSide(event.id.owner)}];
    }

    /** @virtual */
    protected handleNoTarget(event: psevent.NoTarget): events.Any[]
    {
        return [{type: "noTarget", monRef: this.getSide(event.id.owner)}];
    }

    /** @virtual */
    protected handlePrepare(event: psevent.Prepare): events.Any[]
    {
        const move = toIdName(event.moveName);
        if (!dex.isTwoTurnMove(move))
        {
            throw new Error(`'${move}' is not a two-turn move`);
        }
        return [{
            type: "prepareMove", monRef: this.getSide(event.id.owner), move
        }];
    }

    /** @virtual */
    protected handleResisted(event: psevent.Resisted): events.Any[]
    {
        return [{type: "resisted", monRef: this.getSide(event.id.owner)}];
    }

    /** @virtual */
    protected handleSetBoost(event: psevent.SetBoost): events.Any[]
    {
        return [
            (({id, stat, amount}) =>
            ({
                type: "boost", monRef: this.getSide(id.owner), stat, amount,
                set: true
            } as const))(event)
        ];
    }

    /**
     * Handles a side end/start event.
     * @virtual
     */
    protected handleSideCondition(event: psevent.SideEnd | psevent.SideStart):
        events.Any[]
    {
        const teamRef = this.getSide(event.id);
        let effect: dexutil.TeamEffectType;

        let psCondition = event.condition;
        if (psCondition.startsWith("move: "))
        {
            psCondition = psCondition.substr("move: ".length);
        }
        switch (psCondition)
        {
            case "Light Screen":
            case "Reflect":
                effect = psCondition === "Reflect" ?
                        "reflect" : "lightScreen";
                break;
            case "Lucky Chant": effect = "luckyChant"; break;
            case "Mist": effect = "mist"; break;
            case "Safeguard": effect = "safeguard"; break;
            case "Spikes": effect = "spikes"; break;
            case "Stealth Rock": effect = "stealthRock"; break;
            case "Tailwind": effect = "tailwind"; break;
            case "Toxic Spikes": effect = "toxicSpikes"; break;
            default: return [];
        }

        return [{
            type: "activateTeamEffect", teamRef, effect,
            start: event.type === "-sidestart"
        }];
    }

    /** @virtual */
    protected handleSingleMove(event: psevent.SingleMove): events.Any[]
    {
        let effect: dexutil.SingleMoveType | undefined;
        if (event.move === "Destiny Bond") effect = "destinyBond";
        else if (event.move === "Grudge") effect = "grudge";
        else if (event.move === "Rage") effect = "rage";
        else return [];

        const monRef = this.getSide(event.id.owner);
        return [{type: "activateStatusEffect", monRef, effect, start: true}];
    }

    /** @virtual */
    protected handleSingleTurn(event: psevent.SingleTurn): events.Any[]
    {
        let effect: dexutil.SingleTurnType;
        switch (event.status.startsWith("move: ") ?
            event.status.substr("move: ".length) : event.status)
        {
            case "Endure": effect = "endure"; break;
            case "Focus Punch": effect = "focus"; break;
            case "Magic Coat": effect = "magicCoat"; break;
            case "Protect": effect = "protect"; break;
            case "Roost": effect = "roost"; break;
            case "Snatch": effect = "snatch"; break;
            default: return [];
        }

        const monRef = this.getSide(event.id.owner);
        return [{type: "activateStatusEffect", monRef, effect, start: true}];
    }

    /** @virtual */
    protected handleStatus(event: psevent.Status): events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        return [{
            type: "activateStatusEffect", monRef, effect: event.majorStatus,
            start: true
        }];
    }

    /** @virtual */
    protected handleSuperEffective(event: psevent.SuperEffective): events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        return [{type: "superEffective", monRef}];
    }

    /** @virtual */
    protected handleSwapBoost(event: psevent.SwapBoost): events.Any[]
    {
        const monRef1 = this.getSide(event.source.owner);
        const monRef2 = this.getSide(event.target.owner);
        return [{type: "swapBoosts", monRef1, monRef2, stats: event.stats}];
    }

    /** @virtual */
    protected handleGameOver(event: psevent.Tie | psevent.Win): events.Any[]
    {
        this._battling = false;

        let winner: Side | undefined;
        if (event.type === "win")
        {
            winner = event.winner === this.username ? "us" : "them";
        }

        return [{type: "halt", reason: "gameOver", ...(winner && {winner})}];
    }

    /** @virtual */
    protected handleTransform(event: psevent.Transform):
        events.Any[]
    {
        const source = this.getSide(event.source.owner);
        const target = this.getSide(event.target.owner);
        return [{type: "transform", source, target}];
    }

    /** @virtual */
    protected handleTurn(event: psevent.Turn): events.Any[]
    {
        this.newTurn = true;
        return [];
    }

    /** @virtual */
    protected handleUnboost(event: psevent.Unboost): events.Any[]
    {
        return [{
            type: "boost", monRef: this.getSide(event.id.owner),
            stat: event.stat, amount: -event.amount
        }];
    }

    /** @virtual */
    protected handleWeather(event: psevent.Weather): events.Any[]
    {
        let result: events.Any[];

        if (event.weatherType === "none") result = [{type: "resetWeather"}];
        else if (event.upkeep)
        {
            result = [{type: "updateFieldEffect", effect: event.weatherType}];
        }
        else
        {
            result =
            [{
                type: "activateFieldEffect", effect: event.weatherType,
                start: true
            }];
        }

        return result;
    }

    /** Handles the `[of]` and `[from]` suffixes of an event. */
    private handleSuffixes(event: psevent.Any): [] | [events.Any]
    {
        // can't do anything without a [from] suffix
        const f = event.from;
        if (!f) return [];

        // this corner case should already be handled
        if (event.from === "lockedmove") return [];

        // look for a PokemonID using the `of` or `id` fields
        // this will be used for handling the `from` field
        let eventId: PokemonID | undefined;
        let ofId: PokemonID | undefined;
        if ((event as any).id && isPlayerID((event as any).id.owner))
        {
            eventId = (event as any).id;
        }
        if (event.of) ofId = event.of;

        if (!eventId && !ofId)
        {
            throw new Error("No PokemonID given to handle suffixes with");
        }

        // TODO: should all use cases be handled in separate event handlers?
        // if so, this method might not need to exist
        if (f.startsWith("ability: "))
        {
            const ability = toIdName(f.substr("ability: ".length));

            let monRef: Side;
            // prefer id from event
            // NOTE: non-healing absorb abilities (e.g. motordrive) don't do
            //  this
            // |-heal|<holder>|...|[from] <ability>|[of] <attacker>
            if ((event.type === "-heal" &&
                    (dex.abilities[ability]?.on?.block?.move?.percentDamage
                        ?? 0) > 0) ||
                // |-ability|<holder>|<target's ability>|[from] ability: Trace|
                //  [of] target
                (event.type === "-ability" && ability === "trace"))
            {
                monRef = this.getSide(event.id.owner);
            }
            // prefer id from [of] suffix
            else monRef = this.getSide((ofId ?? eventId!).owner);

            return [{type: "activateAbility", monRef, ability}];
        }
        if (f.startsWith("item: "))
        {
            // prefer id from [of] suffix (TODO: when to switch this?)
            const monRef = this.getSide((ofId ?? eventId!).owner);
            const item = toIdName(f.substr("item: ".length));
            // removeItem events are usually emitted when a berry's effects are
            //  used, so this helps us to not conflict with that
            if (dex.berries.hasOwnProperty(item)) return [];
            return [{type: "activateItem", monRef, item}];
        }
        // nothing relevant to emit
        return [];
    }

    /** Handles the shared statuses in end/start events. */
    private handleTrivialStatus(event: psevent.End | psevent.Start):
        events.Any[]
    {
        const monRef = this.getSide(event.id.owner);
        const start = event.type === "-start";

        let effect: dexutil.StatusType | undefined;

        let ev = event.volatile;
        if (ev.startsWith("move: ")) ev = ev.substr("move: ".length);

        let battleEvents: events.Any[] | undefined;
        switch (ev)
        {
            case "Aqua Ring": effect = "aquaRing"; break;
            case "Attract": effect = "attract"; break;
            case "Bide": effect = "bide"; break;
            case "confusion":
                battleEvents =
                [{
                    type: "activateStatusEffect", monRef, effect: "confusion",
                    start
                }];
                if (event.fatigue)
                {
                    battleEvents.unshift({type: "fatigue", monRef});
                }
                break;
            case "Curse": effect = "curse"; break;
            case "Disable":
                if (event.type === "-start")
                {
                    // disable the given move
                    battleEvents =
                    [{
                        type: "disableMove", monRef,
                        move: toIdName(event.otherArgs[0])
                    }];
                }
                // re-enable disabled moves
                else battleEvents = [{type: "reenableMoves", monRef}];
                break;
            case "Embargo": effect = "embargo"; break;
            case "Encore": effect = "encore"; break;
            case "Focus Energy": effect = "focusEnergy"; break;
            case "Foresight": effect = "foresight"; break;
            case "Heal Block": effect = "healBlock"; break;
            case "Imprison": effect = "imprison"; break;
            case "Ingrain": effect = "ingrain"; break;
            case "Leech Seed": effect = "leechSeed"; break;
            case "Magnet Rise": effect = "magnetRise"; break;
            case "Miracle Eye": effect = "miracleEye"; break;
            case "Mud Sport": effect = "mudSport"; break;
            case "Nightmare": effect = "nightmare"; break;
            case "Power Trick": effect = "powerTrick"; break;
            case "Slow Start": effect = "slowStart"; break;
            case "Substitute":
                battleEvents =
                [{
                    type: "activateStatusEffect", monRef, effect: "substitute",
                    start
                }];
                if (!start)
                {
                    battleEvents.unshift(
                        {type: "block", monRef, effect: "substitute"});
                }
                break;
            case "Taunt": effect = "taunt"; break;
            case "Torment": effect = "torment"; break;
            case "Uproar":
                if (event.type === "-start" &&
                    event.otherArgs[0] === "[upkeep]")
                {
                    battleEvents =
                    [{
                        type: "updateStatusEffect", monRef, effect: "uproar"
                    }];
                }
                else effect = "uproar";
                break;
            case "Water Sport": effect = "waterSport"; break;
            case "Yawn": effect = "yawn"; break;
            default:
            {
                const move = toIdName(ev);
                // istanbul ignore else: not useful to test
                if (dex.isFutureMove(move))
                {
                    battleEvents = [{type: "futureMove", monRef, move, start}];
                }
                else
                {
                    this.logger.debug(
                        `Ignoring trivial status '${event.volatile}'`);
                }
            }
        }

        if (!battleEvents)
        {
            if (!effect) battleEvents = [];
            else
            {
                battleEvents =
                    [{type: "activateStatusEffect", monRef, effect, start}];
            }
        }
        return battleEvents;
    }

    // istanbul ignore next: trivial
    /**
     * Gets a Side name.
     * @param id Corresponding PlayerID.
     */
    protected getSide(id: PlayerID): Side
    {
        if (!this.sides) throw new Error("Sides not initialized");
        return this.sides[id];
    }
}
