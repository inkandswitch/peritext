import { compact } from "lodash"
import type { ResolvedOp, OpId } from "./operations"
import { MarkType } from "./schema"

export type FormatSpan = {
    marks: Set<MarkType>
    start: number
    metadata: { [key: string]: OpId }
}

/** Given a log of operations, produce the final flat list of format spans. */
export function replayOps(ops: ResolvedOp[], docLength: number): FormatSpan[] {
    const initialSpans: FormatSpan[] = [
        { marks: new Set(), start: 0, metadata: {} },
    ]
    const newSpans = ops.reduce(
        (spans, op) => applyOp(spans, op, docLength),
        initialSpans,
    )
    return normalize(newSpans, docLength)
}

/**
 * Given a list of format spans covering the whole document, and a
 * CRDT formatting operation, return an updated list of format spans
 * accounting for the formatting operation.
 */
function applyOp(
    spans: FormatSpan[],
    op: ResolvedOp,
    docLength: number,
): FormatSpan[] {
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
        op.end + 1 !== spans[end.index + 1]?.start
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
    { marks, metadata, ...span }: FormatSpan,
    op: ResolvedOp,
): FormatSpan {
    const newMarks = new Set(marks)
    const newMetadata = { ...metadata }

    switch (op.type) {
        case "addMark": {
            // Only apply the op if its ID is greater than the last op that touched this mark
            if (
                metadata[op.markType] === undefined ||
                op.id > metadata[op.markType]
            ) {
                newMarks.add(op.markType)
                newMetadata[op.markType] = op.id
            }
            break
        }
        case "removeMark": {
            // Only apply the op if its ID is greater than the last op that touched this mark
            if (
                metadata[op.markType] === undefined ||
                op.id > metadata[op.markType]
            ) {
                newMarks.delete(op.markType)
                newMetadata[op.markType] = op.id
            }
            break
        }
    }

    return { ...span, marks: newMarks, metadata: newMetadata }
}

/** Return an updated list of format spans where:
 *
 *  - adjacent spans with the same marks have been combined into a single span
 *  (preferring the leftmost one)
 *  - any spans that are past the end of the document have been removed
 */
export function normalize(
    spans: FormatSpan[],
    docLength: number,
): FormatSpan[] {
    return spans.filter((span, index) => {
        // The first span is always ok to include
        if (index === 0) {
            return true
        }

        if (span.start === spans[index - 1].start) {
            // If we have two spans starting at the same position,
            // it's dangerous to pick one of them arbitrarily;
            // instead, we must avoid such cases upstream.
            throw new Error("Cannot have two spans starting at same position.")
        }

        if (span.start > docLength - 1) {
            return false
        }

        return !setEqual(spans[index - 1].marks, span.marks)
    })
}

function setEqual<T>(s1: Set<T>, s2: Set<T>): boolean {
    return s1.size === s2.size && [...s1].every(value => s2.has(value))
}
