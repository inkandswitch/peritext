/**
 * Logic for interfacing between ProseMirror and CRDT.
 */

import Micromerge, { OperationPath } from "./micromerge"
import { EditorState, Transaction, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Schema, Slice, Node, ResolvedPos } from "prosemirror-model"
import { baseKeymap, Command, Keymap, toggleMark } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { ALL_MARKS, isMarkType, MarkType, schemaSpec } from "./schema"
import { ReplaceStep, AddMarkStep, RemoveMarkStep } from "prosemirror-transform"
import { ChangeQueue } from "./changeQueue"
import type { DocSchema } from "./schema"
import type { Publisher } from "./pubsub"
import type {
    ActorId,
    Char,
    FormatSpanWithText,
    Change,
    Cursor,
    Operation as InternalOperation,
    InputOperation,
} from "./micromerge"
import type { Comment, CommentId } from "./comment"
import { MarkValue } from "./format"
import { v4 as uuid } from "uuid"

const schema = new Schema(schemaSpec)
const HEAD = "_head"

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
function addMark<M extends MarkType>(args: {
    markType: M
    makeAttrs: () => Omit<MarkValue[M], "opId" | "active">
}) {
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

// Represents a selection position: either after a character, or at the beginning
type SelectionPos = Cursor | typeof HEAD
type Selection =
    | {
          anchor: SelectionPos
          head: SelectionPos
      }
    | undefined

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
): { state: EditorState; txn: Transaction<Schema> } {
    // Derive a new PM doc from the new CRDT doc
    const newProsemirrorDoc = prosemirrorDocFromCRDT({ schema, spans })

    const replaceTxn = state.tr.replace(
        0,
        state.doc.content.size,
        new Slice(newProsemirrorDoc.content, 0, 0),
    )

    // Apply a transaction that swaps out the new doc in the editor state
    state = state.apply(replaceTxn)

    return { state, txn: replaceTxn }
}

// Resolve a SelectionPosition using cursors into a Prosemirror position
function prosemirrorPosFromSelectionPos(
    selectionPos: SelectionPos,
    state: EditorState,
    doc: Micromerge,
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
    doc: Micromerge,
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
function describeOp(op: InternalOperation): string {
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

/**
 * Creates a new Micromerge instance wrapping a RootDoc structure.
 */
function createRootDoc(args: { actorId: ActorId; initialValue: string }): {
    doc: Micromerge
    initialChange: Change
} {
    const { actorId, initialValue } = args
    const doc = new Micromerge(actorId)
    const initialChange = doc.change([
        { path: [], action: "makeList", key: Micromerge.contentKey },
        { path: [], action: "makeMap", key: "comments" },
        {
            path: [Micromerge.contentKey],
            action: "insert",
            index: 0,
            values: initialValue.split(""),
        },
    ])
    return {
        doc,
        initialChange,
    }
}

export function createEditor(args: {
    actorId: ActorId
    editorNode: Element
    changesNode: Element
    initialValue: string
    publisher: Publisher<Array<Change>>
    handleClickOn?: (
        this: unknown,
        view: EditorView<Schema>,
        pos: number,
        node: Node<Schema>,
        nodePos: number,
        event: MouseEvent,
        direct: boolean,
    ) => boolean
}): Editor {
    const {
        actorId,
        editorNode,
        changesNode,
        initialValue,
        publisher,
        handleClickOn,
    } = args
    const queue = new ChangeQueue({
        handleFlush: (changes: Array<Change>) => {
            publisher.publish(actorId, changes)
        },
    })
    queue.start()
    let selection: Selection = undefined

    const { initialChange, doc } = createRootDoc({
        actorId,
        initialValue,
    })
    queue.enqueue(initialChange)

    const outputDebugForChange = (change: Change, txn: Transaction<Schema>) => {
        const opsHtml = change.ops
            .map(
                (op: InternalOperation) =>
                    `<div class="change-description">MM: ${describeOp(
                        op,
                    )}</div>`,
            )
            .join("")

        const stepsHtml = txn.steps
            .map(step => {
                let stepText = ""
                if (step instanceof ReplaceStep) {
                    const stepContent = step.slice.content.textBetween(
                        0,
                        step.slice.content.size,
                    )
                    if (step.slice.size === 0) {
                        if (step.to - 1 === step.from) {
                            // single character deletion
                            stepText = `delete ${step.from}`
                        } else {
                            stepText = `delete ${step.from} to ${step.to - 1}`
                        }
                    } else if (step.from === step.to) {
                        stepText = `insert <strong>${stepContent}</strong> at ${step.from}`
                    } else {
                        stepText = `replace ${step.from} to ${step.to} with: <strong>${stepContent}</strong>`
                    }
                } else {
                    stepText = "unknown step"
                }

                return `<div class="prosemirror-step">PM: ${stepText}</div>`
            })
            .join("")

        changesNode.insertAdjacentHTML(
            "beforeend",
            `<div class="change from-${change.actor}">
                <div class="ops">${opsHtml}</div>
                <div class="prosemirror-steps">${stepsHtml}</div>
            </div>`,
        )
        changesNode.scrollTop = changesNode.scrollHeight
    }

    publisher.subscribe(actorId, incomingChanges => {
        if (incomingChanges.length === 0) {
            return
        }

        for (const change of incomingChanges) {
            doc.applyChange(change)

            let { state, txn } = createNewProsemirrorState(
                view.state,
                doc.getTextWithFormatting([Micromerge.contentKey]),
            )
            state = updateProsemirrorSelection(state, selection, doc)
            view.updateState(state)

            outputDebugForChange(change, txn)
        }
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
        // Intercept transactions.
        dispatchTransaction: (txn: Transaction) => {
            console.groupCollapsed("dispatch", txn.steps[0])

            // Compute a new automerge doc and selection point
            const change = applyTransaction({ doc, txn })
            if (change) {
                queue.enqueue(change)
                outputDebugForChange(change, txn)
            }

            let state = view.state

            // If the transaction has steps, then go through our CRDT and get a new state.
            // (If it doesn't have steps, that's probably just a selection update,
            // because by definition it cannot be updating the document in any way)
            if (txn.steps.length > 0) {
                const result = createNewProsemirrorState(
                    state,
                    doc.getTextWithFormatting([Micromerge.contentKey]),
                )
                state = result.state
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
                const marks = []
                for (const markType of ALL_MARKS) {
                    const markValue = span.marks[markType]
                    if (markValue === undefined) {
                        continue
                    }
                    if (Array.isArray(markValue)) {
                        for (const value of markValue) {
                            marks.push(schema.mark(markType, value))
                        }
                    } else {
                        if (markValue.active) {
                            marks.push(schema.mark(markType, markValue))
                        }
                    }
                }
                return schema.text(span.text, marks)
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
}): Change | null {
    const { doc, txn } = args
    const operations: Array<InputOperation> = []

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

            const start = contentPosFromProsemirrorPos(step.from)
            // The end of a prosemirror addMark step refers to the index _after_ the end,
            // but in the CRDT we use the index of the last character in the range.
            // TODO: define a helper that converts a whole Prosemirror range into a
            // CRDT range, not just a single position at a time.
            const end = contentPosFromProsemirrorPos(step.to - 1)

            const partialOp: {
                action: "addMark"
                path: OperationPath
                start: number
                end: number
            } = {
                action: "addMark",
                path: [Micromerge.contentKey],
                start,
                end,
            }

            if (step.mark.type.name === "comment") {
                if (
                    !step.mark.attrs ||
                    typeof step.mark.attrs.id !== "string"
                ) {
                    throw new Error("Expected comment mark to have id attrs")
                }
                operations.push({
                    ...partialOp,
                    markType: step.mark.type.name,
                    attrs: step.mark.attrs as { id: string },
                })
            } else if (step.mark.type.name === "link") {
                if (
                    !step.mark.attrs ||
                    typeof step.mark.attrs.url !== "string"
                ) {
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

            const start = contentPosFromProsemirrorPos(step.from)
            const end = contentPosFromProsemirrorPos(step.to - 1)

            const partialOp: {
                action: "removeMark"
                path: OperationPath
                start: number
                end: number
            } = {
                action: "removeMark",
                path: [Micromerge.contentKey],
                start,
                end,
            }

            if (step.mark.type.name === "comment") {
                if (
                    !step.mark.attrs ||
                    typeof step.mark.attrs.id !== "string"
                ) {
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
        return null
    }
}
