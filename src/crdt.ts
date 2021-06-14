/**
 * Logic for interfacing with our CRDT implementation.
 */
import Micromerge from "./micromerge"
import * as uuid from "uuid"

export type Change = any

export type Operation = any

/**
 * Initialize a new Micromerge document.
 */
export function create({
    actorId = uuid.v4(),
}: {
    actorId: string
}): Micromerge {
    return new Micromerge(actorId)
}
