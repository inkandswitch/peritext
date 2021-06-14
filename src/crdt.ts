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
    initialValue,
}: {
    actorId: string
    initialValue: string
}): Micromerge {
    const doc = new Micromerge(actorId)
    doc.change([
        { path: [], action: "makeList", key: "content" },
        {
            path: ["content"],
            action: "insert",
            index: 0,
            values: initialValue.split(""),
        },
    ])
    return doc
}
