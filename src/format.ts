import type { ResolvedOp } from "./operations"
import { MarkType } from "./schema"

export type FormatSpan = { marks: Set<MarkType>; start: number }

/** Given a log of operations, produce the final flat list of format spans */
export function replayOps(ops: ResolvedOp[]): FormatSpan[] {
    const initialSpans: FormatSpan[] = [{ marks: new Set(), start: 0 }]
    return compact(ops.reduce(applyOp, initialSpans))
}

/**
 * Given a list of format spans covering the whole document, and a
 * CRDT formatting operation, return an updated list of format spans
 * accounting for the formatting operation.
 */
function applyOp(spans: FormatSpan[], op: ResolvedOp): FormatSpan[] {
    const start = getSpanAtPosition(spans, op.start)
    const end = getSpanAtPosition(spans, op.end)
    if (!start || !end) {
        throw new Error(
            "Invariant violation: there should always be a span covering the given operation boundaries"
        )
    }

    // In this case, a single existing span covered the whole range of our op
    if (start.index === end.index) {
        const coveringSpan = start.span
        const newSpans: FormatSpan[] = [
            { start: op.start, marks: applyFormatting(coveringSpan.marks, op) },
            { start: op.end + 1, marks: coveringSpan.marks },
        ]

        return [
            ...spans.slice(0, start.index + 1),
            ...newSpans,
            ...spans.slice(start.index + 1),
        ]
    } else {
        //          s         t
        //    ...|b-----|...|------|...
        //           |u-------|
        //           i        j
        //
        //       Goal: subdivide into spans
        //
        //    ...|b--|bu|...|u|---|...
        //       s   i      t j

        // Create span at i with marks from original start span, plus the new
        // mark from the current operation.
        // TODO: Write a function to insert one or more spans in the correct
        // position.
        return [
            // ...|b--
            //    s
            ...spans.slice(0, start.index + 1),
            //        |bu
            //        i
            { start: op.start, marks: applyFormatting(start.span.marks, op) },
            //           |...|u----|...
            //               t
            ...spans.slice(start.index + 1, end.index + 1).map(span => ({
                ...span,
                marks: applyFormatting(span.marks, op),
            })),
            //                 |---
            //                 j+1
            { start: op.end + 1, marks: end.span.marks },
            //                     |...
            ...spans.slice(end.index + 1),
        ]
    }
}

/** Given a list of spans sorted increasing by index,
 *  and a position in the document, return the span covering
    the given position.
 *  Currently a naive linear scan; could be made faster.
 */
export function getSpanAtPosition(
    spans: FormatSpan[],
    position: number
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
function applyFormatting(marks: Set<MarkType>, op: ResolvedOp): Set<MarkType> {
    const result = new Set(marks)

    switch (op.type) {
        case "addMark": {
            result.add(op.markType)
            break
        }
        case "removeMark": {
            result.delete(op.markType)
            break
        }
    }

    return result
}

export function compact(spans: FormatSpan[]): FormatSpan[] {
    return spans.filter((span, index) => {
        if (index === 0) {
            return true
        }

        return !setEqual(spans[index - 1].marks, span.marks)
    })
}

function setEqual<T>(s1: Set<T>, s2: Set<T>): boolean {
    return s1.size === s2.size && [...s1].every(value => s2.has(value))
}
