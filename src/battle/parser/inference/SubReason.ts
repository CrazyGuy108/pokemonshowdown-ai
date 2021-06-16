/**
 * Callback type for when the status of a SubReason is known.
 * @param held Whether the SubReason held or if it was disproven.
 */
export type DelayCallback = (held: boolean) => void;

/** Callback type to cancel a `SubReason#delay()` call. */
export type CancelCallback = () => void;

// TODO: rename to assumption or premise?
/** Reason for a SubInference to activate. */
export class SubReason
{
    /**
     * Checks whether the reason currently holds. Returns null if unknown.
     * @virtual
     */
    public canHold(): boolean | null { return null; }

    /**
     * Asserts that the reason holds. Requires `#canHold()=true`.
     * @virtual
     */
    public assert(): void {}

    /**
     * Asserts that the reason cannot hold.
     * @virtual
     */
    public reject(): void {}

    /**
     * Sets up callbacks to wait for more information before asserting.
     * @param cb Callback for when the reason has been proven or disproven. Can
     * be called immediately.
     * @returns A callback to cancel this call. Should be already canceled
     * when this function calls `cb`. Should do nothing if called again.
     */
    public delay(cb: DelayCallback): CancelCallback
    {
        const holds = this.canHold();
        if (holds !== null)
        {
            cb(holds);
            return () => {};
        }
        return this.delayImpl(cb);
    }

    /**
     * Sets up callbacks to wait for more information before asserting.
     * @param cb Callback for when the reason has been proven or disproven. Can
     * be called immediately.
     * @returns A callback to cancel this call. Should be called automatically
     * when this function calls `cb`. Should do nothing if called again.
     * @virtual
     */
    protected delayImpl(cb: DelayCallback): CancelCallback { return () => {}; }
}
