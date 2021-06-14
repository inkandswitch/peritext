/**
 * Logic for interfacing between ProseMirror and CRDT.
 */

import Micromerge from "./micromerge"
import { EditorState, Transaction, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Schema, Slice, Node } from "prosemirror-model"
import { baseKeymap, toggleMark } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { schemaSpec } from "./schema"
import * as crdt from "./crdt"
import { ReplaceStep, AddMarkStep, RemoveMarkStep } from "prosemirror-transform"
import { ChangeQueue } from "./changeQueue"
import type { DocSchema } from "./schema"
import type { Publisher } from "./pubsub"

type RichTextDoc = {
    /** Array of single characters. */
    content: Array<string>
}

const schema = new Schema(schemaSpec)

const richTextKeymap = {
    ...baseKeymap,
    "Mod-b": toggleMark(schema.marks.strong),
    "Mod-i": toggleMark(schema.marks.em),
}

export type Editor = {
    doc: Micromerge
    view: EditorView
    queue: ChangeQueue
}

function updateProsemirrorView(view: EditorView, doc: RichTextDoc) {
    let state = view.state

    // Derive a new PM doc from the new CRDT doc
    const newProsemirrorDoc = prosemirrorDocFromCRDT({ schema, doc })

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
    // const newSelection = new TextSelection(
    //     state.doc.resolve(txn.selection.anchor),
    //     state.doc.resolve(txn.selection.head),
    // )

    // Apply a transaction that sets the new selection
    // state = state.apply(state.tr.setSelection(newSelection))

    // Great, now we have our final state! We finish by updating the view.
    view.updateState(state)
}

export function createEditor(args: {
    actorId: string
    editorNode: Element
    initialValue: string
    publisher: Publisher<Array<crdt.Change>>
}): Editor {
    const { actorId, editorNode, initialValue, publisher } = args
    const queue = new ChangeQueue({
        handleFlush: (changes: Array<crdt.Change>) => {
            publisher.publish(actorId, changes)
        },
    })
    const doc = crdt.create({ actorId })

    const initialChange = doc.change([
        { path: [], action: "makeList", key: "content" },
        {
            path: ["content"],
            action: "insert",
            index: 0,
            values: initialValue.split(""),
        },
    ])
    queue.enqueue(initialChange)

    publisher.subscribe(actorId, incomingChanges => {
        for (const change of incomingChanges) {
            doc.applyChange(change)
        }
        updateProsemirrorView(view, doc.root)
    })

    // Generate an empty document conforming to the schema,
    // and a default selection at the start of the document.
    const state = EditorState.create({
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

            // Compute a new automerge doc and selection point
            applyTransaction({ doc, txn, queue })

            updateProsemirrorView(view, doc.root)

            console.log(
                "steps",
                txn.steps.map(s => s.toJSON()),
                "newState",
                state,
            )
            console.groupEnd()
        },
    })

    return { doc, view, queue }
}

/**
 * Converts a position in the Prosemirror doc to an offset in the CRDT content string.
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
export function prosemirrorDocFromCRDT(args: {
    schema: DocSchema
    doc: RichTextDoc
}): Node {
    const { schema, doc } = args
    const textContent = doc.content.join("")

    const result = schema.node("doc", undefined, [
        schema.node("paragraph", undefined, [schema.text(textContent)]),
    ])

    return result
}

// Given a CRDT Doc and a Prosemirror Transaction, update the micromerge doc.
// Note: need to derive a PM doc from the new CRDT doc later!
// TODO: why don't we need to update the selection when we do insertions?
export function applyTransaction(args: {
    doc: Micromerge
    txn: Transaction<DocSchema>
    queue: ChangeQueue
}): void {
    const { doc, txn, queue } = args
    const operations: Array<crdt.Operation> = []

    for (const step of txn.steps) {
        console.log("step", step)

        if (step instanceof ReplaceStep) {
            if (step.slice) {
                // handle insertion
                if (step.from !== step.to) {
                    operations.push({
                        path: ["content"],
                        action: "delete",
                        index: contentPosFromProsemirrorPos(step.from),
                        count: step.to - step.from,
                    })
                }

                const insertedContent = step.slice.content.textBetween(
                    0,
                    step.slice.content.size,
                )

                operations.push({
                    path: ["content"],
                    action: "insert",
                    index: contentPosFromProsemirrorPos(step.from),
                    values: insertedContent.split(""),
                })
            } else {
                // handle deletion
                operations.push({
                    path: ["content"],
                    action: "delete",
                    index: contentPosFromProsemirrorPos(step.from),
                    count: step.to - step.from,
                })
            }
        } else if (step instanceof AddMarkStep) {
            console.error("formatting not implemented currently")
        } else if (step instanceof RemoveMarkStep) {
            console.error("formatting not implemented currently")
        }
    }

    if (operations.length > 0) {
        const change = doc.change(operations)
        queue.enqueue(change)
    }
}
