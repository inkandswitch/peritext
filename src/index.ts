import Automerge from "automerge"
import {
    EditorState,
    Transaction,
    TextSelection,
} from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Mark, Schema, Slice, Node } from "prosemirror-model"
import { baseKeymap } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { schemaSpec } from "./schema"
import sortBy from 'lodash/sortBy'

const editorNode = document.querySelector("#editor")
const schema = new Schema(schemaSpec)

type InlineFormatOp = {
    start: Automerge.Cursor,
    end: Automerge.Cursor,
    format: { [key: string]: boolean }
}

type FormatOp = InlineFormatOp // more coming soon...

type RichTextDoc = {
    content: Automerge.Text
    formatOps: Automerge.List<FormatOp>
}

let doc = Automerge.from<RichTextDoc>({
    content: new Automerge.Text("Welcome to the Peritext editor!"),
    formatOps: []
})

// Start off the doc with a single formatting span from characters 2 - 5.
doc = Automerge.change(doc, d => {
    d.formatOps.push({
        start: d.content.getCursorAt(2),
        end: d.content.getCursorAt(5),
        format: { bold: true }
    })
})

// Given an automerge doc representation, produce a prosemirror doc.
// In the future, will handle fancier stuff like formatting.
function prosemirrorDocFromAutomergeDoc(doc: RichTextDoc) {
    const textContent = doc.content.toString()
    // for now, we assume spans don't overlap.
    // in the future we will need to flatten to meet this assumption.
    const sortedFormatOps = sortBy(doc.formatOps, (op: FormatOp) => op.start.index)

    let current = 0
    const nodes: Node[] = []

    for (const formatOp of sortedFormatOps) {
        const nodeBeforeSpan = schema.text(textContent.slice(current, (formatOp.start.index - current)))
        const nodeInsideSpan =
            schema.text(
                textContent.slice(formatOp.start.index, (formatOp.end.index - formatOp.start.index)),
                [schema.mark("strong")]
            )
        current = formatOp.end.index

        nodes.concat([nodeBeforeSpan, nodeInsideSpan])
    }

    if(current < textContent.length) {
        nodes.push(schema.text(textContent.slice(current, (textContent.length - current))))
    }

    return schema.node("doc", undefined, [
        schema.node("paragraph", undefined, nodes),
    ])

    return schema.node("doc", undefined, [
        schema.node("paragraph", undefined, [
            schema.text(doc.content.toString(), [schema.mark("strong")]),
        ]),
    ])
}

// Given an Automerge Doc and a Prosemirror Transaction, return an updated Automerge Doc
// Note: need to derive a PM doc from the new Automerge doc later!
// TODO: why don't we need to update the selection when we do insertions?
function applyTransaction(
    doc: RichTextDoc,
    txn: Transaction,
): RichTextDoc {
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
        }

        // handle deletion
        if (step.stepType === "replace" && !step.slice) {
            newDoc = Automerge.change(doc, doc => {
                if (doc.content.deleteAt) {
                    doc.content.deleteAt(step.from - 1, step.to - step.from)
                }
            })
        }
    })

    return newDoc
}

if (editorNode) {
    // Generate an empty document conforming to the schema,
    // and a default selection at the start of the document.
    let state = EditorState.create({
        schema,
        plugins: [keymap(baseKeymap)],
        doc: prosemirrorDocFromAutomergeDoc(doc)
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
            console.log("")
            console.log("dispatch", Math.random().toPrecision(3), txn)
            let state = view.state

            // Compute a new automerge doc and selection point
            const newDoc = applyTransaction(doc, txn)
            doc = newDoc // store updated Automerge doc in our global mutable state

            console.log("first span indexes:", doc.formatOps[0].start.index, doc.formatOps[0].end.index)

            // Derive a new PM doc from the new Automerge doc
            const newProsemirrorDoc = prosemirrorDocFromAutomergeDoc(doc)

            // Apply a transaction that swaps out the new doc in the editor state
            state = state.apply(
                state.tr.replace(
                    0,
                    state.doc.content.size,
                    new Slice(newProsemirrorDoc.content, 0, 0)
                )
            )

            // Now that we have a new doc, we can compute the new selection.
            // We simply copy over the positions from the selection on the original txn,
            // but resolve them into the new doc.
            // (It doesn't work to just use the selection directly off the txn,
            // because that has pointers into the old stale doc state)
            const newSelection = new TextSelection(
                state.doc.resolve(txn.selection.anchor),
                state.doc.resolve(txn.selection.head)
            )

            // Apply a transaction that sets the new selection
            state = state.apply(
                state.tr.setSelection(newSelection)
            )

            // Great, now we have our final state! We finish by updating the view.
            view.updateState(state)

            console.log(
                "steps",
                txn.steps.map(s => s.toJSON()),
                "newState",
                state
            )
        },
    })
    window.view = view
}

//