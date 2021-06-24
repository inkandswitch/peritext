import { compact } from "lodash"
import { ALL_MARKS, MarkAttributes, markSpec } from "./schema"
import { compareOpIds } from "./micromerge"

import type {
    OperationId,
    AddMarkOperationInput,
    RemoveMarkOperationInput,
} from "./micromerge"
import type { MarkType } from "./schema"

export type ResolvedOp =
    | (Omit<AddMarkOperationInput<MarkType>, "path"> & { id: OperationId })
    | (Omit<RemoveMarkOperationInput<MarkType>, "path"> & { id: OperationId })

// TODO: is it bad that OperationId is up at this level?
// Do we want Op IDs at more granular points, eg having MarkAttributes
// be an Automerge map with per-key OpIds?
export type MarkValue = {
    active: boolean
    opId: OperationId
    attrs: MarkAttributes | Set<MarkAttributes>
}

export type MarkMap = { [T in MarkType]?: MarkValue }

export type FormatSpan = {
    marks: MarkMap
    start: number
}

/** Given a log of operations, produce the final flat list of format spans.
 *  Because applyOp is order-agnostic, the incoming op list can be in any order.
 */
export function replayOps(ops: ResolvedOp[], docLength: number): FormatSpan[] {
    const initialSpans: FormatSpan[] = [{ marks: {}, start: 0 }]
    const newSpans = ops.reduce((spans, op) => applyOp(spans, op), initialSpans)
    return normalize(newSpans, docLength)
}

/**
 * Given a list of format spans covering the whole document, and a
 * CRDT formatting operation, return an updated list of format spans
 * accounting for the formatting operation.
 *
 * This function accounts for out-of-order application of operations;
 * even if the operation being applied comes causally before other
 * operations that have already been incorporated, we will correctly
 * converge to a result as if the ops had been played in causal order.
 */
export function applyOp(spans: FormatSpan[], op: ResolvedOp): FormatSpan[] {
    const start = getSpanAtPosition(spans, op.start)
    const end = getSpanAtPosition(spans, op.end)

    if (!start || !end) {
        throw new Error(
            "Invariant violation: there should always be a span covering the given operation boundaries",
        )
    }
    // The general intuition here is to apply the effects of this operation
    // to any overlapping spans in the existing list, which includes:
    // 1) Splitting up the spans that overlap with the start/end of this operation
    // 2) Applying the effects of the operation to any spans in between those two.
    //
    // Visually, if i = op.start, j = op.end, and s and t are the spans overlapping
    // i and j respectively, then we have this diagram (b and u are "add mark" formats):
    //
    //          s         t
    //    ...|b-----|...|------|...
    //           |u-------|
    //           i        j
    //
    // Our goal is to split s at position i, and t at position j:
    //
    //    ...|b--|bu|...|u|---|...
    //       s   i      t j
    const newSpans: FormatSpan[] = compact([
        // ...|b--
        //    s
        ...spans.slice(
            0,
            // Normally we include the covering start span in the list as-is;
            // but if the op starts at the same position as the covering start span,
            // then we exclude the covering start span to avoid two spans starting
            // in the same position.
            op.start === start.span.start ? start.index : start.index + 1,
        ),
        //        |bu
        //        i
        { ...applyFormatting(start.span, op), start: op.start },
        //           |...|u----|...
        //               t
        ...spans
            .slice(start.index + 1, end.index + 1)
            .map(span => applyFormatting(span, op)),
        //                 |---
        //                 j+1
        //
        // Normally we add a span here from end of op to the end of the end-covering span.
        // In the special case where the op ends at the same place as the end-covering span,
        // though, we avoid adding this extra span.
        op.end + 1 !== (spans[end.index + 1] && spans[end.index + 1].start)
            ? { ...end.span, start: op.end + 1 }
            : null,
        //                     |...
        ...spans.slice(end.index + 1),
    ])

    // Normalize output before returning to keep span list short as we apply each op
    return newSpans
}

/** Given a list of spans sorted increasing by index,
 *  and a position in the document, return the span covering
    the given position.
 *  Currently a naive linear scan; could be made faster.
 */
export function getSpanAtPosition(
    spans: FormatSpan[],
    position: number,
): { index: number; span: FormatSpan } | undefined {
    if (spans.length === 0) {
        return
    }

    // Iterate from the end (largest index -> smallest).
    // Return the first span starting before or at the given position.
    let start = 0
    let end = spans.length

    while (end - start > 1) {
        const pivot = Math.floor((start + end) / 2)
        const span = spans[pivot]
        if (!span) {
            throw new Error(`Invalid pivot index: ${pivot}`)
        }
        if (span.start === position) {
            return { index: pivot, span }
        } else if (span.start < position) {
            // Span starts before the given position, but may not be optimal.
            // Go right to search for better options.
            start = pivot
        } else {
            // Span is strictly after the given position, go left.
            end = pivot
        }
    }

    // If we reached this point, start + 1 === end.
    // Check the span at the start index.
    const span = spans[start]
    if (!span) {
        throw new Error(`Invalid span index: ${start}`)
    }
    if (span.start <= position) {
        return { index: start, span }
    } else {
        return
    }
}

/** Return a new list of marks after applying an op;
 *  adding or removing the formatting specified by the op.
 *  (does not mutate the set that was passed in)
 */
function applyFormatting(
    { marks, ...span }: FormatSpan,
    op: ResolvedOp,
): FormatSpan {
    const newMarks = { ...marks }
    const mark = marks[op.markType]

    switch (op.action) {
        case "addMark": {
            if (markSpec[op.markType].allowMultiple) {
                // TODO: Hmm, should we be doing an op ID comparison here?
                // How does it work when people add/remove comments concurrently...?
                // For now let's ignore op ID and come back to it.

                newMarks[op.markType] = {
                    active: true,
                    attrs: (newMarks[op.markType]?.attrs || new Set()).add(
                        op.attrs,
                    ),
                    opId: op.id,
                }
            } else {
                // Only apply the op if its ID is greater than the last op that touched this mark
                if (
                    mark === undefined ||
                    compareOpIds(op.id, mark.opId) === 1
                ) {
                    newMarks[op.markType] = {
                        active: true,
                        opId: op.id,
                        attrs: op.attrs || {},
                    }
                }
            }
            break
        }
        case "removeMark": {
            if (markSpec[op.markType].allowMultiple) {
                throw new Error(
                    "removeMark isn't implemented yet for marks with identity",
                )
            }
            // Only apply the op if its ID is greater than the last op that touched this mark
            if (mark === undefined || compareOpIds(op.id, mark.opId) === 1) {
                newMarks[op.markType] = {
                    active: false,
                    opId: op.id,
                    attrs: {}, // clear out attrs on an inactive mark
                }
            }
            break
        }
    }

    return { ...span, marks: newMarks }
}

/** Return an updated list of format spans where:
 *
 *  - zero-width spans have been removed
 *  - adjacent spans with the same marks have been combined into a single span
 *  (preferring the leftmost one)
 *  - any spans that are past the end of the document have been removed
 */
export function normalize(
    spans: FormatSpan[],
    docLength: number,
): FormatSpan[] {
    return spans.filter((span, index) => {
        // Remove zero-width spans.
        // If we have two spans starting at the same position,
        // we choose the last one as authoritative.
        // This makes sense because the first span to the left
        // has effectively been collapsed to zero width;
        // whereas the second span on the right may be more than zero width.
        if (index < spans.length - 1 && span.start === spans[index + 1].start) {
            return false
        }

        // Remove spans past the end of the document
        if (span.start > docLength - 1) {
            return false
        }

        // Remove spans that have the same content as their neighbor to the left
        return index === 0 || !markMapsEqual(spans[index - 1].marks, span.marks)
    })
}

// Two MarkMaps are equal if for each mark, they have the same active state + metadata
function markMapsEqual(s1: MarkMap, s2: MarkMap): boolean {
    return ALL_MARKS.every(mark => {
        const mark1 = s1[mark]
        const mark2 = s2[mark]

        const bothInactive = isInactive(mark1) && isInactive(mark2)
        const sameAttrs =
            !isInactive(mark1) &&
            !isInactive(mark2) &&
            mark1?.attrs === mark2?.attrs

        const result = bothInactive || sameAttrs

        return result
    })
}

function isInactive(mark: MarkValue | undefined): boolean {
    return mark === undefined || mark.active === false
}
