// @ts-nocheck

type Path = string[]
type ObjectID = string

import type { ResolvedOp, FormatSpan } from "./operations"
import { compareOpIds } from "./operations"
import { applyOp as applyFormatOp, normalize } from "./format"

export type FormatSpanWithText = FormatSpan & { text: string }

/**
 * Miniature implementation of a subset of Automerge.
 */
export default class Micromerge {
    constructor(actorId) {
        this.actorId = actorId
        this.seq = 0
        this.maxOp = 0
        this.clock = {} // map from actorId to last sequence number seen from that actor
        this.objects = { _root: {} } // objects, keyed by the ID of the operation that created the object
        this.metadata = { _root: { children: {} } } // map from objID to object with CRDT metadata for each object field
        this.formatSpans = {} // map from objID to formatting information for that object
    }

    /**
     * Returns the document root object.
     */
    get root() {
        return this.objects._root
    }

    /**
     * Generates a new change containing operations described in the array `ops`. Returns the change
     * object, which can be JSON-encoded to send to another node.
     */
    change(ops) {
        // Record the dependencies of this change:
        // anything in our clock before we generate the change.
        const deps = Object.assign({}, this.clock)

        // Record a new local seq number in our clock,
        // to remember we've incorporated this new change
        this.seq += 1
        this.clock[this.actorId] = this.seq

        const change = {
            actor: this.actorId,
            seq: this.seq,
            deps,
            startOp: this.maxOp + 1,
            ops: [],
        }

        for (let inputOp of ops) {
            const obj = this.getObjectIdForPath(inputOp.path),
                { action, key, value } = inputOp

            if (Array.isArray(this.objects[obj])) {
                // The operation is modifying a list object
                if (action === "insert") {
                    let elemId =
                        inputOp.index === 0
                            ? "_head"
                            : this.getListElementId(obj, inputOp.index - 1)
                    for (let value of inputOp.values) {
                        elemId = this.makeNewOp(change, {
                            action: "set",
                            obj,
                            elemId,
                            insert: true,
                            value,
                        })
                    }
                } else if (action === "delete") {
                    for (let i = 0; i < inputOp.count; i++) {
                        // It might seem like we should increment the index we delete at
                        // as we delete characters. However, because we delete a character
                        // at each iteration, the start index for the "delete" input operation
                        // always points to the next character to delete, without incrementing.
                        //
                        // For example, see what happens when we delete first 3 chars from index 0:
                        // { action: "delete", index: 0, count: 3 }
                        //
                        // 0123456
                        //
                        // del 0
                        // v
                        // x123456
                        //
                        //  del 0 (= "delete first visible elem")
                        //  v
                        // xx23456
                        //
                        //   del 0 (= "delete first visible elem")
                        //   v
                        // xxx3456
                        const elemId = this.getListElementId(obj, inputOp.index)
                        this.makeNewOp(change, {
                            action: "del",
                            obj,
                            elemId,
                            insert: false,
                        })
                    }
                } else if (action === "addMark" || action === "removeMark") {
                    const start = this.getListElementId(obj, inputOp.start)
                    const end = this.getListElementId(obj, inputOp.end)
                    this.makeNewOp(change, {
                        action,
                        obj,
                        start,
                        end,
                        markType: inputOp.markType,
                    })
                }
            } else {
                // The operation is modifying a map object
                this.makeNewOp(change, {
                    action,
                    obj,
                    key,
                    value,
                    insert: false,
                })
            }
        }

        return change
    }

    /**
     * Returns the ID of the object at a particular path in the document tree.
     */
    getObjectIdForPath(path: Path): ObjectID {
        let objectId = "_root"
        for (let pathElem of path) {
            objectId = this.metadata[objectId].children[pathElem]
            if (!objectId)
                throw new RangeError(
                    `No object at path ${JSON.stringify(path)}`,
                )
        }
        return objectId
    }

    /** Given a path to somewhere in the document, return a list of format spans w/ text.
     *  Each span specifies the formatting marks as well as the text within the span.
     *  (This function avoids the need for a caller to manually stitch together
     *  format spans with a text string.)
     */
    getTextWithFormatting(path: Path): Array<FormatSpanWithText> {
        const objectId = this.getObjectIdForPath(path)
        const text = this.objects[objectId]
        const formatSpans = normalize(this.formatSpans[objectId], text.length)

        return formatSpans.map((span, index) => {
            const start = span.start
            const end =
                index < formatSpans.length - 1
                    ? formatSpans[index + 1].start
                    : text.length

            const marks = {}
            for (const [key, value] of Object.entries(span.marks)) {
                if (value.active) {
                    marks[key] = true
                }
            }
            return { marks, text: text.slice(start, end).join("") }
        })
    }

    /**
     * Adds an operation to a new change being generated, and also applies it to the document.
     * Returns the new operation's opId.
     */
    makeNewOp(change, op) {
        this.maxOp += 1
        const opId = `${this.maxOp}@${this.actorId}`
        this.applyOp(Object.assign({ opId }, op))
        change.ops.push(op)
        return opId
    }

    /**
     * Updates the document state by applying the change object `change`, in the format documented here:
     * https://github.com/automerge/automerge/blob/performance/BINARY_FORMAT.md#json-representation-of-changes
     */
    applyChange(change) {
        // Check that the change's dependencies are met
        const lastSeq = this.clock[change.actor] || 0
        if (change.seq !== lastSeq + 1) {
            throw new RangeError(
                `Expected sequence number ${lastSeq + 1}, got ${change.seq}`,
            )
        }
        for (let [actor, dep] of Object.entries(change.deps || {})) {
            if (!this.clock[actor] || this.clock[actor] < dep) {
                throw new RangeError(
                    `Missing dependency: change ${dep} by actor ${actor}`,
                )
            }
        }
        this.clock[change.actor] = change.seq
        this.maxOp = Math.max(
            this.maxOp,
            change.startOp + change.ops.length - 1,
        )

        change.ops.forEach((op, index) => {
            this.applyOp(
                Object.assign(
                    { opId: `${change.startOp + index}@${change.actor}` },
                    op,
                ),
            )
        })
    }

    /**
     * Updates the document state with one of the operations from a change.
     */
    applyOp(op) {
        if (!this.metadata[op.obj])
            throw new RangeError(`Object does not exist: ${op.obj}`)
        if (op.action === "makeMap") {
            this.objects[op.opId] = {}
            this.metadata[op.opId] = { children: {} }
        } else if (op.action === "makeList") {
            this.objects[op.opId] = []
            this.metadata[op.opId] = []
            // By default, a list has one "unformatted" span covering the whole list.
            this.formatSpans[op.opId] = [{ marks: {}, start: 0 }]
        }

        if (Array.isArray(this.metadata[op.obj])) {
            // Updating an array object (including text or rich text)
            if (["set", "del", "makeMap", "makeList"].includes(op.action)) {
                if (op.insert) this.applyListInsert(op)
                else this.applyListUpdate(op)
            } else if (["addMark", "removeMark"].includes(op.action)) {
                // Incrementally apply this formatting operation to
                // the list of flattened spans that we are storing
                this.formatSpans[op.obj] = applyFormatOp(
                    this.formatSpans[op.obj],

                    // convert our micromerge op into an op in our formatting system
                    // todo: align these two types so we don't need a translation here
                    {
                        type: op.action,
                        markType: op.markType,
                        start: this.findListElement(op.obj, op.start).index,
                        end: this.findListElement(op.obj, op.end).index,
                        id: op.opId,
                    },
                )
            } else {
                throw new Error(`unknown action: ${op.action}`)
            }
        } else {
            // Updating a key in a map. Use last-writer-wins semantics: the operation takes effect if its
            // opId is greater than the last operation for that key; otherwise we ignore it.
            if (
                !this.metadata[op.obj][op.key] ||
                compareOpIds(this.metadata[op.obj][op.key], op.opId) === -1
            ) {
                this.metadata[op.obj][op.key] = op.opId
                if (op.action === "del") {
                    delete this.objects[op.obj][op.key]
                } else if (op.action.startsWith("make")) {
                    this.objects[op.obj][op.key] = this.objects[op.opId]
                    this.metadata[op.obj].children[op.key] = op.opId
                } else {
                    this.objects[op.obj][op.key] = op.value
                }
            }
        }
    }

    /**
     * Recomputes rich text after either the character array or the formatting ops have changed
     */
    recomputeFormatting(objectId) {
        // Extremely simplistic implementation -- please replace me with something real!
        // Make an array with the same length as the array of characters, with each element containing
        // the formatting for that character.
        const formatting = this.formatSpans[objectId]
        formatting.chars = new Array(this.objects[objectId].length)
        formatting.chars.fill("")

        // Apply the ops in ascending order by opId
        for (let op of formatting.ops) {
            if (op.action === "addMark" && op.markType && op.start && op.end) {
                // Cursors for start and end of the span being formatted
                // TODO: check this does what we want when characters are deleted
                const startIndex = this.findListElement(
                    op.obj,
                    op.start,
                ).visible
                const endIndex = this.findListElement(op.obj, op.end).visible

                for (let i = startIndex; i <= endIndex; i++) {
                    if (formatting.chars[i] !== "") formatting.chars[i] += ","
                    formatting.chars[i] += op.type
                }
            }
        }
    }

    /**
     * Applies a list insertion operation.
     */
    applyListInsert(op) {
        const meta = this.metadata[op.obj]
        const value = op.action.startsWith("make")
            ? this.objects[op.opId]
            : op.value

        // op.elemId is the ID of the reference element; we want to insert after this element
        let { index, visible } =
            op.elemId === "_head"
                ? { index: -1, visible: 0 }
                : this.findListElement(op.obj, op.elemId)
        if (index >= 0 && !meta[index].deleted) visible++
        index++

        // Skip over any elements whose elemId is greater than op.opId
        // (this ensures convergence when there are concurrent insertions at the same position)
        while (
            index < meta.length &&
            compareOpIds(op.opId, meta[index].elemId) < 0
        ) {
            if (!meta[index].deleted) visible++
            index++
        }

        // Insert the new list element at the correct index
        meta.splice(index, 0, {
            elemId: op.opId,
            valueId: op.opId,
            deleted: false,
        })
        this.objects[op.obj].splice(visible, 0, value)
    }

    /**
     * Applies a list element update (setting the value of a list element, or deleting a list element).
     */
    applyListUpdate(op) {
        const { index, visible } = this.findListElement(op.obj, op.elemId)
        const meta = this.metadata[op.obj][index]
        if (op.action === "del") {
            if (!meta.deleted) this.objects[op.obj].splice(visible, 1)
            meta.deleted = true
        } else if (compareOpIds(meta.valueId, op.opId) < 0) {
            if (!meta.deleted) {
                this.objects[op.obj][visible] = op.action.startsWith("make")
                    ? this.objects[op.opId]
                    : op.value
            }
            meta.valueId = op.opId
        }
    }

    /**
     * Searches for the list element with ID `elemId` in the object with ID `objectId`. Returns an
     * object `{index, visible}` where `index` is the index of the element in the metadata array, and
     * `visible` is the number of non-deleted elements that precede the specified element.
     */
    findListElement(objectId, elemId) {
        let index = 0,
            visible = 0,
            meta = this.metadata[objectId]
        while (index < meta.length && meta[index].elemId !== elemId) {
            if (!meta[index].deleted) visible++
            index++
        }
        if (index === meta.length)
            throw new RangeError(`List element not found: ${elemId}`)
        return { index, visible }
    }

    /**
     * Scans the list object with ID `objectId` and returns the element ID of the `index`-th
     * non-deleted element. This is essentially the inverse of `findListElement()`.
     */
    getListElementId(objectId, index) {
        let i = 0,
            visible = -1,
            meta = this.metadata[objectId]
        for (let i = 0; i < meta.length; i++) {
            if (!meta[i].deleted) {
                visible++
                if (visible === index) return meta[i].elemId
            }
        }
        throw new RangeError(`List index out of bounds: ${index}`)
    }
}
