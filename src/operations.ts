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
