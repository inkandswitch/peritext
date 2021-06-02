import Automerge from "automerge"
import {
    EditorState,
    Transaction,
    Selection,
    TextSelection,
} from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Schema, Node, SchemaSpec, ResolvedPos } from "prosemirror-model"
import { baseKeymap } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { schemaSpec } from "./schema"

const editorNode = document.querySelector("#editor")
const schema = new Schema(schemaSpec)

type RichTextDoc = { content: Automerge.Text }

let doc = Automerge.from<RichTextDoc>({
    content: new Automerge.Text(""),
})

// Given an automerge doc representation, produce a prosemirror doc.
// In the future, will handle fancier stuff like formatting.
function prosemirrorDocFromAutomergeDoc(doc: RichTextDoc) {
    return schema.node("doc", undefined, [
        schema.node("paragraph", undefined, [
            schema.text(doc.content.toString()),
        ]),
    ])
}

// Given an Automerge Doc and a Prosemirror Transaction, returns:
// - an updated Automerge Doc
// - a new Prosemirror Selection
function applyTransaction(
    doc: RichTextDoc,
    txn: Transaction,
): [RichTextDoc, Selection] {
    // Normally one would generate a new PM state with the line below;
    // instead, we run our own logic to produce a new state.
    // const newState = view.state.apply(txn)

    // Default to leaving the selection alone; we might mutate it as we apply the txn.
    let selection = txn.selection
    let newDoc = doc

    txn.steps.forEach(_step => {
        const step = _step.toJSON()

        // handle insertion
        if (step.stepType === "replace" && step.slice) {
            // If the insertion is replacing existing text, first delete that text
            if (step.from !== step.to) {
                doc = Automerge.change(doc, doc => {
                    if (doc.content.deleteAt) {
                        doc.content.deleteAt(step.from - 1, step.to - step.from)
                    }
                })
            }

            const insertedContent = step.slice.content.map(c => c.text).join("")

            newDoc = Automerge.change(doc, doc => {
                if (doc.content.insertAt) {
                    doc.content.insertAt(step.from - 1, insertedContent)
                }
            })

            const anchor = txn.doc.resolve(step.from + insertedContent.length)
            selection = new TextSelection(anchor, anchor)
        }

        // handle deletion
        if (step.stepType === "replace" && !step.slice) {
            newDoc = Automerge.change(doc, doc => {
                if (doc.content.deleteAt) {
                    doc.content.deleteAt(step.from - 1, step.to - step.from)
                }
            })

            // Interesting that we don't need to update the selection here -- why?
        }
    })

    return [newDoc, selection]
}

if (editorNode) {
    // Generate an empty document conforming to the schema,
    // and a default selection at the start of the document.
    let state = EditorState.create({
        schema,
        plugins: [keymap(baseKeymap)],
    })

    // Create a view for the state and generate transactions when the user types.
    const view = new EditorView(editorNode, {
        // state.doc is a read-only data structure using a node hierarchy
        // A node contains a fragment with zero or more child nodes.
        // Text is modeled as a flat sequence of tokens.
        // Each document has a unique valid representation.
        // Order of marks specified by schema.
        state,
        // Intercept transactions.
        dispatchTransaction: (txn: Transaction) => {
            const [newDoc, newSelection] = applyTransaction(doc, txn)

            // store our updated Automerge doc in our global mutable state
            doc = newDoc

            const newProsemirrorDoc = prosemirrorDocFromAutomergeDoc(doc)

            const newState = EditorState.create({
                schema,
                plugins: [keymap(baseKeymap)],
                doc: newProsemirrorDoc,
                selection: newSelection,
            })

            console.log(
                "steps",
                txn.steps.map(s => s.toJSON()),
                "newState",
                newState,
            )

            view.updateState(newState)
        },
    })
    window.view = view
}
