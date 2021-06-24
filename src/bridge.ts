/**
 * Logic for interfacing between ProseMirror and CRDT.
 */

import Micromerge from "./micromerge"
import { EditorState, Transaction, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import {
    Schema,
    Slice,
    Node,
    ResolvedPos,
    MarkType as BaseMarkType,
} from "prosemirror-model"
import { baseKeymap, toggleMark } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import {
    isMarkType,
    MarkAttributes,
    markSpec,
    MarkType,
    schemaSpec,
} from "./schema"
import { ReplaceStep, AddMarkStep, RemoveMarkStep } from "prosemirror-transform"
import { ChangeQueue } from "./changeQueue"
import type { DocSchema } from "./schema"
import type { Publisher } from "./pubsub"
import type {
    FormatSpanWithText,
    Cursor,
    Operation as InternalOperation,
    Change,
    InputOperation,
} from "./micromerge"

const schema = new Schema(schemaSpec)
const HEAD = "_head"

// This is a factory which returns a Prosemirror command.
// The Prosemirror command adds a mark to the document.
// The mark takes on the position of the current selection,
// and has the given type and attributes.
// (The structure/usage of this is similar to the toggleMark command factory
// built in to prosemirror)
function addMark(markType: BaseMarkType, attrs: MarkAttributes) {
    return (
        state: EditorState,
        dispatch: (t: Transaction<Schema<MarkType>>) => void,
    ) => {
        const tr = state.tr
        const { $from, $to } = state.selection.ranges[0]
        const from = $from.pos,
            to = $to.pos
        tr.addMark(from, to, markType.create(attrs))
        dispatch(tr)
        return true
    }
}

const richTextKeymap = {
    ...baseKeymap,
    "Mod-b": toggleMark(schema.marks.strong),
    "Mod-i": toggleMark(schema.marks.em),
    "Mod-Shift-c": addMark(schema.marks.comment, { text: "A random comment" }),
    "Mod-k": addMark(schema.marks.link, { href: "https://www.google.com" }),
}

// Represents a selection position: either after a character, or at the beginning
type SelectionPos = Cursor | typeof HEAD
type Selection =
    | {
          anchor: SelectionPos
          head: SelectionPos
      }
    | undefined

export type Editor = {
    doc: Micromerge<MarkType>
    view: EditorView
    queue: ChangeQueue<MarkType>

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
    doc: Micromerge<MarkType>,
): ResolvedPos {
    let position: number
    if (selectionPos === HEAD) {
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
    doc: Micromerge<MarkType>,
): EditorState {
    if (selection === undefined) {
        return state
    }

    const newSelection = new TextSelection(
        prosemirrorPosFromSelectionPos(selection.anchor, state, doc),
        prosemirrorPosFromSelectionPos(selection.head, state, doc),
    )

    // Apply a transaction that sets the new selection
    return state.apply(state.tr.setSelection(newSelection))
}

// Returns a natural language description of an op in our CRDT.
// Just for demo / debug purposes, doesn't cover all cases
function describeOp(op: InternalOperation<MarkType>): string {
    if (op.action === "set" && op.elemId !== undefined) {
        return `insert <strong>${op.value}</strong> after <strong>${String(
            op.elemId,
        )}</strong>`
    } else if (op.action === "del" && op.elemId !== undefined) {
        return `delete <strong>${String(op.elemId)}</strong>`
    } else if (op.action === "addMark") {
        return `add mark <strong>${op.markType}</strong> from <strong>${op.start}</strong> to <strong>${op.end}</strong>`
    } else if (op.action === "removeMark") {
        return `remove mark <strong>${op.markType}</strong> from <strong>${op.start}</strong> to <strong>${op.end}</strong>`
    } else {
        return op.action
    }
}

export function createEditor(args: {
    actorId: string
    editorNode: Element
    changesNode: Element
    initialValue: string
    publisher: Publisher<Array<Change<MarkType>>>
}): Editor {
    const { actorId, editorNode, changesNode, initialValue, publisher } = args
    const queue = new ChangeQueue({
        handleFlush: (changes: Array<Change<MarkType>>) => {
            publisher.publish(actorId, changes)
        },
    })
    queue.start()
    const doc = new Micromerge(actorId)
    let selection: Selection = undefined

    const initialChange = doc.change([
        { path: [], action: "makeList", key: Micromerge.contentKey },
        {
            path: [Micromerge.contentKey],
            action: "insert",
            index: 0,
            values: initialValue.split(""),
        },
    ])
    queue.enqueue(initialChange)

    const outputDebugForChange = (change: Change<MarkType>) => {
        const opsHtml = change.ops
            .map(
                (op: InternalOperation<MarkType>) =>
                    `<div class="change-description">${describeOp(op)}</div>`,
            )
            .join("")

        changesNode.insertAdjacentHTML(
            "beforeend",
            `<div class="change from-${change.actor}">
                <div class="ops">${opsHtml}</div>
            </div>`,
        )
        changesNode.scrollTop = changesNode.scrollHeight
    }

    publisher.subscribe(actorId, incomingChanges => {
        for (const change of incomingChanges) {
            outputDebugForChange(change)
            doc.applyChange(change)
        }
        let state = createNewProsemirrorState(
            view.state,
            doc.getTextWithFormatting([Micromerge.contentKey]),
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
            spans: doc.getTextWithFormatting([Micromerge.contentKey]),
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
            const change = applyTransaction({ doc, txn })
            if (change) {
                queue.enqueue(change)
                outputDebugForChange(change)
            }

            let state = view.state

            // If the transaction has steps, then go through our CRDT and get a new state.
            // (If it doesn't have steps, that's probably just a selection update,
            // because by definition it cannot be updating the document in any way)
            if (txn.steps.length > 0) {
                state = createNewProsemirrorState(
                    state,
                    doc.getTextWithFormatting([Micromerge.contentKey]),
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
                        ? HEAD
                        : // We subtract 1 here because a PM position is before a character,
                          // but our SelectionPos are after a character
                          doc.getCursor([Micromerge.contentKey], anchorPos - 1),
                head:
                    headPos === 0
                        ? HEAD
                        : doc.getCursor([Micromerge.contentKey], headPos - 1),
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
                return schema.text(
                    span.text,
                    span.marks.map(mark =>
                        schema.mark(
                            mark.markType,

                            // TODO: this is quite awkward and needs a rethink.
                            // For a mark that allows a set of attributes values,
                            // we don't have a great way of telling Prosemirror about the multiple values;
                            // so we're forced to just take the first one here which is insufficient.
                            // Maybe a better thing to do would be to just have the attrs be a list?

                            markSpec[mark.markType].allowMultiple
                                ? [...mark.attrs][0]
                                : mark.attrs,
                        ),
                    ),
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
    doc: Micromerge<MarkType>
    txn: Transaction<DocSchema>
}): Change<MarkType> | null {
    const { doc, txn } = args
    const operations: Array<InputOperation<MarkType>> = []

    for (const step of txn.steps) {
        console.log("step", step)

        if (step instanceof ReplaceStep) {
            if (step.slice) {
                // handle insertion
                if (step.from !== step.to) {
                    operations.push({
                        path: [Micromerge.contentKey],
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
                    path: [Micromerge.contentKey],
                    action: "insert",
                    index: contentPosFromProsemirrorPos(step.from),
                    values: insertedContent.split(""),
                })
            } else {
                // handle deletion
                operations.push({
                    path: [Micromerge.contentKey],
                    action: "delete",
                    index: contentPosFromProsemirrorPos(step.from),
                    count: step.to - step.from,
                })
            }
        } else if (step instanceof AddMarkStep) {
            if (!isMarkType(step.mark.type.name)) {
                throw new Error(`Invalid mark type: ${step.mark.type.name}`)
            }

            operations.push({
                path: [Micromerge.contentKey],
                action: "addMark",
                start: contentPosFromProsemirrorPos(step.from),
                // The end of a prosemirror addMark step refers to the index _after_ the end,
                // but in the CRDT we use the index of the last character in the range.
                // TODO: define a helper that converts a whole Prosemirror range into a
                // CRDT range, not just a single position at a time.
                end: contentPosFromProsemirrorPos(step.to - 1),
                markType: step.mark.type.name,
                attrs: step.mark.attrs,
            })
        } else if (step instanceof RemoveMarkStep) {
            if (!isMarkType(step.mark.type.name)) {
                throw new Error(`Invalid mark type: ${step.mark.type.name}`)
            }

            operations.push({
                path: [Micromerge.contentKey],
                action: "removeMark",
                start: contentPosFromProsemirrorPos(step.from),
                // Same as above, translate Prosemirror's end range into a Micromerge position
                end: contentPosFromProsemirrorPos(step.to - 1),
                markType: step.mark.type.name,
            })
        }
    }

    if (operations.length > 0) {
        return doc.change(operations)
    } else {
        return null
    }
}
