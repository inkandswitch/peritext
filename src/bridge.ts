/**
 * Logic for interfacing between ProseMirror and CRDT.
 */

import Micromerge, { OperationPath, Patch } from "./micromerge"
import { EditorState, TextSelection, Transaction } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Schema, Slice, Node, Fragment, Mark } from "prosemirror-model"
import { baseKeymap, Command, Keymap, toggleMark } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { ALL_MARKS, isMarkType, MarkType, schemaSpec } from "./schema"
import { ReplaceStep, AddMarkStep, RemoveMarkStep } from "prosemirror-transform"
import { ChangeQueue } from "./changeQueue"
import type { DocSchema } from "./schema"
import type { Publisher } from "./pubsub"
import type { ActorId, Char, Change, Operation as InternalOperation, InputOperation } from "./micromerge"
import { MarkMap, FormatSpanWithText, MarkValue } from "./peritext"
import type { Comment, CommentId } from "./comment"
import { v4 as uuid } from "uuid"
import { clamp } from "lodash"

export const schema = new Schema(schemaSpec)

export type RootDoc = {
    text: Array<Char>
    comments: Record<CommentId, Comment>
}

// This is a factory which returns a Prosemirror command.
// The Prosemirror command adds a mark to the document.
// The mark takes on the position of the current selection,
// and has the given type and attributes.
// (The structure/usage of this is similar to the toggleMark command factory
// built in to prosemirror)
function addMark<M extends MarkType>(args: { markType: M; makeAttrs: () => Omit<MarkValue[M], "opId" | "active"> }) {
    const { markType, makeAttrs } = args
    const command: Command<DocSchema> = (
        state: EditorState,
        dispatch: ((t: Transaction<DocSchema>) => void) | undefined,
    ) => {
        const tr = state.tr
        const { $from, $to } = state.selection.ranges[0]
        const from = $from.pos,
            to = $to.pos
        tr.addMark(from, to, schema.marks[markType].create(makeAttrs()))
        if (dispatch !== undefined) {
            dispatch(tr)
        }
        return true
    }
    return command
}

const richTextKeymap: Keymap<DocSchema> = {
    ...baseKeymap,
    "Mod-b": toggleMark(schema.marks.strong),
    "Mod-i": toggleMark(schema.marks.em),
    "Mod-e": addMark({
        markType: "comment",
        makeAttrs: () => ({ id: uuid() }),
    }),
    "Mod-k": addMark({
        markType: "link",
        makeAttrs: () => ({
            url: `https://www.google.com/search?q=${uuid()}`,
        }),
    }),
}

export type Editor = {
    doc: Micromerge
    view: EditorView
    queue: ChangeQueue
    outputDebugForChange: (change: Change) => void
}

const describeMarkType = (markType: string): string => {
    switch (markType) {
        case "em":
            return "italic"
        case "strong":
            return "bold"
        default:
            return markType
    }
}

// Returns a natural language description of an op in our CRDT.
// Just for demo / debug purposes, doesn't cover all cases
function describeOp(op: InternalOperation): string {
    if (op.action === "set" && op.elemId !== undefined) {
        return `${op.value}`
    } else if (op.action === "del" && op.elemId !== undefined) {
        return `❌ <strong>${String(op.elemId)}</strong>`
    } else if (op.action === "addMark") {
        return `🖌 format <strong>${describeMarkType(op.markType)}</strong>`
    } else if (op.action === "removeMark") {
        return `🖌 unformat <strong>${op.markType}</strong>`
    } else if (op.action === "makeList") {
        return `🗑 reset`
    } else {
        return op.action
    }
}

/** Initialize multiple Micromerge docs to all have same base editor state.
 *  The key is that all docs get initialized with a single change that originates
 *  on one of the docs; this avoids weird issues where each doc independently
 *  tries to initialize the basic structure of the document.
 */
export const initializeDocs = (docs: Micromerge[], initialInputOps?: InputOperation[]): void => {
    const inputOps: InputOperation[] = [{ path: [], action: "makeList", key: Micromerge.contentKey }]
    if (initialInputOps) {
        inputOps.push(...initialInputOps)
    }
    const { change: initialChange } = docs[0].change(inputOps)
    for (const doc of docs.slice(1)) {
        doc.applyChange(initialChange)
    }
}

/** Extends a Prosemirror Transaction with new steps incorporating
 *  the effects of a Micromerge Patch.
 *
 *  @param transaction - the original transaction to extend
 *  @param patch - the Micromerge Patch to incorporate
 *  @returns
 *      transaction: a Transaction that includes additional steps representing the patch
 *      startPos: the Prosemirror position where the patch's effects start
 *      endPos: the Prosemirror position where the patch's effects end
 *    */
export const extendProsemirrorTransactionWithMicromergePatch = (
    transaction: Transaction,
    patch: Patch,
): { transaction: Transaction; startPos: number; endPos: number } => {
    // console.log("applying patch", patch)
    switch (patch.action) {
        case "insert": {
            const index = prosemirrorPosFromContentPos(patch.index)
            return {
                transaction: transaction.replace(
                    index,
                    index,
                    new Slice(
                        Fragment.from(schema.text(patch.values[0], getProsemirrorMarksForMarkMap(patch.marks))),
                        0,
                        0,
                    ),
                ),
                startPos: index,
                endPos: index + 1,
            }
        }

        case "delete": {
            const index = prosemirrorPosFromContentPos(patch.index)
            return {
                transaction: transaction.replace(index, index + patch.count, Slice.empty),
                startPos: index,
                endPos: index,
            }
        }

        case "addMark": {
            return {
                transaction: transaction.addMark(
                    prosemirrorPosFromContentPos(patch.startIndex),
                    prosemirrorPosFromContentPos(patch.endIndex),
                    schema.mark(patch.markType, patch.attrs),
                ),
                startPos: prosemirrorPosFromContentPos(patch.startIndex),
                endPos: prosemirrorPosFromContentPos(patch.endIndex),
            }
        }
        case "removeMark": {
            return {
                transaction: transaction.removeMark(
                    prosemirrorPosFromContentPos(patch.startIndex),
                    prosemirrorPosFromContentPos(patch.endIndex),
                    schema.mark(patch.markType, patch.attrs),
                ),
                startPos: prosemirrorPosFromContentPos(patch.startIndex),
                endPos: prosemirrorPosFromContentPos(patch.endIndex),
            }
        }
        case "makeList": {
            return {
                transaction: transaction.delete(0, transaction.doc.content.size),
                startPos: 0,
                endPos: 0,
            }
        }
    }
    unreachable(patch)
}

/** Construct a Prosemirror editor instance on a DOM node, and bind it to a Micromerge doc  */
export function createEditor(args: {
    actorId: ActorId
    editorNode: Element
    changesNode: Element
    doc: Micromerge
    publisher: Publisher<Array<Change>>
    editable: boolean
    handleClickOn?: (
        this: unknown,
        view: EditorView<Schema>,
        pos: number,
        node: Node<Schema>,
        nodePos: number,
        event: MouseEvent,
        direct: boolean,
    ) => boolean
    onRemotePatchApplied?: (args: {
        transaction: Transaction
        view: EditorView
        startPos: number
        endPos: number
    }) => Transaction
}): Editor {
    const { actorId, editorNode, changesNode, doc, publisher, handleClickOn, onRemotePatchApplied, editable } = args
    const queue = new ChangeQueue({
        handleFlush: (changes: Array<Change>) => {
            publisher.publish(actorId, changes)
        },
    })
    queue.start()

    const outputDebugForChange = (change: Change) => {
        const opsDivs = change.ops.map((op: InternalOperation) => `<div class="op">${describeOp(op)}</div>`)

        for (const divHtml of opsDivs) {
            changesNode.insertAdjacentHTML("beforeend", divHtml)
        }
        changesNode.scrollTop = changesNode.scrollHeight
    }

    publisher.subscribe(actorId, incomingChanges => {
        if (incomingChanges.length === 0) {
            return
        }

        let state = view.state

        // For each incoming change, we:
        // - retrieve Patches from Micromerge describing the effect of applying the change
        // - construct a Prosemirror Transaction representing those effecst
        // - apply that Prosemirror Transaction to the document
        for (const change of incomingChanges) {
            // Create a transaction that will accumulate the effects of our patches
            let transaction = state.tr

            const patches = doc.applyChange(change)
            for (const patch of patches) {
                // Get a new Prosemirror transaction containing the effects of the Micromerge patch
                const result = extendProsemirrorTransactionWithMicromergePatch(transaction, patch)
                let { transaction: newTransaction } = result
                const { startPos, endPos } = result

                // If this editor has a callback function defined for handling a remote patch being applied,
                // apply that callback and give it the chance to extend the transaction.
                // (e.g. this can be used to visualize changes by adding new marks.)
                if (onRemotePatchApplied) {
                    newTransaction = onRemotePatchApplied({
                        transaction: newTransaction,
                        view,
                        startPos,
                        endPos,
                    })
                }

                // Assign the newly modified transaction
                transaction = newTransaction
            }
            state = state.apply(transaction)
        }

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
        handleClickOn,
        editable: () => editable,
        // We intercept local Prosemirror transactions and derive Micromerge changes from them
        dispatchTransaction: (txn: Transaction) => {
            let state = view.state

            // Apply a corresponding change to the Micromerge document.
            // We observe a Micromerge Patch from applying the change, and
            // apply its effects to our local Prosemirror doc.
            const { change, patches } = applyProsemirrorTransactionToMicromergeDoc({ doc, txn })
            if (change) {
                let transaction = state.tr
                for (const patch of patches) {
                    const { transaction: newTxn } = extendProsemirrorTransactionWithMicromergePatch(transaction, patch)
                    transaction = newTxn
                }
                state = state.apply(transaction)
                outputDebugForChange(change)

                // Broadcast the change to remote peers
                queue.enqueue(change)
            }

            // If this transaction updated the local selection, we need to
            // make sure that's reflected in the editor state.
            // (Roundtripping through Micromerge won't do that for us, since
            // selection state is not part of the document state.)
            if (txn.selectionSet) {
                state = state.apply(
                    state.tr.setSelection(
                        new TextSelection(
                            state.doc.resolve(txn.selection.anchor),
                            state.doc.resolve(txn.selection.head),
                        ),
                    ),
                )
            }

            view.updateState(state)
            console.groupEnd()
        },
    })

    return { doc, view, queue, outputDebugForChange }
}

/**
 * Converts a position in the Prosemirror doc to an offset in the CRDT content string.
 * For now we only have a single node so this is relatively trivial.
 * In the future when things get more complicated with multiple block nodes,
 * we can probably take advantage
 * of the additional metadata that Prosemirror can provide by "resolving" the position.
 * @param position : an unresolved Prosemirror position in the doc;
 * @param doc : the Prosemirror document containing the position
 */
function contentPosFromProsemirrorPos(position: number, doc: Node<DocSchema>): number {
    // The -1 accounts for the extra character at the beginning of the PM doc
    // containing the beginning of the paragraph.
    // In some rare cases we can end up with incoming positions outside of the single
    // paragraph node (e.g., when the user does cmd-A to select all),
    // so we need to be sure to clamp the resulting position to inside the paragraph node.
    return clamp(position - 1, 0, doc.textContent.length)
}

/** Given an index in the text CRDT, convert to an index in the Prosemirror editor.
 *  The Prosemirror editor has a paragraph node which we ignore because we only handle inline;
 *  the beginning of the paragraph takes up one position in the Prosemirror indexing scheme.
 *  This means we have to add 1 to CRDT indexes to get correct Prosemirror indexes.
 */
function prosemirrorPosFromContentPos(position: number) {
    return position + 1
}

function getProsemirrorMarksForMarkMap<T extends MarkMap>(markMap: T): Mark[] {
    const marks = []
    for (const markType of ALL_MARKS) {
        const markValue = markMap[markType]
        if (markValue === undefined) {
            continue
        }
        if (Array.isArray(markValue)) {
            for (const value of markValue) {
                marks.push(schema.mark(markType, value))
            }
        } else {
            if (markValue) {
                marks.push(schema.mark(markType, markValue))
            }
        }
    }
    return marks
}

// Given a micromerge doc representation, produce a prosemirror doc.
export function prosemirrorDocFromCRDT(args: { schema: DocSchema; spans: FormatSpanWithText[] }): Node {
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
                return schema.text(span.text, getProsemirrorMarksForMarkMap(span.marks))
            }),
        ),
    ])

    return result
}

// Given a CRDT Doc and a Prosemirror Transaction, update the micromerge doc.
export function applyProsemirrorTransactionToMicromergeDoc(args: { doc: Micromerge; txn: Transaction<DocSchema> }): {
    change: Change | null
    patches: Patch[]
} {
    const { doc, txn } = args
    const operations: Array<InputOperation> = []

    for (const step of txn.steps) {
        if (step instanceof ReplaceStep) {
            if (step.slice) {
                // handle insertion
                if (step.from !== step.to) {
                    operations.push({
                        path: [Micromerge.contentKey],
                        action: "delete",
                        index: contentPosFromProsemirrorPos(step.from, txn.before),
                        count:
                            contentPosFromProsemirrorPos(step.to, txn.before) -
                            contentPosFromProsemirrorPos(step.from, txn.before),
                    })
                }

                const insertedContent = step.slice.content.textBetween(0, step.slice.content.size)

                operations.push({
                    path: [Micromerge.contentKey],
                    action: "insert",
                    index: contentPosFromProsemirrorPos(step.from, txn.before),
                    values: insertedContent.split(""),
                })
            } else {
                // handle deletion
                operations.push({
                    path: [Micromerge.contentKey],
                    action: "delete",
                    index: contentPosFromProsemirrorPos(step.from, txn.before),
                    count:
                        contentPosFromProsemirrorPos(step.to, txn.before) -
                        contentPosFromProsemirrorPos(step.from, txn.before),
                })
            }
        } else if (step instanceof AddMarkStep) {
            if (!isMarkType(step.mark.type.name)) {
                throw new Error(`Invalid mark type: ${step.mark.type.name}`)
            }

            const partialOp: {
                action: "addMark"
                path: OperationPath
                startIndex: number
                endIndex: number
            } = {
                action: "addMark",
                path: [Micromerge.contentKey],
                startIndex: contentPosFromProsemirrorPos(step.from, txn.before),
                endIndex: contentPosFromProsemirrorPos(step.to, txn.before),
            }

            if (step.mark.type.name === "comment") {
                if (!step.mark.attrs || typeof step.mark.attrs.id !== "string") {
                    throw new Error("Expected comment mark to have id attrs")
                }
                operations.push({
                    ...partialOp,
                    markType: step.mark.type.name,
                    attrs: step.mark.attrs as { id: string },
                })
            } else if (step.mark.type.name === "link") {
                if (!step.mark.attrs || typeof step.mark.attrs.url !== "string") {
                    throw new Error("Expected link mark to have url attrs")
                }
                operations.push({
                    ...partialOp,
                    markType: step.mark.type.name,
                    attrs: step.mark.attrs as { url: string },
                })
            } else {
                operations.push({
                    ...partialOp,
                    markType: step.mark.type.name,
                })
            }
        } else if (step instanceof RemoveMarkStep) {
            if (!isMarkType(step.mark.type.name)) {
                throw new Error(`Invalid mark type: ${step.mark.type.name}`)
            }

            const partialOp: {
                action: "removeMark"
                path: OperationPath
                startIndex: number
                endIndex: number
            } = {
                action: "removeMark",
                path: [Micromerge.contentKey],
                startIndex: contentPosFromProsemirrorPos(step.from, txn.before),
                endIndex: contentPosFromProsemirrorPos(step.to, txn.before),
            }

            if (step.mark.type.name === "comment") {
                if (!step.mark.attrs || typeof step.mark.attrs.id !== "string") {
                    throw new Error("Expected comment mark to have id attrs")
                }
                operations.push({
                    ...partialOp,
                    markType: step.mark.type.name,
                    attrs: step.mark.attrs as { id: string },
                })
            } else {
                operations.push({
                    ...partialOp,
                    markType: step.mark.type.name,
                })
            }
        }
    }

    if (operations.length > 0) {
        return doc.change(operations)
    } else {
        return { change: null, patches: [] }
    }
}
