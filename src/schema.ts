import { Schema, Node, SchemaSpec } from "prosemirror-model"

type Assert<T1 extends T2, T2> = T1

const nodes = {
    doc: {
        content: "block+",
    },
    paragraph: {
        content: "text*",
        group: "block",
        toDOM: (node: Node<Schema<NodeType, MarkType>>) => {
            return ["p", 0]
        },
    },
    text: {},
} as const

type Nodes = typeof nodes
export type NodeType = keyof Nodes
export type GroupType = {
    [T in NodeType]: Nodes[T] extends { group: string }
        ? Nodes[T]["group"]
        : never
}[NodeType]
type Quantifier = "+" | "*" | "?"
export type ContentType =
    | NodeType
    | GroupType
    | `${NodeType | GroupType}${Quantifier}`

interface NodeSpec {
    content?: ContentType
    group?: GroupType
}
type _ = Assert<Nodes, { [T in NodeType]: NodeSpec }>

const marks = {
    strong: {},
    em: {},
} as const
export type MarkType = keyof typeof marks

export const schemaDescription: SchemaSpec<NodeType, MarkType> = {
    nodes,
    marks,
}
