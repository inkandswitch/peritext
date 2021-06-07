import type { MarkType } from './schema'
import type Automerge from 'automerge'

export type AddMarkOp = {
  type: "addMark"
  markType: MarkType
  start: Automerge.Cursor
  end: Automerge.Cursor
}

export type RemoveMarkOp = {
  type: "removeMark"
  markType: MarkType
  start: Automerge.Cursor
  end: Automerge.Cursor
}

export type FormatOp = AddMarkOp | RemoveMarkOp // more coming soon...