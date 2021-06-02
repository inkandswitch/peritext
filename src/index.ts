import Automerge from "automerge"
import { EditorState, Transaction, Selection, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Schema, Node, SchemaSpec, ResolvedPos } from "prosemirror-model"
import { baseKeymap } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"

declare global {
    interface Window {
        view: EditorView
    }
}

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

type RichTextDoc = { content: Automerge.Text }

let doc = Automerge.from<RichTextDoc>({
    content: new Automerge.Text(""),
})

function prosemirrorDocFromAutomergeDoc(doc: RichTextDoc) {
    return testSchema.node("doc", undefined, [
        testSchema.node("paragraph", undefined, [
            testSchema.text(doc.content.toString()),
        ]),
    ])
}

function applyProsemirrorStepToAutomergeDoc(doc: RichTextDoc) {

}

if (editorNode) {
    // Generate an empty document conforming to the schema,
    // and a default selection at the start of the document.
    let state = EditorState.create({
        schema: testSchema,
        plugins: [keymap(baseKeymap)],
    })

    // Create a view for the state and generate transactions when the user types.
    const view = new EditorView(editorNode, {
        state,
        // Intercept transactions.
        dispatchTransaction: (txn: Transaction) => {
            // Normally one would generate a new PM state with the line below;
            // instead, we create our own new PM state thru an Automerge doc
            // const newState = view.state.apply(txn)

            // state.doc is a read-only data structure using a node hierarchy
            // A node contains a fragment with zero or more child nodes.
            // Text is modeled as a flat sequence of tokens.
            // Each document has a unique valid representation.
            // Order of marks specified by schema.

            let selection = txn.selection

            txn.steps.forEach(_step => {
                const step = _step.toJSON()
                if (step.stepType === "replace" && step.from === step.to) {
                    const insertedContent = step.slice.content
                        .map(c => c.text)
                        .join("")

                    doc = Automerge.change(doc, doc => {
                        if (doc.content.insertAt) {
                            doc.content.insertAt(step.from - 1, insertedContent)
                        }
                    })

                    const anchor = txn.doc.resolve(
                        step.from + insertedContent.length,
                    )
                    selection = new TextSelection(anchor, anchor)
                }
            })

            console.log(
                {
                    steps: txn.steps.map(s => s.toJSON()),
                    newState: state
                }
            )

            const newState = EditorState.create({
                schema: testSchema,
                plugins: [keymap(baseKeymap)],
                doc: prosemirrorDocFromAutomergeDoc(doc),
                selection
            })

            view.updateState(newState)
        },
    })
    window.view = view
}

// 1. Get text string from doc
// 2. Automerge mutation
// 3. Get new state from Automerge
// 4. Apply new state to ProseMirror
