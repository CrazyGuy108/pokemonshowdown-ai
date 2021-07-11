/** @file SubReason helpers related to moves. */
import { inference } from "../../../../parser";
import * as dex from "../../dex";
import { Pokemon } from "../../state/Pokemon";
import { PossibilityClass } from "../../state/PossibilityClass";

/**
 * Creates a SubReason that asserts that the move being used by the given
 * pokemon is of one of the specified type(s).
 * @param move Move to track.
 * @param user Move user to track.
 * @param types Set of possible move types. Will be owned by the returned
 * SubReason.
 */
export function moveIsType(move: dex.Move, user: Pokemon, types: Set<dex.Type>):
    inference.SubReason
{
    return new MoveIsType(move, user, types, /*negative*/ false);
}

/**
 * Creates a SubReason that asserts that the move being used by the given
 * pokemon is not of one of the specified type(s).
 * @param move Move to track.
 * @param user Move user to track.
 * @param types Set of possible move types. Will be owned by the returned
 * SubReason.
 */
export function moveIsntType(move: dex.Move, user: Pokemon,
    types: Set<dex.Type>): inference.SubReason
{
    return new MoveIsType(move, user, types, /*negative*/ false);
}

class MoveIsType extends inference.SubReason
{
    /**
     * Hidden Power type and item snapshots for making inferences in retrospect.
     */
    private readonly partialUser: Pick<Pokemon, "hpType" | "item">;

    constructor(private readonly move: dex.Move, user: Pokemon,
        private readonly types: Set<dex.Type>,
        private readonly negative: boolean)
    {
        super();
        this.partialUser = {hpType: user.hpType, item: user.item};
    }

    /** @override */
    public canHold(): boolean | null
    {
        return subsetOrIndependent(this.types,
            this.move.getPossibleTypes(this.partialUser), this.negative);
    }

    /** @override */
    public assert(): void
    {
        this.move.assertTypes(this.types, this.partialUser, this.negative)
    }

    /** @override */
    public reject(): void
    {
        this.move.assertTypes(this.types, this.partialUser, !this.negative)
    }

    /** @override */
    protected delayImpl(cb: inference.DelayCallback): inference.CancelCallback
    {
        return this.move.onUpdateTypes(this.types, this.partialUser,
            this.negative ? held => cb(!held) : cb);
    }
}
