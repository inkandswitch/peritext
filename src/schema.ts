import { MarkSpec, Node, Schema, SchemaSpec, DOMOutputSpec, DOMOutputSpecArray, Mark } from "prosemirror-model"

import ColorHash from "color-hash"
const colorHash = new ColorHash()

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
    [T in NodeType]: Nodes[T] extends { group: string } ? Nodes[T]["group"] : never
}[NodeType]

type Quantifier = "+" | "*" | "?"

export type ContentDescription = NodeType | GroupType | `${NodeType | GroupType}${Quantifier}`

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
        inclusive: true,
    },
    em: {
        toDOM() {
            return ["em"] as const
        },
        allowMultiple: false,
        inclusive: true,
    },
    comment: {
        attrs: {
            id: {},
        },
        inclusive: false,
        toDOM(mark: Mark) {
            return [
                "span",
                {
                    "data-mark": "comment",
                    "data-comment-id": mark.attrs.id,
                },
            ] as const
        },
        /** TODO: We should not be spamming this config with our own attributes.
            However, in the real world we would define a custom config structure
            that compiled down to a ProseMirror schema spec, so I will allow it. */
        allowMultiple: true,
        excludes: "" as const, // Allow overlapping with other marks of the same type.
    },
    link: {
        attrs: {
            url: {},
        },
        inclusive: false,
        allowMultiple: false,
        toDOM(mark: Mark) {
            return [
                "a",
                {
                    href: mark.attrs.url,
                    style: `color: ${colorHash.hex(mark.attrs.url)};`,
                },
            ] as const
        },
    },
} as const

// We add additional mark types only used for displaying changes in the demo.
export const demoMarkSpec = {
    ...markSpec,
    highlightChange: {
        toDOM() {
            return [
                "span",
                {
                    class: "highlight-flash",
                },
            ] as const
        },
    },
    unhighlightChange: {
        toDOM() {
            return [
                "span",
                {
                    class: "unhighlight",
                },
            ]
        },
    },
}

export type Marks = typeof markSpec

export const ALL_MARKS = ["strong" as const, "em" as const, "comment" as const, "link" as const]

type AssertAllListedAreMarks = Assert<Inner<typeof ALL_MARKS>, MarkType>
type AssertAllMarksAreListed = Assert<MarkType, Inner<typeof ALL_MARKS>>

export type MarkType = keyof typeof markSpec
type AssertMarksMatchSpec = Assert<typeof markSpec, { [T in MarkType]: MarkSpec }>

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
    marks: demoMarkSpec,
}

export type DocSchema = Schema<NodeType, MarkType>
