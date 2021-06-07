import type { FormatOp, AddMarkOp, RemoveMarkOp } from "./operations"
import type Automerge from 'automerge'
import { MarkType } from "./schema"

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

type ResolvedOp = Values<ResolvedOpMap>

type FormatSpan = { marks: MarkType[], start: number }

export function replayOps(ops: ResolvedOp[]): FormatSpan[] {
  return []
}