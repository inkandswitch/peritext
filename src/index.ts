import Micromerge from "./micromerge"
import { EditorState, Transaction, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Schema, Slice } from "prosemirror-model"
import { baseKeymap, toggleMark } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { ReplaceStep, AddMarkStep, RemoveMarkStep } from "prosemirror-transform"
import { schemaSpec, isMarkType } from "./schema"
import { prosemirrorDocFromCRDT, applyTransaction } from "./bridge"

import type { FormatOp, ResolvedOp } from "./operations"
import type { DocSchema } from "./schema"

const editorNode = document.querySelector("#editor")
const schema = new Schema(schemaSpec)

const richTextKeymap = {
    ...baseKeymap,
    "Mod-b": toggleMark(schema.marks.strong),
    "Mod-i": toggleMark(schema.marks.em),
}

let doc = new Micromerge("abcd")

// Initialize some content
doc.change([
    { path: [], action: "makeList", key: "content" },
    {
        path: ["content"],
        action: "insert",
        index: 0,
        values: ["h", "e", "l", "l", "o"],
    },
])

console.log("init object", doc.root)

// TODO: Not a global singleton.
let OP_ID: number = 0

if (editorNode) {
    // Generate an empty document conforming to the schema,
    // and a default selection at the start of the document.
    let state = EditorState.create({
        schema,
        plugins: [keymap(richTextKeymap)],
        doc: prosemirrorDocFromCRDT({ schema, doc: doc.root }),
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
            console.groupCollapsed("dispatch", txn)
            let state = view.state

            // Compute a new automerge doc and selection point
            applyTransaction({ doc, txn })

            // Derive a new PM doc from the new CRDT doc
            const newProsemirrorDoc = prosemirrorDocFromCRDT({
                schema,
                doc: doc.root,
            })

            // Apply a transaction that swaps out the new doc in the editor state
            state = state.apply(
                state.tr.replace(
                    0,
                    state.doc.content.size,
                    new Slice(newProsemirrorDoc.content, 0, 0),
                ),
            )

            // Now that we have a new doc, we can compute the new selection.
            // We simply copy over the positions from the selection on the original txn,
            // but resolve them into the new doc.
            // (It doesn't work to just use the selection directly off the txn,
            // because that has pointers into the old stale doc state)
            const newSelection = new TextSelection(
                state.doc.resolve(txn.selection.anchor),
                state.doc.resolve(txn.selection.head),
            )

            // Apply a transaction that sets the new selection
            state = state.apply(state.tr.setSelection(newSelection))

            // Great, now we have our final state! We finish by updating the view.
            view.updateState(state)

            console.log(
                "steps",
                txn.steps.map(s => s.toJSON()),
                "newState",
                state,
            )
            console.groupEnd()
        },
    })
    window.view = view
}

//
