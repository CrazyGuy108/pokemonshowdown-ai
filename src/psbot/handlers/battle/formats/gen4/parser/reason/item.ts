/** @file SubReason helpers related to abilities. */
import { inference } from "../../../../parser";
import { Pokemon } from "../../state/Pokemon";
import { PossibilityClass } from "../../state/PossibilityClass";

/** Creates a SubReason that asserts that the pokemon has the given item. */
export function hasItem(mon: Pokemon, items: Set<string>): inference.SubReason
{
    return new HasItem(mon, items, /*negative*/ false);
}

/**
 * Creates a SubReason that asserts that the pokemon doesn't have the given
 * item.
 */
export function doesntHaveItem(mon: Pokemon, items: Set<string>):
    inference.SubReason
{
    return new HasItem(mon, items, /*negative*/ true);
}

/** Creates a SubReason that asserts that the pokemon has an item. */
export function hasAnItem(mon: Pokemon): inference.SubReason
{
    return doesntHaveItem(mon, new Set(["none"]));
}

class HasItem extends inference.SubReason
{
    /** Item snapshot for making inferences in retrospect. */
    private readonly item: PossibilityClass<string>;

    constructor(mon: Pokemon, private readonly items: Set<string>,
        private readonly negative: boolean)
    {
        super();
        this.item = mon.item;
    }

    /** @override */
    public canHold(): boolean | null
    {
        return subsetOrIndependent(this.items, this.item.possibleValues,
            this.negative);
    }

    /** @override */
    public assert(): void
    {
        if (this.negative) this.rejectImpl();
        else this.acceptImpl();
    }

    /** @override */
    public reject(): void
    {
        if (this.negative) this.acceptImpl();
        else this.rejectImpl();
    }

    private acceptImpl(): void
    {
        // TODO: guard against overnarrowing?
        // may need a better framework for error handling/logging
        this.item.narrow(this.items);
    }

    private rejectImpl(): void
    {
        this.item.remove(this.items);
    }

    /** @override */
    protected delayImpl(cb: inference.DelayCallback): inference.CancelCallback
    {
        return this.item.onUpdate(this.items,
            this.negative ? kept => cb(!kept) : cb);
    }
}
