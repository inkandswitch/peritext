import { EditorState, Transaction } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Schema, Node, SchemaSpec } from "prosemirror-model"
import { baseKeymap } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"

// declare global {
//     interface Window {
//         view: EditorView;
//     }
// }

const editorNode = document.querySelector("#editor")

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

const testSchema = new Schema(schemaDescription)

if (editorNode) {
    // Generate an empty document conforming to the schema,
    // and a default selection at the start of the document.
    const state = EditorState.create({
        schema: testSchema,
        plugins: [keymap(baseKeymap)],
    })

    // Create a view for the state and generate transactions when the user types.
    const view = new EditorView(editorNode, {
        state,
        // Intercept transactions.
        dispatchTransaction: (txn: Transaction) => {
            const newState = view.state.apply(txn)
            view.updateState(newState)

            // state.doc is a read-only data structure using a node hierarchy
            // A node contains a fragment with zero or more child nodes.
            // Text is modeled as a flat sequence of tokens.
            // Each document has a unique valid representation.
            // Order of marks specified by schema.
            console.log(
                "newState",
                txn.steps.map(s => s.toJSON()),
                newState.doc.toJSON(),
            )
        },
    })
    window.view = view
}

console.log("hi")
