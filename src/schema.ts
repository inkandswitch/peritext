import {
    MarkSpec,
    Node,
    Schema,
    SchemaSpec,
    DOMOutputSpec,
    DOMOutputSpecArray,
} from "prosemirror-model"

/***********************************************
 * Nodes.
 ***********************************************/

const nodeSpec = {
    doc: {
        content: "block+",
    },
    paragraph: {
        content: "text*",
        group: "block",
        toDOM: (node: Node): DOMOutputSpecArray => ["p", 0],
    },
    text: {},
} as const

type Nodes = typeof nodeSpec

export type NodeType = keyof Nodes
export type GroupType = {
    [T in NodeType]: Nodes[T] extends { group: string }
        ? Nodes[T]["group"]
        : never
}[NodeType]

type Quantifier = "+" | "*" | "?"

export type ContentDescription =
    | NodeType
    | GroupType
    | `${NodeType | GroupType}${Quantifier}`

interface NodeSpec {
    content?: ContentDescription
    group?: GroupType
    toDOM?: (node: Node) => DOMOutputSpec | DOMOutputSpecArray
}

type AssertNodesMatchSpec = Assert<Nodes, { [T in NodeType]: NodeSpec }>

/***********************************************
 * Marks.
 ***********************************************/

const markSpec = {
    strong: {},
    em: {},
} as const

export type MarkType = keyof typeof markSpec
type AssertMarksMatchSpec = Assert<
    typeof markSpec,
    { [T in MarkType]: MarkSpec }
>

/***********************************************
 * Schema.
 ***********************************************/

export const schemaSpec: SchemaSpec<NodeType, MarkType> = {
    nodes: nodeSpec,
    marks: markSpec,
}
