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
        toDOM: (): DOMOutputSpecArray => ["p", 0],
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

export const markSpec = {
    strong: {
        toDOM() {
            return ["strong"] as const
        },
        allowMultiple: false,
    },
    em: {
        toDOM() {
            return ["em"] as const
        },
        allowMultiple: false,
    },
    comment: {
        toDOM() {
            return ["span", { class: "comment" }] as const
        },
        allowMultiple: true,
    },
    link: {
        toDOM(mark: Mark) {
            return ["a", { href: mark.attrs.href }] as const
        },
        allowMultiple: false,
    },
} as const

export const ALL_MARKS = [
    "strong" as const,
    "em" as const,
    "comment" as const,
    "link" as const,
]

type AssertAllListedAreMarks = Assert<Inner<typeof ALL_MARKS>, MarkType>
type AssertAllMarksAreListed = Assert<MarkType, Inner<typeof ALL_MARKS>>

export type MarkType = keyof typeof markSpec
type AssertMarksMatchSpec = Assert<
    typeof markSpec,
    { [T in MarkType]: MarkSpec }
>

export function isMarkType(s: string): s is MarkType {
    if (s === "strong" || s === "em" || s === "comment" || s === "link") {
        type AssertSound = Assert<typeof s, MarkType>
        type AssertComplete = Assert<MarkType, typeof s>
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
