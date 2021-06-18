/**
 * Logic for interfacing with our CRDT implementation.
 */
import * as Micromerge from "./micromerge"
import * as uuid from "uuid"

import type { MarkType } from "./schema"

export type Change = Micromerge.Change<MarkType>
export type Operation = Micromerge.InputOperation<MarkType>

/**
 * Initialize a new Micromerge document.
 */
export function create({
    actorId = uuid.v4(),
}: {
    actorId: string
}): Micromerge.default<MarkType> {
    return new Micromerge.default(actorId)
}
