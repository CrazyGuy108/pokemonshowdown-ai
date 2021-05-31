/** Identifies a team's side in the client's perspective. */
export type Side = "us" | "them";

/** Returns the other side. */
export function otherSide(side: Side): Side
{
    return side === "us" ? "them" : "us";
}
