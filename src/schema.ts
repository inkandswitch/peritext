import {
    MarkSpec,
    Node,
    Schema,
    SchemaSpec,
    DOMOutputSpec,
    DOMOutputSpecArray,
    Mark,
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
    strong: {
        toDOM(mark: Mark) {
            return ["strong"] as const
        },
    },
    em: {
        toDOM(mark: Mark) {
            return ["em"] as const
        },
    },
} as const

export const ALL_MARKS = ["strong" as const, "em" as const]

type AssertAllListedAreMarks = Assert<Inner<typeof ALL_MARKS>, MarkType>
type AssertAllMarksAreListed = Assert<MarkType, Inner<typeof ALL_MARKS>>

export type MarkType = keyof typeof markSpec
type AssertMarksMatchSpec = Assert<
    typeof markSpec,
    { [T in MarkType]: MarkSpec }
>

export function isMarkType(s: string): s is MarkType {
    if (s === "strong" || s === "em") {
        type Assertion = Assert<typeof s, MarkType>
        return true
    }
    return false
}

/***********************************************
 * Schema.
 ***********************************************/

export const schemaSpec: SchemaSpec<NodeType, MarkType> = {
    nodes: nodeSpec,
    marks: markSpec,
}

export type DocSchema = Schema<NodeType, MarkType>
