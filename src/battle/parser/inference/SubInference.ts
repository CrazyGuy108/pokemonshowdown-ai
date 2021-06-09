import { CancelCallback, SubReason } from "./SubReason";

/** A possible candidate for a parent EventInference. */
export class SubInference
{
    /** Whether all of the SubReasons held, or null if currently unknown. */
    private allHeld: boolean | null = null;
    /**
     * Whether this SubInference has to be rejected, and so must reject one of
     * its SubReasons.
     */
    private rejectOne = false;

    /** Tracks the cancel callbacks of any unresolved SubReasons. */
    private readonly cancelCbs = new Set<CancelCallback>();

    /**
     * Creates a SubInference.
     * @param reasons Currently unproven reasons why this SubInference should be
     * the one that is accepted by the parent EventInference. If all of them are
     * proven, the entire SubInference is proven. Otherwise if one of them is
     * disproven the entire SubInference is disproven. This Set will eventually
     * be emptied as SubReasons get resolved in the future, and so shouldn't be
     * modified outside this class.
     */
    constructor(private readonly reasons: Set<SubReason>)
    {
        this.queueAll();
    }

    /**
     * Indicates that this SubInference was the one that was accepted or
     * rejected by the parent EventInference.
     *
     * This method should only be called once.
     *
     * @param accept Whether this SubInference was accepted or rejected. If
     * accepted, all of its SubReasons are proven. If rejected, one of them is
     * disproven.
     */
    public resolve(accept: boolean): void
    {
        // accepted case: prove all (remaining) SubReasons
        if (accept)
        {
            for (const reason of this.reasons) reason.assert();
            // should already be empty due to previous delay() cbs
            this.reasons.clear();

            if (!this.allHeld)
            {
                // TODO: show rejected SubReasons (add metadata?)
                throw new Error("Supposed to assert all SubReasons but some " +
                    "rejected");
            }
            return;
        }

        // rejected case: start actively searching for a SubReason to reject
        this.rejectOne = true;
        this.checkRejectOne();
    }

    /** Queues all the SubReasons to track accepts/rejects. */
    private queueAll(): void
    {
        // queue up unresolved SubReasons
        for (const reason of this.reasons)
        {
            let called = false;
            let calledImmediately = true;
            const cancel = reason.delay(held =>
            {
                if (!calledImmediately) this.cancelCbs.delete(cancel);
                this.reasons.delete(reason);
                called = true;
                this.update(held);
            });

            // SubReason is unresolved, queue its cancel callback in case one of
            //  the others rejects
            if (!called)
            {
                this.cancelCbs.add(cancel);
                calledImmediately = false;
            }
            // one of the SubReasons was already disproven, don't bother with
            //  evaluating the rest
            else if (this.allHeld === false) break;
        }
    }

    /**
     * Updates the state of this SubInference after a SubReason resolves.
     * @param held Whether the SubReason in question held.
     */
    private update(held: boolean): void
    {
        if (!held)
        {
            this.allHeld = false;
            for (const cb of this.cancelCbs) cb();
        }
        else if (this.allHeld !== false && this.reasons.size <= 0)
        {
            this.allHeld = true;
        }
        else this.checkRejectOne();
    }

    /**
     * Checks if we should actively search for rejects in the case that this
     * SubInference is rejected.
     */
    private checkRejectOne(): void
    {
        // unsure if we should actively search for rejects yet
        if (!this.rejectOne) return;
        // already rejected one
        if (this.allHeld === false) return;
        // should've rejected one by now
        if (this.allHeld === true)
        {
            // TODO: show accepted SubReasons (add metadata?)
            throw new Error("Supposed to reject one SubReason but all of " +
                "them held");
        }

        // if all the other SubReasons accepted, then this last one must reject
        if (this.reasons.size === 1)
        {
            for (const reason of this.reasons) reason.reject();
            // should already be empty due to previous delay() cbs
            this.reasons.clear();
            return;
        }
        if (this.reasons.size < 1)
        {
            // istanbul ignore next: should never happen
            throw new Error("All SubReasons should've been resolved by " +
                "now (should never happen)");
        }
        // in this case, not enough SubReasons have been resolved to be able to
        //  make any further inferences yet
        // once another SubReason gets resolved, this will be called again
    }
}
