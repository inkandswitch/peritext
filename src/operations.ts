import type { MarkType } from "./schema"
import type {
    OperationId,
    AddMarkOperationInput,
    RemoveMarkOperationInput,
} from "./micromerge"

export type ResolvedOp =
    | (Omit<AddMarkOperationInput<MarkType>, "path"> & { id: OperationId })
    | (Omit<RemoveMarkOperationInput<MarkType>, "path"> & { id: OperationId })

/**
 * Compares two operation IDs in the form `counter@actorId`. Returns -1 if `id1` is less than `id2`,
 * 0 if they are equal, and +1 if `id1` is greater than `id2`. Order is defined by first comparing
 * counter values; if the IDs have equal counter values, we lexicographically compare actorIds.
 */
export function compareOpIds(id1: string, id2: string): -1 | 1 | 0 {
    if (id1 == id2) {
        return 0
    }
    const regex = /^([0-9]+)@(.*)$/
    const match1 = regex.exec(id1)
    const match2 = regex.exec(id2)
    if (match1 === null) {
        throw new Error(`Invalid formatted ID: ${id1}`)
    }
    if (match2 === null) {
        throw new Error(`Invalid formatted ID: ${id2}`)
    }
    const counter1 = parseInt(match1[1], 10),
        counter2 = parseInt(match2[1], 10)
    return counter1 < counter2 ||
        (counter1 === counter2 && match1[2] < match2[2])
        ? -1
        : +1
}
