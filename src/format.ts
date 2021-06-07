import type { ResolvedOp } from "./operations"
import { MarkType } from "./schema"

export type FormatSpan = { marks: MarkType[], start: number }

export function replayOps(ops: ResolvedOp[]): FormatSpan[] {
  const initialSpans: FormatSpan[] = [{ marks: [], start: 0 }]
  return ops.reduce(applyOp, initialSpans)
}

function applyOp(spans: FormatSpan[], op: ResolvedOp): FormatSpan[] {
  return spans
}