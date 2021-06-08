import type { ResolvedOp } from "./operations"
import { MarkType } from "./schema"

export type FormatSpan = { marks: MarkType[], start: number }

/** Given a log of operations, produce the final flat list of format spans */
export function replayOps(ops: ResolvedOp[]): FormatSpan[] {
  const initialSpans: FormatSpan[] = [{ marks: [], start: 0 }]
  return ops.reduce(applyOp, initialSpans)
}

/** Given a list of spans and a formatting op,
 *  mutates the list of spans to reflect the effects of the op.
 *
 *  NOTE: rather than mutating here, we could do either:
 *  - return a copy and don't mutate
 *  - return a list of operations to perform on the spans,
 *    which can be translated into PM transactions?
 */
function applyOp(spans: FormatSpan[], op: ResolvedOp): FormatSpan[] {
  const coveringStartIndex = spanCovering(spans, op.start)
  const coveringEndIndex = spanCovering(spans, op.end)

  // In this case, a single existing span covered the whole range of our op
  if (coveringStartIndex === coveringEndIndex) {
    const coveringSpan = spans[coveringStartIndex]
    const newSpans: FormatSpan[] = [
      { start: coveringSpan.start, marks: coveringSpan.marks },
      { start: op.start, marks: applyFormatting(coveringSpan.marks, op) },
      { start: op.end + 1, marks: coveringSpan.marks }
    ]

    // Replace the original covering span with the three new spans
    spans.splice(coveringStartIndex, 1, ...newSpans)
  } else {
    throw new Error('unimplemented')
  }

  return spans
}

/** Given a list of spans and a position in the document,
 *  return the index of the span that covers the given position
 */
function spanCovering(spans: FormatSpan[], position: number): number {
  const indexAfter = spans.findIndex(span => span.start > position)
  if (indexAfter === -1) {
    return spans.length - 1
  } else {
    return indexAfter - 1
  }
}

/** Return a new list of marks after applying an op;
 *  adding or removing the formatting specified by the op.
 *  (does not mutate the passed-in list of marks)
 */
function applyFormatting(marks: MarkType[], op: ResolvedOp): MarkType[] {
  switch (op.type) {
    case 'addMark': {
      if (!marks.includes(op.markType)) {
        return [...marks, op.markType]
      } else {
        return marks
      }
    }
    case 'removeMark': {
      return marks.filter(mark => mark != op.markType)
    }
  }
}