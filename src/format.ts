import { compact, isEqual } from "lodash"
import { ALL_MARKS } from "./schema"
import Micromerge, { compareOpIds } from "./micromerge"

import type {
    OperationId,
    InputOperation,
    AddMarkOperationInput,
    RemoveMarkOperationInput,
    Patch,
} from "./micromerge"
import type { Marks, MarkType } from "./schema"
import sortBy from "lodash/sortBy"

/**
 * Using this intermediate operation representation for formatting.
 * Remove the path to the CRDT object, and use the operation ID for
 * operation comparisons.
 *
 * NOTE: The `id` here is the newly-generated CRDT ID, *NOT* the
 * resolved path.
 */
export type ResolvedOp =
    | ResolveOp<AddMarkOperationInput>
    | ResolveOp<RemoveMarkOperationInput>

export type ResolveOp<O extends InputOperation> = DistributiveOmit<
    O & {
        id: OperationId
    },
    "path"
>

type BooleanMarkValue =
    | {
          active: true
          /** A MarkValue should always have the ID of the operation that last modified it. */
          opId: OperationId
      }
    | {
          active: false
          opId: OperationId
      }

type IdMarkValue = {
    id: string
    /** A MarkValue should always have the ID of the operation that last modified it. */
    opId: OperationId
}

type LinkMarkValue =
    | {
          url: string
          /** A MarkValue should always have the ID of the operation that last modified it. */
          opId: OperationId
          active: true
      }
    | {
          url?: undefined
          opId: OperationId
          active: false
      }

export type MarkValue = Assert<
    {
        strong: BooleanMarkValue
        em: BooleanMarkValue
        comment: IdMarkValue
        link: LinkMarkValue
    },
    { [K in MarkType]: Record<string, unknown> }
>

export type MarkMap = {
    [K in MarkType]?: Marks[K]["allowMultiple"] extends true
        ? Array<MarkValue[K]>
        : MarkValue[K]
}

export type FormatSpan = {
    marks: MarkMap
    start: number
}

interface FormatSpanWithEnd extends FormatSpan {
    /** Inclusive end index of the span. */
    end: number
}

interface FormatSpanWithPatch {
    span: FormatSpan
    patch?: Patch
}

/** Given a log of operations, produce the final flat list of format spans.
 *  Because applyOp is order-agnostic, the incoming op list can be in any order.
 */
export function replayOps(ops: ResolvedOp[], docLength: number): FormatSpan[] {
    const init: {
        spans: FormatSpan[]
        patches: Patch[]
    } = {
        spans: [{ marks: {}, start: 0 }],
        patches: [],
    }
    const result = ops.reduce(({ spans, patches }, op) => {
        const { spans: updatedSpans, patches: updatedPatches } = applyOp({
            spans,
            op,
            docLength,
        })
        return {
            spans: updatedSpans,
            patches: [...patches, ...updatedPatches],
        }
    }, init)
    return normalize(result.spans, docLength)
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
export function applyOp(args: {
    spans: FormatSpan[]
    op: ResolvedOp
    docLength: number
}): { spans: FormatSpan[]; patches: Patch[] } {
    const { op, docLength } = args
    const spans = getSpansWithEnd(args.spans, docLength)
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
    //       s          t
    //    ...|b-----|...|------|... <- existing content
    //           [u-------]         <- new operation
    //           i        j
    //
    // Our goal is to split s at position i, and t at position j:
    //
    //    ...|b--[bu|...|u]---|...
    //       s   i      t j

    // First, get the spans that come before the operation.
    // Their formatting remains unchanged.
    //       s   i      t j
    //    ...|b--[bu|...|u]---|...
    //    ^^^
    const spansBefore = spans.slice(
        0,
        // Normally we include the covering start span in the list as-is;
        // but if the op starts at the same position as the covering start span,
        // then we exclude the covering start span to avoid two spans starting
        // in the same position.
        op.start === start.span.start ? start.index : start.index + 1,
    )
    // Next, get the spans completely enclosed within the operation.
    //       s   i      t j
    //    ...|b--[bu|...|u]---|...
    //               ^^^^^
    const spansWithin = spans.slice(start.index + 1, end.index + 1)
    // Get the "tail" of the span intersecting the operation end.
    //                  t
    // existing      ...|------|...
    // new op    [u-------]^^^^
    //           i        j
    // We'll split the end span at this position, preserving the original
    // formatting on the tail.
    //       s   i      t j
    //    ...|b--|bu|...|u|---|...
    //                     ^^^
    const spanAtEnd =
        op.end + 1 !== spans[end.index + 1]?.start
            ? { ...end.span, start: op.end + 1 }
            : undefined
    // Finally, get the spans after the end of the operation.
    // These also remain unchanged.
    //       s   i      t j
    //    ...|b--|bu|...|u|---|...
    //                         ^^^
    const spansAfter = spans.slice(end.index + 1)

    // We need to get the end of the span we're inserting at the beginning
    // of the operation.
    // To do this, we look ahead to the next span (which may or may not exist).
    //       s   i      t j
    //    ...|b--[bu|...|u]---|...
    //              ^
    const nextOp =
        // First, try to get the first span after the newly-inserted op start.
        spansWithin[0]?.start ||
        // Next, try to get the span overlapping the end of the op.
        spanAtEnd?.start ||
        // Next, try to get the first span after the op.
        spansAfter[0]?.start ||
        // If there are no spans after the new op, it extends to the
        // end of the document, so we can just use `docLength`.
        docLength

    // Now we can construct the span we're inserting at the operation's start.
    //       s   i      t j
    //    ...|b--[bu|...|u]---|...
    //           ^^^
    const spanAtStart = applyFormatting({
        span: { ...start.span, start: op.start, end: nextOp - 1 },
        op,
    })

    // Put everything together to build the new document.
    const newSpans: Array<FormatSpanWithPatch> = compact([
        ...spansBefore.map(span => ({ span, patch: undefined })),
        spanAtStart,
        ...spansWithin.map(span => applyFormatting({ span, op })),
        // Normally we add a span here from end of op to the end of the end-covering span.
        // In the special case where the op ends at the same place as the end-covering span,
        // though, we avoid adding this extra span.
        spanAtEnd && {
            span: spanAtEnd,
            patch: undefined,
        },
        ...spansAfter.map(span => ({ span, patch: undefined })),
    ])

    return {
        spans: newSpans.map(({ span }) => span),
        patches: compact(newSpans.map(({ patch }) => patch)),
    }
}

function getSpansWithEnd(
    spans: FormatSpan[],
    docLength: number,
): Array<FormatSpanWithEnd> {
    // WHERE IS MY WINDOWS FUNCTION?
    return spans.map((span: FormatSpan, index: number) => {
        return {
            ...span,
            end:
                index < spans.length - 1
                    ? spans[index + 1].start - 1 // Inclusive end.
                    : docLength - 1,
        }
    })
}

/** Given a list of spans sorted increasing by index,
 *  and a position in the document, return the span covering
    the given position.
 *  Currently a naive linear scan; could be made faster.
 */
export function getSpanAtPosition<T extends FormatSpan>(
    spans: T[],
    position: number,
): { index: number; span: T } | undefined {
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
function applyFormatting(args: {
    span: FormatSpanWithEnd
    op: ResolvedOp
}): FormatSpanWithPatch {
    const { op } = args
    const { marks, ...span } = args.span
    const newMarks = { ...marks }

    /** Patch describing the change to the span. */
    let patch: Patch | null

    switch (op.action) {
        case "addMark": {
            if (op.markType === "strong" || op.markType === "em") {
                const mark = marks[op.markType]
                if (
                    mark === undefined ||
                    compareOpIds(op.id, mark.opId) === 1
                ) {
                    // Only apply the op if its ID is greater than the last op that touched this mark
                    newMarks[op.markType] = {
                        active: true,
                        opId: op.id,
                    }
                    // Emit patch describing what happened.
                    patch = {
                        action: "addMark",
                        path: [Micromerge.contentKey],
                        markType: op.markType,
                        start: span.start,
                        end: span.end,
                    }
                } else {
                    // Discarding this operation should not produce a patch.
                    patch = null
                }
            } else if (op.markType === "comment") {
                const newMark = {
                    id: op.attrs.id,
                    opId: op.id,
                }
                const commentPatch: Patch = {
                    action: "addMark",
                    path: [Micromerge.contentKey],
                    markType: op.markType,
                    attrs: op.attrs,
                    start: span.start,
                    end: span.end,
                }

                const existing = marks[op.markType]
                if (existing === undefined) {
                    newMarks[op.markType] = [newMark]
                    patch = commentPatch
                } else {
                    // Check existing list of annotations.
                    // Find the comment with the same comment ID.
                    const match = existing.find(m => m.id === op.attrs.id)
                    // If it doesn't exist, add it.
                    if (match === undefined) {
                        // We keep this list sorted by ID because order doesn't matter
                        // (it's basically an unordered set), and it's useful for testing
                        // to have a consistent ordering
                        newMarks[op.markType] = sortBy(
                            [...existing, newMark],
                            v => v.id,
                        )
                        patch = commentPatch
                    } else if (
                        // Otherwise, compare operation IDs and update operation ID if greater.
                        // Only apply the op if its ID is greater than the last op that touched this mark
                        compareOpIds(op.id, match.id) === 1
                    ) {
                        newMarks[op.markType] = existing.map(m =>
                            m.id === op.id ? { ...m, opId: op.id } : m,
                        )
                        patch = commentPatch
                    } else {
                        patch = null
                    }
                }
            } else if (op.markType === "link") {
                const mark = marks[op.markType]
                if (
                    mark === undefined ||
                    compareOpIds(op.id, mark.opId) === 1
                ) {
                    // Only apply the op if its ID is greater than the last op that touched this mark
                    newMarks[op.markType] = {
                        active: true,
                        url: op.attrs.url,
                        opId: op.id,
                    }
                    patch = {
                        action: "addMark",
                        path: [Micromerge.contentKey],
                        markType: op.markType,
                        attrs: op.attrs,
                        start: span.start,
                        end: span.end,
                    }
                } else {
                    patch = null
                }
            } else {
                unreachable(op)
            }
            break
        }
        case "removeMark": {
            // Only apply the op if its ID is greater than the last op that touched this mark
            if (
                op.markType === "strong" ||
                op.markType === "em" ||
                op.markType === "link"
            ) {
                const mark = marks[op.markType]
                if (
                    mark === undefined ||
                    compareOpIds(op.id, mark.opId) === 1
                ) {
                    newMarks[op.markType] = {
                        active: false,
                        opId: op.id,
                    }
                    patch = {
                        action: "removeMark",
                        path: [Micromerge.contentKey],
                        markType: op.markType,
                        start: span.start,
                        end: span.end,
                    }
                } else {
                    patch = null
                }
            } else if (op.markType === "comment") {
                // Remove the mark with the same ID if it exists.
                const existing = marks[op.markType]
                if (existing !== undefined) {
                    newMarks[op.markType] = existing.filter(
                        m => m.id !== op.attrs.id,
                    )
                    patch = {
                        action: "removeMark",
                        path: [Micromerge.contentKey],
                        markType: op.markType,
                        attrs: op.attrs,
                        start: span.start,
                        end: span.end,
                    }
                } else {
                    patch = null
                }
            } else {
                unreachable(op)
                patch = null
            }
            break
        }
        default: {
            unreachable(op)
        }
    }

    return {
        span: {
            ...span,
            marks: newMarks,
        },
        patch: patch === null ? undefined : patch,
    }
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
        return index === 0 || !marksEqual(spans[index - 1].marks, span.marks)
    })
}

// TODO: Should this function compare metadata?
function marksEqual(s1: MarkMap, s2: MarkMap): boolean {
    return ALL_MARKS.every(mark => {
        if (mark === "strong" || mark === "em") {
            const mark1 = s1[mark]
            const mark2 = s2[mark]

            if (isInactive(mark1) && isInactive(mark2)) {
                return true
            } else if (!isInactive(mark1) && !isInactive(mark2)) {
                return true
            } else {
                // One is active and one isn't.
                return false
            }
        } else if (mark === "link") {
            const mark1 = s1[mark]
            const mark2 = s2[mark]

            if (isInactive(mark1) && isInactive(mark2)) {
                return true
            } else if (!isInactive(mark1) && !isInactive(mark2)) {
                return (
                    (mark1 !== undefined && mark1.url) ===
                    (mark2 !== undefined && mark2.url)
                )
            } else {
                // One is active and one isn't.
                return false
            }
        } else if (mark === "comment") {
            const marks1 = new Set((s1[mark] || []).map(m => m.id))
            const marks2 = new Set((s2[mark] || []).map(m => m.id))

            return isEqual(marks1, marks2)
        } else {
            unreachable(mark)
        }
    })
}

function isInactive(mark: BooleanMarkValue | undefined): boolean {
    return mark === undefined || mark.active === false
}
