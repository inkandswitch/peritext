import Automerge from "automerge"
import Micromerge from "./micromerge"
import { EditorState, Transaction, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Schema, Slice } from "prosemirror-model"
import { baseKeymap, toggleMark } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { ReplaceStep, AddMarkStep, RemoveMarkStep } from "prosemirror-transform"
import { schemaSpec, isMarkType } from "./schema"

import type { FormatOp, ResolvedOp } from "./operations"
import type { DocSchema } from "./schema"

const editorNode = document.querySelector("#editor")
const schema = new Schema(schemaSpec)

const richTextKeymap = {
    ...baseKeymap,
    "Mod-b": toggleMark(schema.marks.strong),
    "Mod-i": toggleMark(schema.marks.em),
}

type RichTextDoc = {
    content: Automerge.Text
    formatOps: Automerge.List<FormatOp>
}

let doc = new Micromerge("abcd")

// Initialize some content
doc.applyChange(
    doc.change([
        { path: [], action: "makeList", key: "content" },
        {
            path: ["content"],
            action: "insert",
            index: 0,
            values: ["h", "e", "l", "l", "o"],
        },
    ]),
)

console.log("init object", doc.root)

// TODO: Not a global singleton.
let OP_ID: number = 0

/** Given a "from" and "to" position on a Prosemirror step,
 *  return two Automerge cursors denoting the same range in the content string.
 *  Note: Prosemirror's "to" index is the number after the last character;
 *  we need to go left by 1 to find the last character in the range.
 */
function automergeRangeFromProsemirrorRange(
    doc: Automerge.Proxy<RichTextDoc>,
    prosemirrorRange: { from: number; to: number },
): { start: Automerge.Cursor; end: Automerge.Cursor } {
    return {
        start: doc.content.getCursorAt(
            contentPosFromProsemirrorPos(prosemirrorRange.from),
        ),

        end: doc.content.getCursorAt(
            contentPosFromProsemirrorPos(prosemirrorRange.to) - 1,
        ),
    }
}

/**
 * Converts a position in the Prosemirror doc to an offset in the Automerge content string.
 * For now we only have a single node so this is relatively trivial.
 * When things get more complicated with multiple nodes, we can probably take advantage
 * of the additional metadata that Prosemirror can provide by "resolving" the position.
 * @param position : an unresolved Prosemirror position in the doc;
 * @returns
 */
function contentPosFromProsemirrorPos(position: number) {
    return position - 1
}

// Given a micromerge doc representation, produce a prosemirror doc.
function prosemirrorDocFromCRDT(doc: RichTextDoc) {
    const textContent = doc.content.join("")

    const result = schema.node("doc", undefined, [
        schema.node("paragraph", undefined, [schema.text(textContent)]),
    ])

    return result
}

// Given an Automerge Doc and a Prosemirror Transaction, return an updated Automerge Doc
// Note: need to derive a PM doc from the new Automerge doc later!
// TODO: why don't we need to update the selection when we do insertions?
function applyTransaction(txn: Transaction<DocSchema>): RichTextDoc {
    for (const step of txn.steps) {
        console.log("step", step)

        if (step instanceof ReplaceStep) {
            if (step.slice) {
                // handle insertion
                if (step.from !== step.to) {
                    doc.applyChange(
                        doc.change([
                            {
                                path: "content",
                                action: "delete",
                                index: contentPosFromProsemirrorPos(step.from),
                                count: step.to - step.from,
                            },
                        ]),
                    )
                }

                const insertedContent = step.slice.content.textBetween(
                    0,
                    step.slice.content.size,
                )

                doc.applyChange(
                    doc.change([
                        {
                            path: "content",
                            action: "insert",
                            index: contentPosFromProsemirrorPos(step.from),
                            values: insertedContent.split(""),
                        },
                    ]),
                )
            } else {
                // handle deletion
                doc.applyChange(
                    doc.change([
                        {
                            path: "content",
                            action: "delete",
                            index: contentPosFromProsemirrorPos(step.from),
                            count: step.to - step.from,
                        },
                    ]),
                )
            }
        } else if (step instanceof AddMarkStep) {
            console.error("formatting not implemented currently")
        } else if (step instanceof RemoveMarkStep) {
            console.error("formatting not implemented currently")
        }
    }
}

if (editorNode) {
    // Generate an empty document conforming to the schema,
    // and a default selection at the start of the document.
    let state = EditorState.create({
        schema,
        plugins: [keymap(richTextKeymap)],
        doc: prosemirrorDocFromCRDT(doc.root),
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
            console.log("dispatch", Math.random().toPrecision(3), txn)
            let state = view.state

            // Compute a new automerge doc and selection point
            applyTransaction(txn)

            // Derive a new PM doc from the new Automerge doc
            const newProsemirrorDoc = prosemirrorDocFromCRDT(doc.root)

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
        },
    })
    window.view = view
}

//
