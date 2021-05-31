/** Readonly PossibilityClass representation. */
export interface ReadonlyPossibilityClass<TKey extends string, TData = any>
{
    /** Maps key name to data value. */
    readonly map: {readonly [K in TKey]: TData};
    /** The set of possible values this object can be. */
    readonly possibleValues: Iterable<TKey>;
    /** Number of possible values. */
    readonly size: number;
    /** Gets the class name if narrowed down sufficiently, otherwise null. */
    readonly definiteValue: TKey | null;

    /**
     * Adds a listener for when this object gets fully narrowed. The provided
     * function can be immediately called if this PossibilityClass is already
     * narrowed. These callbacks are guaranteed to be called after `onUpdate()`
     * callbacks, and are called in FIFO order.
     * @returns `this` for chaining.
     */
    onNarrow(cb: (key: TKey, data: TData) => void): this;

    /**
     * Adds a listener for when either this object narrows down to a subset of
     * the provided keys, or it rules them out.
     * @param keys Keys to track. Will be owned by this object after calling.
     * @param cb Callback to execute when narrowed (kept=true) or fully ruled
     * out (kept=false). Called in FIFO order for multiple callbacks.
     * @returns A callback to cancel the newly-registered callback.
     */
    onUpdate(keys: Set<string>, cb: (kept: boolean) => void): () => void;
    /**
     * Adds a listener for when either this object narrows down to a subset of
     * the keys defined by the predicate, or it rules them out.
     * @param pred Filter predicate for subset.
     * @param cb Callback to execute when narrowed (kept=true) or fully ruled
     * out (kept=false). Called in FIFO order for multiple callbacks.
     * @returns A callback to cancel the newly-registered callback.
     */
    // tslint:disable-next-line: unified-signatures
    onUpdate(pred: (key: TKey, data: TData) => boolean,
        cb: (kept: boolean) => void): () => void;

    /** Checks if a value is in the data possibility. */
    isSet(name: TKey): boolean;
}

/** Represents a subset callback. */
interface Subset<TKey extends string>
{
    /** Subset of possible values. */
    readonly set: Set<TKey>
    /**
     * Callback for when the subset is empty (kept=false) or is equal to the
     * main possible values set (kept=true).
     */
    update(kept: boolean): void;
    /** Whether to cancel the update callback. */
    cancel?: true;
}

/** Doubly linked list helper type for constant-time insertion/deletion. */
class LinkedList<T = any>
{
    /** Beginning of the list. */
    public head: LinkedListNode<T> | null = null;
    /** End of the list. */
    public tail: LinkedListNode<T> | null = null;

    public* [Symbol.iterator](): IterableIterator<T>
    {
        for (const node of this.nodes()) yield node.value;
    }

    /**
     * Node iterator allowing only for the removal of the current node or
     * anything before/after it (but never both).
     */
    public* nodes(): IterableIterator<LinkedListNode<T>>
    {
        let node = this.head;
        while (node)
        {
            const {next} = node;
            yield node;

            if (!node.next)
            {
                // next node was removed
                if (node === this.tail) break;
                // current node was removed, restore previous node.next
                // note: undefined behavior if both of the above cases are true
                node = next;
            }
            else node = node.next;
        }
    }

    /** Adds a value to the end of the list. */
    public push(value: T): void
    {
        const newNode: LinkedListNode<T> = {value, prev: this.tail, next: null};
        if (!this.tail) this.tail = newNode;
        else this.tail = (this.tail.next = newNode);

        if (!this.head) this.head = this.tail;
    }

    /** Removes the node from the list and returns its value. */
    public remove(node: LinkedListNode<T>): T
    {
        if (!node.prev)
        {
            // update head ptr
            if (this.head === node) this.head = node.next;
        }
        else node.prev.next = node.next;

        if (!node.next)
        {
            // update tail ptr
            if (this.tail === node) this.tail = node.prev;
        }
        else node.next.prev = node.prev;

        // delete node
        node.prev = null;
        node.next = null;
        return node.value;
    }

    /** Clears all the nodes from the list. */
    public clear(): void
    {
        for (const node of this.nodes())
        {
            node.prev = null;
            node.next = null;
        }
        this.head = null;
        this.tail = null;
    }
}

/** Linked list node. */
interface LinkedListNode<T = any>
{
    /** Contained value. */
    value: T;
    /** Previous node. */
    prev: LinkedListNode<T> | null;
    /** Next node. */
    next: LinkedListNode<T> | null;
}

/**
 * Represents a set of possible values. This can be used in place of the actual
 * value when the actual value can be one of many possible values.
 */
// tslint:disable-next-line: max-classes-per-file
export class PossibilityClass<TKey extends string, TData = any> implements
    ReadonlyPossibilityClass<TKey, TData>
{
    /** @override */
    public readonly map: {readonly [T in TKey]: TData};

    // TODO: add probability weights
    /** @override */
    public get possibleValues(): Iterable<TKey> { return this._possibleValues; }
    /** Keeps track of all the possible values. */
    private readonly _possibleValues: Set<TKey>;

    /** @override */
    public get size(): number { return this._possibleValues.size; }

    /**
     * Gets the class name and data if narrowed down sufficiently, otherwise
     * null.
     */
    public get definiteValue(): TKey | null { return this._definiteValue; }
    private _definiteValue: TKey | null = null;

    /** `#onNarrow()` listeners. */
    private readonly listeners: ((key: TKey, data: TData) => void)[] = [];

    /** Keeps track of subset callbacks. */
    private readonly subsets = new LinkedList<Subset<TKey>>();

    /**
     * Creates a PossibilityClass.
     * @param map Base dictionary object. Should not change during the lifetime
     * of this object.
     * @param values Optional values to immediately narrow to. Defaults to all
     * possible values given by the `map`.
     */
    constructor(map: {readonly [T in TKey]: TData}, ...values: string[]);
    /**
     * Creates a PossibilityClass.
     * @param map Base dictionary object. Should not change during the lifetime
     * of this object.
     * @param values Optional values to immediately narrow to if not empty.
     * Defaults to all possible values given by the `map`.
     */
    constructor(map: {readonly [T in TKey]: TData},
        values: readonly string[] | ReadonlySet<string>);
    constructor(map: {readonly [T in TKey]: TData},
        arg1?: string | readonly string[] | ReadonlySet<string>,
        ...values: string[])
    {
        this.map = map;

        let set: Set<TKey> | undefined;
        if (typeof arg1 === "string")
        {
            this.check(arg1);
            for (const v of values) this.check(v);
            values.push(arg1);
            set = new Set(values as TKey[]);
        }
        else if (typeof arg1 !== "undefined")
        {
            for (const v of arg1) this.check(v);
            set = new Set(arg1 as readonly TKey[] | ReadonlySet<TKey>);
        }

        if (!set || set.size <= 0) set = new Set(Object.keys(map) as TKey[]);
        this._possibleValues = set;

        this.checkNarrowed();
    }

    /** Checks that a given name is part of this object's map. */
    private check(name: string): asserts name is TKey
    {
        if (!this.map.hasOwnProperty(name))
        {
            throw new Error(`PossibilityClass has no value name '${name}'`);
        }
    }

    /** @override */
    public onNarrow(cb: (key: TKey, data: TData) => void): this
    {
        if (this._definiteValue === null) this.listeners.push(cb);
        else cb(this._definiteValue, this.map[this._definiteValue]);
        return this;
    }

    /** @override */
    public onUpdate(arg0: Set<string> | ((key: TKey, data: TData) => boolean),
        cb: (kept: boolean) => void): () => void
    {
        let keys: Set<TKey>;
        if (typeof arg0 === "function")
        {
            // build keys set based on the predicate
            keys = new Set();
            for (const key of this._possibleValues)
            {
                if (arg0(key, this.map[key])) keys.add(key);
            }
        }
        else
        {
            // remove non-keys from provided subset
            for (const key of arg0)
            {
                if (!this._possibleValues.has(key as any)) arg0.delete(key);
            }
            keys = arg0 as Set<TKey>;
        }

        // subset over-narrowed, not kept
        if (keys.size <= 0) cb(/*kept*/ false);
        // set is actually equal/superset, kept
        else if (keys.size >= this._possibleValues.size) cb(/*kept*/ true);
        // unknown, register subset callback
        else
        {
            const subset: Subset<TKey> =
            {
                set: keys as Set<TKey>,
                update: kept => subset.cancel || cb(kept)
            };
            this.subsets.push(subset);
            return () => subset.cancel = true;
        }
        return () => {};
    }

    /** @override */
    public isSet(name: TKey): boolean
    {
        return this._possibleValues.has(name);
    }

    /** Removes keys that are not in the given array. */
    public narrow(...values: string[]): void;
    /** Removes keys that are not in the given Set/array. */
    public narrow(values: Iterable<string> | ReadonlySet<string>): void;
    /** Removes keys that don't satisfy the given predicate. */
    // tslint:disable-next-line: unified-signatures
    public narrow(pred: (key: TKey, data: TData) => boolean): void;
    public narrow(
        arg0?: string | Iterable<string> | ReadonlySet<string> |
            ((name: TKey, data: TData) => boolean),
        ...values: string[]): void
    {
        if (typeof arg0 === "undefined")
        {
            // over-narrow to 0 keys
            this._possibleValues.clear();
            for (const subset of this.subsets)
            {
                subset.set.clear();
                subset.update(/*kept*/ false);
            }
            this.subsets.clear();
            return this.checkNarrowed();
        }
        if (typeof arg0 === "string")
        {
            // create set from spread array
            values.push(arg0);
            return this.narrow(new Set(values));
        }
        if (arg0 instanceof Set) return this.remove(n => !arg0.has(n));
        if (typeof arg0 !== "function") return this.narrow(new Set(arg0));

        // filter based on predicate
        const pred = arg0 as (key: TKey, data: TData) => boolean;
        return this.remove((key, data) => !pred(key, data));
    }

    /** Removes keys if they are included in the given array. */
    public remove(...values: string[]): void
    /** Removes keys if they are included in the given Set/array. */
    public remove(values: Iterable<string> | ReadonlySet<string>): void
    /** Removes keys if they satisfy the predicate. */
    // tslint:disable-next-line: unified-signatures
    public remove(pred: (key: TKey, data: TData) => boolean): void;
    public remove(
        arg0?: string | Iterable<string> | ReadonlySet<string> |
            ((key: TKey, data: TData) => boolean),
        ...values: string[]): void
    {
        if (typeof arg0 === "undefined") return;
        if (typeof arg0 === "string")
        {
            // remove all keys in the provided spread array
            this.removeKey(arg0 as any);
            for (const key of values) this.removeKey(key as any);
        }
        else if (typeof arg0 !== "function")
        {
            // remove all keys in the provided set/iterable
            for (const key of arg0) this.removeKey(key as any);
        }
        else
        {
            // filter based on predicate
            for (const key of this._possibleValues)
            {
                if (arg0(key, this.map[key])) this.removeKey(key);
            }
        }
        this.checkNarrowed();
    }

    /** Removes a key and updates subset listeners only. */
    private removeKey(key: TKey): void
    {
        if (!this._possibleValues.delete(key)) return;

        // update subset listeners
        for (const node of this.subsets.nodes())
        {
            const subset = node.value;
            if (subset.cancel)
            {
                this.subsets.remove(node);
                continue;
            }
            // see if subset conditions are now satisfied after deleting
            if (subset.set.delete(key) && subset.set.size <= 0)
            {
                subset.update(/*kept*/ false);
                this.subsets.remove(node);
            }
            else if (subset.set.size >= this._possibleValues.size)
            {
                subset.update(/*kept*/ true);
                this.subsets.remove(node);
            }
        }
    }

    /**
     * Handles setting `#definiteValue` and calling on-narrow listeners whenever
     * the base `#possibleValues` set changes.
     */
    private checkNarrowed(): void
    {
        const size = this._possibleValues.size;
        if (size === 1)
        {
            // don't set more than once
            if (this._definiteValue === null)
            {
                this._definiteValue = this._possibleValues.keys().next().value;

                // execute on-narrow callbacks in fifo order
                const data = this.map[this._definiteValue!];
                for (const cb of this.listeners) cb(this._definiteValue!, data);
                this.listeners.length = 0;
            }
        }
        else if (size < 1)
        {
            throw new Error("All possibilities have been ruled out " +
                "(should never happen)");
        }
    }

    // istanbul ignore next: only used for logging
    /**
     * Returns a comma-separated list of each possible value.
     * @override
     */
    public toString(): string
    {
        return [...this._possibleValues].join(", ");
    }
}
