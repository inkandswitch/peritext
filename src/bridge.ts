/**
 * Logic for interfacing between ProseMirror and CRDT.
 */

import Micromerge from "./micromerge"
import { EditorState, Transaction, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Schema, Slice, Node, ResolvedPos } from "prosemirror-model"
import { baseKeymap, toggleMark } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { schemaSpec } from "./schema"
import * as crdt from "./crdt"
import { ReplaceStep, AddMarkStep, RemoveMarkStep } from "prosemirror-transform"
import { ChangeQueue } from "./changeQueue"
import type { DocSchema } from "./schema"
import type { Publisher } from "./pubsub"
import type { FormatSpanWithText, Cursor } from "./micromerge"

const schema = new Schema(schemaSpec)

const richTextKeymap = {
    ...baseKeymap,
    "Mod-b": toggleMark(schema.marks.strong),
    "Mod-i": toggleMark(schema.marks.em),
}

type SelectionPos = Cursor | "_head"
type Selection = {
    anchor: SelectionPos
    head: SelectionPos
} | null

export type Editor = {
    doc: Micromerge
    view: EditorView
    queue: ChangeQueue

    // Todo: eventually we don't want to manage selection as cursors;
    // incrementally updating the prosemirror doc should mean that
    // prosemirror can handle selection updates itself.
    // In the meantime, we store selections here as cursors pointing to characters;
    // the rule is that the selection is _after_ the given character.
    // If the selection is at the very beginning of the doc, we represent that with a
    // special value of "_head", inspired by Automerge's similar approach for list insertion.
    selection: Selection
}

function createNewProsemirrorState(
    state: EditorState,
    spans: FormatSpanWithText[],
) {
    // Derive a new PM doc from the new CRDT doc
    const newProsemirrorDoc = prosemirrorDocFromCRDT({ schema, spans })

    // Apply a transaction that swaps out the new doc in the editor state
    state = state.apply(
        state.tr.replace(
            0,
            state.doc.content.size,
            new Slice(newProsemirrorDoc.content, 0, 0),
        ),
    )

    return state
}

// Resolve a SelectionPosition using cursors into a Prosemirror position
function prosemirrorPosFromSelectionPos(
    selectionPos: SelectionPos,
    state: EditorState,
    doc: Micromerge,
): ResolvedPos {
    let position
    if (selectionPos === "_head") {
        position = 0
    } else {
        // Need to add 1 to represent position after the character pointed to by cursor
        position = doc.resolveCursor(selectionPos) + 1
    }

    // We add 1 here because we have a position in our content string,
    // but prosemirror wants us to give it a position in the overall doc;
    // adding 1 accounts for our paragraph node.
    // When we have more nodes we may need to revisit this.
    return state.doc.resolve(position + 1)
}

// Returns an updated Prosemirror editor state where
// the selection has been updated to match the given Selection
// that we manage using Micromerge Cursors.
function updateProsemirrorSelection(
    state: EditorState,
    selection: Selection,
    doc: Micromerge,
): EditorState {
    if (selection === null) return state

    const newSelection = new TextSelection(
        prosemirrorPosFromSelectionPos(selection.anchor, state, doc),
        prosemirrorPosFromSelectionPos(selection.head, state, doc),
    )

    // Apply a transaction that sets the new selection
    return state.apply(state.tr.setSelection(newSelection))
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
    queue.start()
    const doc = crdt.create({ actorId })
    let selection: Selection = null

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
        let state = createNewProsemirrorState(
            view.state,
            doc.getTextWithFormatting(["content"]),
        )
        state = updateProsemirrorSelection(state, selection, doc)
        view.updateState(state)
    })

    // Generate an empty document conforming to the schema,
    // and a default selection at the start of the document.
    const state = EditorState.create({
        schema,
        plugins: [keymap(richTextKeymap)],
        doc: prosemirrorDocFromCRDT({
            schema,
            spans: doc.getTextWithFormatting(["content"]),
        }),
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
            console.groupCollapsed("dispatch", txn.steps[0])

            // Compute a new automerge doc and selection point
            applyTransaction({ doc, txn, queue })

            let state = view.state

            // If the transaction has steps, then go through our CRDT and get a new state.
            // (If it doesn't have steps, that means it's purely a selection update.)
            if (txn.steps.length > 0) {
                state = createNewProsemirrorState(
                    state,
                    doc.getTextWithFormatting(["content"]),
                )
            }

            console.log("new state", state)
            console.log(txn.selection)

            // Convert the new selection into cursors
            const anchorPos = txn.selection.$anchor.parentOffset
            const headPos = txn.selection.$head.parentOffset

            // Update the editor we manage to store the selection in terms of cursors
            selection = {
                anchor:
                    anchorPos === 0
                        ? ("_head" as const)
                        : doc.getCursor(["content"], anchorPos - 1),
                head:
                    headPos === 0
                        ? ("_head" as const)
                        : doc.getCursor(["content"], headPos - 1),
            }

            state = updateProsemirrorSelection(state, selection, doc)

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

    return { doc, view, queue, selection }
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
    spans: FormatSpanWithText[]
}): Node {
    const { schema, spans } = args

    // Prosemirror doesn't allow for empty text nodes;
    // if our doc is empty, we short-circuit and don't add any text nodes.
    if (spans.length === 1 && spans[0].text === "") {
        return schema.node("doc", undefined, [schema.node("paragraph", [])])
    }

    const result = schema.node("doc", undefined, [
        schema.node(
            "paragraph",
            undefined,
            spans.map(span => {
                const marks = []
                for (const [markType, active] of Object.entries(span.marks)) {
                    if (active) {
                        marks.push(markType)
                    }
                }
                return schema.text(
                    span.text,
                    marks.map(m => schema.mark(m)),
                )
            }),
        ),
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
            operations.push({
                path: ["content"],
                action: "addMark",
                start: contentPosFromProsemirrorPos(step.from),
                end: contentPosFromProsemirrorPos(step.to - 1),
                markType: step.mark.type.name,
            })
        } else if (step instanceof RemoveMarkStep) {
            operations.push({
                path: ["content"],
                action: "removeMark",
                start: contentPosFromProsemirrorPos(step.from),
                end: contentPosFromProsemirrorPos(step.to - 1),
                markType: step.mark.type.name,
            })
        }
    }

    if (operations.length > 0) {
        const change = doc.change(operations)
        queue.enqueue(change)
    }
}
