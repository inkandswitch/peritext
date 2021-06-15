import type { MarkType } from "./schema"
import type Automerge from "automerge"

export type OpId = number

export type AddMarkOp = {
    type: "addMark"
    markType: MarkType
    start: Automerge.Cursor
    end: Automerge.Cursor
    id: OpId
}

export type RemoveMarkOp = {
    type: "removeMark"
    markType: MarkType
    start: Automerge.Cursor
    end: Automerge.Cursor
    id: OpId
}

export type FormatOp = AddMarkOp | RemoveMarkOp // more coming soon...

type ResolveCursor<T extends FormatOp> = {
    [K in keyof T]: T[K] extends Automerge.Cursor ? number : T[K]
}

type OpMap = {
    addMark: AddMarkOp
    removeMark: RemoveMarkOp
}

type ResolvedOpMap = {
    [K in keyof OpMap]: ResolveCursor<OpMap[K]>
}

export type ResolvedOp = Values<ResolvedOpMap>

/**
 * Compares two operation IDs in the form `counter@actorId`. Returns -1 if `id1` is less than `id2`,
 * 0 if they are equal, and +1 if `id1` is greater than `id2`. Order is defined by first comparing
 * counter values; if the IDs have equal counter values, we lexicographically compare actorIds.
 */
export function compareOpIds(id1, id2) {
    if (id1 == id2) return 0
    const regex = /^([0-9]+)@(.*)$/
    const match1 = regex.exec(id1),
        match2 = regex.exec(id2)
    const counter1 = parseInt(match1[1], 10),
        counter2 = parseInt(match2[1], 10)
    return counter1 < counter2 ||
        (counter1 === counter2 && match1[2] < match2[2])
        ? -1
        : +1
}
