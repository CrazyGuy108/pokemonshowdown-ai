import { ItemData } from "../dex/dex-util";
import { Pokemon } from "./Pokemon";
import { PossibilityClass, ReadonlyPossibilityClass } from "./PossibilityClass";
import { pluralTurns } from "./utility";

/** Readonly ItemTempStatus representation. */
export interface ReadonlyItemTempStatus<TStatusType extends string>
{
    /** Whether a status is active. */
    readonly isActive: boolean;
    /** Current weather type. */
    readonly type: TStatusType | "none";
    /** The weather-causer's item if there is one. */
    readonly source: ReadonlyPossibilityClass<ItemData> | null;
    /**
     * Number of turns this status has been active. This is 0-based, so this
     * will return 0 if the weather was started this turn, and 1 after the end
     * of this turn.
     */
    readonly turns: number;
    /**
     * The amount of `#tick()` calls this status will last. Null means infinite.
     */
    readonly duration: number | null;
    /** Normal (index 0) and extended (index 1) turn durations. */
    readonly durations: readonly [number, number];
    /** Dictionary from which to lookup the extension item for each status. */
    readonly items: {readonly [T in TStatusType]: string};
}

/**
 * TempStatus whose duration can be extended by a held item.
 * @template TStatusType String union of status types that this object can
 * represent. This excludes the `"none"` type, which is automatically added.
 */
export class ItemTempStatus<TStatusType extends string> implements
    ReadonlyItemTempStatus<TStatusType>
{
    // all fields are initialized on #reset() in the constructor

    /** @override */
    public get isActive(): boolean { return this._type !== "none"; }
    /** @override */
    public get type(): TStatusType | "none" { return this._type; }
    private _type!: TStatusType | "none";
    /** @override */
    public get source(): PossibilityClass<ItemData> | null
    {
        return this._source;
    }
    private _source!: PossibilityClass<ItemData> | null;

    /** @override */
    public get turns(): number { return this._turns; }
    private _turns!: number;

    /** @override */
    public get duration(): number | null { return this._duration; }
    private _duration!: number | null;

    /**
     * Creates an ItemTempStatus.
     * @param durations Normal (index 0) and extended (index 1) turn durations.
     * @param items Dictionary from which to lookup the extension item.
     * @param defaultStatus Default status to start if omitted from `#start()`.
     * Default `"none"`. Should be provided if there's only one type of status.
     */
    constructor(public readonly durations: readonly [number, number],
        public readonly items: {readonly [T in TStatusType]: string},
        private readonly defaultStatus: TStatusType | "none" = "none")
    {
        this.reset();
    }

    /** Resets status to `none`. */
    public reset(): void
    {
        this._type = "none";
        this._source = null;
        this._duration = null;
        this._turns = 0;
    }

    /**
     * Starts a status.
     * @param source Pokemon that caused the status to start. The actual
     * `#source` field will be set to the Pokemon's current item
     * PossibilityClass if needed to determine the duration.
     * @param type Type of status. Leave blank to assume the default one. This
     * doesn't apply if this object has only one type of status.
     * @param infinite Whether this status is infinite.
     */
    public start(source: Pokemon | null, type = this.defaultStatus,
        infinite = false): void
    {
        if (type === "none")
        {
            this.reset();
            return;
        }

        this._type = type;
        this._source = null;
        this._turns = 0;

        if (infinite) this._duration = null;
        // initially infer short duration
        else this._duration = this.durations[0];

        // everything's all set, no need to handle source item possibilities
        if (!source || infinite) return;

        // should currently be possible to have extension item
        if (!source.item.isSet(this.items[this._type])) return;

        // duration is certain once the item is known
        if (source.item.definiteValue) this._duration = this.durations[1];
        else
        {
            // start tracking source item
            this._source = source.item;
            // set duration once narrowed by other means or by tick()
            this._source.onNarrow(this.itemNarrowedLambda);
        }
    }

    /**
     * Lambda form of `#itemNarrowed()` so it can be passed directly to
     * `PossibilityClass#onNarrow()` in this object's `#start()` method without
     * creating a new lambda every time.
     */
    private itemNarrowedLambda =
        (item: PossibilityClass<ItemData>) => this.itemNarrowed(item);

    /** Updates duration if extension item is found on the given source item. */
    private itemNarrowed(item: PossibilityClass<ItemData>): void
    {
        // source was reassigned, this callback no longer applies
        if (this._source && this._source !== item) return;
        // can't extend "none"
        if (this._type === "none") return;
        // item wasn't narrowed
        // istanbul ignore next: should never happen
        if (!item.definiteValue)
        {
            throw new Error("Item was assumed to be narrowed");
        }
        // item wasn't narrowed to current status' extension item
        if (item.definiteValue !== this.items[this._type]) return;

        // source has extension item, set to extended duration
        this._duration = this.durations[1];
    }

    /** Indicates that the status lasted another turn. */
    public tick(): void
    {
        // no need to increment turns if it's infinite or none
        if (this._duration === null || this._type === "none") return;

        ++this._turns;

        if (this._turns < this._duration) return;

        // went over duration without reset()-ing, figure out why
        let valid = false;
        if (this._duration === this.durations[0])
        {
            // currently using short duration, so we must have had the
            //  extension item all along
            if (this._source && this._source.isSet(this.items[this._type]))
            {
                this._source.narrow(this.items[this._type]);
                this._duration = this.durations[1];
                valid = true;
            }
            else; // went over short duration without item, should never happen
        }
        else; // went over long duration, should never happen

        if (valid) return;
        throw new Error(`Status '${this._type}' went longer than expected ` +
            `(duration=${this._duration}, turns=${this._turns})`);
    }

    // istanbul ignore next: only used in logging
    /** Encodes status data into a log string. */
    public toString(): string
    {
        if (this._type === "none") return "inactive";
        return pluralTurns(this._type, this._turns, this._duration);
    }
}
