import { MarkMap } from "./format"
import uuid from "uuid"
import { isEqual } from "lodash"
import { inspect } from "util"

import type { Marks, MarkType } from "./schema"
import type { MarkValue } from "./format"

const CHILDREN = Symbol("children")
const ROOT = Symbol("_root")
const HEAD = Symbol("_head")

/** A patch represents a change to make to a JSON document.
 *  These are a way for Micromerge to notify a listener of incremental changes
 *  to update a document.
 */
export type Patch =
    | (InsertOperationInput & { marks: MarkMap })
    | DeleteOperationInput
    | AddMarkOperationInput
    | RemoveMarkOperationInput

type CONTENT_KEY = "text"

export type MarkMapWithoutOpIds = {
    [K in MarkType]?: Marks[K]["allowMultiple"] extends true
        ? Array<WithoutOpId<MarkValue[K]>>
        : WithoutOpId<MarkValue[K]>
}

type WithoutOpId<M extends Values<MarkValue>> = Omit<M, "opId">

export interface FormatSpanWithText {
    text: string
    marks: MarkMapWithoutOpIds
}

export type ActorId = string
export type OperationId = string
export type Cursor = { objectId: ObjectId; elemId: ElemId }

/** The operation that created the object. */
type ObjectId = OperationId | typeof ROOT
type ElemId = OperationId | typeof HEAD
type ChangeNumber = number
type OpNumber = number

export type Char = string /** 1-string */
type JsonPrimitive = string | number | boolean | null
type JsonComposite = { [key: string]: Json } | Array<Json>
type Json = JsonPrimitive | JsonComposite

export type OperationPath = [] | [CONTENT_KEY]

/**
 * A vector clock data structure.
 * Maps an actor ID to the latest sequence number from that actor.
 */
type Clock = Record<ActorId, number>

/**
 * A batch of operations from a single actor, applied transactionally.
 */
export interface Change {
    /** ID of the actor responsible for the change. */
    actor: ActorId
    /** Actor's current change version. */
    seq: ChangeNumber
    /** Latest change the author has seen from each actor, prior to the change. */
    deps: Clock
    /** Number of the first operation in the change. */
    startOp: OpNumber
    /** Operations contained in the change, ordered temporally. */
    ops: Operation[]
}

export interface InsertOperationInput {
    action: "insert"
    /** Path to the array to modify. */
    path: OperationPath
    /** Insert characters at the given index. */
    index: number
    /** List of individual characters to be inserted in the given order. */
    values: Char[]
}

export interface DeleteOperationInput {
    action: "delete"
    /** Path to the array to modify. */
    path: OperationPath
    /** Insert characters at the given index. */
    index: number
    /** Number of characters to delete. */
    count: number
}

/** Create a new array field with the given key, at the chosen path. */
// TODO: What about inserting arrays into arrays?
// TODO: Is it illegal to insert at key "foo" in an array?
// TODO: Can `key` be a number when inserting into an array?
interface MakeListOperationInput {
    action: "makeList"
    /** Path to an object in which to insert a new field. */
    path: OperationPath
    /** Key at which to create the array field.
        Key should not exist at the given path. */
    key: string
}

/** Create a new map field with the given key, at the chosen path. */
interface MakeMapOperationInput {
    action: "makeMap"
    /** Path to an object in which to insert a new field. */
    path: OperationPath
    /** Key at which to create the map field. Should not exist at the given path. */
    key: string
}

interface SetOperationInput {
    action: "set"
    /** Path to an object containing the field to set. */
    path: OperationPath
    /** Field to set at the given path. */
    key: string
    /** Value to set at the given field. */
    value: JsonPrimitive
}

interface DelOperationInput {
    action: "del"
    /** Path to an object containing the field to delete. */
    path: OperationPath
    /** Field to delete at the given path. */
    key: string
}

interface AddMarkOperationInputBase<M extends MarkType> {
    action: "addMark"
    /** Path to a list object. */
    path: OperationPath
    /** Index in the list to apply the mark start, inclusive. */
    start: number
    /** Index in the list to end the mark, inclusive. */
    end: number
    /** Mark to add. */
    markType: M
}

// TODO: automatically populate attrs type w/o manual enumeration
export type AddMarkOperationInput = Values<
    {
        [M in MarkType]: keyof Omit<
            MarkValue[M],
            "opId" | "active"
        > extends never
            ? AddMarkOperationInputBase<M> & { attrs?: undefined }
            : AddMarkOperationInputBase<M> & {
                  attrs: Required<Omit<MarkValue[M], "opId" | "active">>
              }
    }
>

// TODO: What happens if the mark isn't active at all of the given indices?
// TODO: What happens if the indices are out of bounds?
interface RemoveMarkOperationInputBase<M extends MarkType> {
    action: "removeMark"
    /** Path to a list object. */
    path: OperationPath
    /** Index in the list to remove the mark, inclusive. */
    start: number
    /** Index in the list to end the mark removal, inclusive. */
    end: number
    /** Mark to remove. */
    markType: M
}

export type RemoveMarkOperationInput =
    | (RemoveMarkOperationInputBase<"strong"> & {
          attrs?: undefined
      })
    | (RemoveMarkOperationInputBase<"em"> & {
          attrs?: undefined
      })
    | (RemoveMarkOperationInputBase<"comment"> & {
          /** Data attributes for the mark. */
          attrs: Omit<MarkValue["comment"], "opId">
      })
    | (RemoveMarkOperationInputBase<"link"> & {
          /** Data attributes for the mark. */
          attrs?: undefined
      })

export type InputOperation =
    | MakeListOperationInput
    | MakeMapOperationInput
    | SetOperationInput
    | DelOperationInput
    | InsertOperationInput
    | DeleteOperationInput
    | AddMarkOperationInput
    | RemoveMarkOperationInput

interface BaseOperation {
    /** ID of the object at the given path. */
    obj: ObjectId
    /** ID of the operation. In a different namespace than changes. */
    opId: OperationId
}

interface InsertOperation extends BaseOperation {
    action: "set"
    /** Element ID at which to insert item. */
    elemId: ElemId
    /** Individual item to insert. */
    value: Json
    /** Indicates the operation should be handled as an insertion. */
    insert: true
    /** To allow type refinements. */
    key?: undefined
}

interface DeleteOperation extends BaseOperation {
    action: "del"
    /** Element ID at which to delete item. */
    elemId: ElemId
    /** To allow type refinements. */
    key?: undefined
}

/** Create a new array field with the given key, in the chosen object. */
interface MakeListOperation extends BaseOperation {
    action: "makeList"
    /** Key at which to create the array field.
        Only present if `obj` points to a map.  */
    key: string
}

/** Create a new map field with the given key, in the chosen object. */
interface MakeMapOperation extends BaseOperation {
    action: "makeMap"
    /** Key at which to create the map field.
        Only present if `obj` points to a map.  */
    key: string
}

interface SetOperation extends BaseOperation {
    action: "set"
    /** Field to set at the given path. */
    key: string
    /** Value to set at the given field. */
    value: JsonPrimitive
    /** To allow type refinements. */
    elemId?: undefined
}

interface DelOperation extends BaseOperation {
    action: "del"
    /** Field to delete at the given path. */
    key: string
    /** To allow type refinements. */
    elemId?: undefined
}

interface AddMarkOperationBase<M extends MarkType> extends BaseOperation {
    action: "addMark"
    /** List element to apply the mark start. */
    start: OperationId
    /** List element to apply the mark end, inclusive. */
    end: OperationId
    /** Mark to add. */
    markType: M
}

export type AddMarkOperation = Values<
    {
        [M in MarkType]: keyof Omit<
            MarkValue[M],
            "opId" | "active"
        > extends never
            ? AddMarkOperationBase<M> & { attrs?: undefined }
            : AddMarkOperationBase<M> & {
                  attrs: Required<Omit<MarkValue[M], "opId" | "active">>
              }
    }
>

interface RemoveMarkOperationBase<M extends MarkType> extends BaseOperation {
    action: "removeMark"
    /** List element to apply the mark start. */
    start: OperationId
    /** List element to apply the mark end, inclusive. */
    end: OperationId
    /** Mark to add. */
    markType: M
}

type RemoveMarkOperation =
    | RemoveMarkOperationBase<"strong">
    | RemoveMarkOperationBase<"em">
    | (RemoveMarkOperationBase<"comment"> & {
          /** Data attributes for the mark. */
          attrs: DistributiveOmit<MarkValue["comment"], "opId">
      })
    | RemoveMarkOperationBase<"link">

export type Operation =
    | MakeListOperation
    | MakeMapOperation
    | SetOperation
    | DelOperation
    | InsertOperation
    | DeleteOperation
    | AddMarkOperation
    | RemoveMarkOperation

/**
 * Tracks the operation ID that set each field.
 */
type MapMetadata<M extends { [key: string]: Json }> = {
    // TODO: Metadata contains operation IDs for primitive fields only.
    // All composite fields are in the CHILDREN sub-object.
    // Really the type annotation we want is this:
    // M[K] extends JsonPrimitive
    //     ? OperationId
    //     : undefined
    // But we can't use it because we never actually know M,
    // so TypeScript resolves indexed lookups to `never`.
    [K in keyof M]?: OperationId /** Responsible for setting this field. */
} & {
    // Maps all of the composite object fields to their object IDs.
    [CHILDREN]: {
        // TODO: Children map contains operation IDs for composite fields only.
        //    M[K] extends JsonComposite ? ObjectId : never
        [K in keyof M]?: ObjectId
    }
}

type ListItemMetadata = {
    /** Operation that created the list item.
        NOTE: InputOperations are not internal Operations! One InsertInputOperation
        can produce multiple InsertOperations. The `elemId` corresponds to an
        internal InsertOperation. This is how we ensure that each `elemId` is unique,
        even when inserted as part of the same InsertInputOperation. */
    elemId: OperationId
    /** Operation that last updated the list item.
        See `elemId` note about internal operations. */
    valueId: OperationId
    /** Has the list item been deleted? */
    deleted: boolean
    /** A list of the mark operations that intersect with this item */
    markOperations?: Array<AddMarkOperation | RemoveMarkOperation>
}

type ListMetadata = Array<ListItemMetadata>

type Metadata = ListMetadata | MapMetadata<Record<string, Json>>

// temp: a flawed, oversimplified that turns a list of ops into a mark map
function opsToMarks(
    ops: (AddMarkOperation | RemoveMarkOperation)[],
): MarkMapWithoutOpIds {
    const markMap: MarkMap = {}
    for (const op of ops) {
        switch (op.action) {
            case "addMark": {
                if (op.markType === "strong" || op.markType === "em") {
                    markMap[op.markType] = { active: true }
                }
            }
        }
    }

    return markMap
}

/**
 * Miniature implementation of a subset of Automerge.
 */
export default class Micromerge {
    /** Key in the root object containing the text content. */
    public static contentKey: CONTENT_KEY = "text"

    /** ID of the actor using the document. */
    private actorId: string
    /** Current sequence number. */
    private seq: number = 0
    /** Highest operation seen so far. */
    private maxOp: number = 0
    /** Map from actorId to last sequence number seen from that actor. */
    private clock: Record<string, number> = {}
    /** Objects, keyed by the ID of the operation that created the object. */
    private objects: Record<ObjectId, JsonComposite> &
        Record<typeof ROOT, Record<string, Json>> = {
        [ROOT]: {},
    }
    /** Map from object ID to CRDT metadata for each object field. */
    private metadata: Record<ObjectId, Metadata> = {
        [ROOT]: { [CHILDREN]: {} },
    }

    constructor(actorId: string = uuid.v4()) {
        this.actorId = actorId
    }

    /**
     * Returns the document root object.
     */
    get root(): Record<string, Json> {
        return this.objects[ROOT]
    }

    /**
     * Return the document root object, cast to a given shape.
     * The result will still make all fields optional, so the consumer
     * needs to do runtime checking.
     */
    // TODO: Make RecursivePartial<T>.
    public getRoot<T extends Record<string, Json>>(): Partial<T> {
        return this.objects[ROOT] as T
    }

    /**
     * Generates a new change containing operations described in the array `ops`. Returns the change
     * object, which can be JSON-encoded to send to another node.
     */
    public change(ops: Array<InputOperation>): {
        change: Change
        patches: Patch[]
    } {
        // Record the dependencies of this change:
        // anything in our clock before we generate the change.
        const deps = Object.assign({}, this.clock)

        // Record a new local seq number in our clock,
        // to remember we've incorporated this new change
        this.seq += 1
        this.clock[this.actorId] = this.seq

        const change: Change = {
            actor: this.actorId,
            seq: this.seq,
            deps,
            startOp: this.maxOp + 1,
            ops: [],
        }

        const patchesForChange: Patch[] = []

        for (const inputOp of ops) {
            const objId = this.getObjectIdForPath(inputOp.path)
            const obj = this.objects[objId]

            if (!obj) {
                throw new Error(`Object doesn't exist: ${String(objId)}`)
            }

            // Check if the operation is modifying a list object.
            if (Array.isArray(obj)) {
                if (inputOp.action === "insert") {
                    let elemId =
                        inputOp.index === 0
                            ? HEAD
                            : this.getListElementId(objId, inputOp.index - 1)
                    for (const value of inputOp.values) {
                        const { opId: result, patches } = this.makeNewOp(
                            change,
                            {
                                action: "set",
                                obj: objId,
                                elemId,
                                insert: true,
                                value,
                            },
                        )
                        elemId = result
                        patchesForChange.push(...patches)
                    }
                } else if (inputOp.action === "delete") {
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
                    for (let i = 0; i < inputOp.count; i++) {
                        const elemId = this.getListElementId(
                            objId,
                            inputOp.index,
                        )
                        const { patches } = this.makeNewOp(change, {
                            action: "del",
                            obj: objId,
                            elemId,
                        })
                        patchesForChange.push(...patches)
                    }
                } else if (inputOp.action === "addMark") {
                    const partialOp = {
                        action: inputOp.action,
                        obj: objId,
                        start: this.getListElementId(objId, inputOp.start),
                        end: this.getListElementId(objId, inputOp.end),
                    } as const

                    if (inputOp.markType === "comment") {
                        const { markType, attrs } = inputOp
                        const { patches } = this.makeNewOp(change, {
                            ...partialOp,
                            markType,
                            attrs,
                        })
                        patchesForChange.push(...patches)
                    } else if (inputOp.markType === "link") {
                        const { markType, attrs } = inputOp
                        const { patches } = this.makeNewOp(change, {
                            ...partialOp,
                            markType,
                            attrs,
                        })
                        patchesForChange.push(...patches)
                    } else {
                        const { patches } = this.makeNewOp(change, {
                            ...partialOp,
                            markType: inputOp.markType,
                        })
                        patchesForChange.push(...patches)
                    }
                } else if (inputOp.action === "removeMark") {
                    const partialOp = {
                        action: inputOp.action,
                        obj: objId,
                        start: this.getListElementId(objId, inputOp.start),
                        end: this.getListElementId(objId, inputOp.end),
                    } as const
                    if (inputOp.markType === "comment") {
                        const { patches } = this.makeNewOp(change, {
                            ...partialOp,
                            markType: inputOp.markType,
                            attrs: inputOp.attrs,
                        })
                        patchesForChange.push(...patches)
                    } else {
                        const { patches } = this.makeNewOp(change, {
                            ...partialOp,
                            markType: inputOp.markType,
                        })
                        patchesForChange.push(...patches)
                    }
                } else if (inputOp.action === "del") {
                    throw new Error("Use the remove action")
                } else if (
                    inputOp.action === "makeList" ||
                    inputOp.action === "makeMap" ||
                    inputOp.action === "set"
                ) {
                    throw new Error("Unimplemented")
                } else {
                    unreachable(inputOp)
                }
            } else {
                // The operation is modifying a map object.
                if (
                    inputOp.action === "makeList" ||
                    inputOp.action === "makeMap"
                    // TODO: Why can't I handle the "del" case here????
                    // inputOp.action === "del"
                ) {
                    const { patches } = this.makeNewOp(change, {
                        action: inputOp.action,
                        obj: objId,
                        key: inputOp.key,
                    })
                    patchesForChange.push(...patches)
                } else if (inputOp.action === "del") {
                    const { patches } = this.makeNewOp(change, {
                        action: inputOp.action,
                        obj: objId,
                        key: inputOp.key,
                    })
                    patchesForChange.push(...patches)
                } else if (inputOp.action === "set") {
                    const { patches } = this.makeNewOp(change, {
                        action: inputOp.action,
                        obj: objId,
                        key: inputOp.key,
                        value: inputOp.value,
                    })
                    patchesForChange.push(...patches)
                } else if (
                    inputOp.action === "addMark" ||
                    inputOp.action === "removeMark" ||
                    inputOp.action === "insert" ||
                    inputOp.action === "delete"
                ) {
                    throw new Error(`Not a list: ${inputOp.path}`)
                } else {
                    unreachable(inputOp)
                }
            }
        }

        return { change, patches: patchesForChange }
    }

    /**
     * Returns the ID of the object at a particular path in the document tree.
     */
    getObjectIdForPath(path: InputOperation["path"]): ObjectId {
        let objectId: ObjectId = ROOT
        for (const pathElem of path) {
            const meta: Metadata = this.metadata[objectId]
            if (meta === undefined) {
                throw new RangeError(
                    `No object at path ${JSON.stringify(path)}`,
                )
            }
            if (Array.isArray(meta)) {
                throw new RangeError(
                    `Object ${pathElem} in path ${JSON.stringify(
                        path,
                    )} is a list`,
                )
            }
            const childId: ObjectId | undefined = meta[CHILDREN][pathElem]
            if (childId === undefined) {
                throw new Error(
                    `Child not found: ${pathElem} in ${String(objectId)}`,
                )
            }
            objectId = childId
        }
        return objectId
    }

    /** Given a path to somewhere in the document, return a list of format spans w/ text.
     *  Each span specifies the formatting marks as well as the text within the span.
     *  (This function avoids the need for a caller to manually stitch together
     *  format spans with a text string.)
     */
    public getTextWithFormatting(
        path: OperationPath,
    ): Array<FormatSpanWithText> {
        const objectId = this.getObjectIdForPath(path)
        const text = this.objects[objectId]
        const metadata = this.metadata[objectId]
        console.log(
            inspect(
                {
                    actorId: this.actorId,
                    metadata,
                },
                false,
                4,
            ),
        )
        if (text === undefined || !(text instanceof Array)) {
            throw new Error(
                `Expected a list at object ID ${objectId.toString()}`,
            )
        }
        if (metadata === undefined || !(metadata instanceof Array)) {
            throw new Error(
                `Expected list metadata for object ID ${objectId.toString()}`,
            )
        }

        const spans = []
        let charactersForSpan = []
        let marks: MarkMapWithoutOpIds = {}
        let visible = 0

        for (const [index, elMeta] of metadata.entries()) {
            // We may need to start a new span because
            // some operation begins at this point
            const isStart = elMeta.markOperations !== undefined

            // Detect if some operation ended at the previous character
            // so we need to start a new span here
            const prevMeta = metadata[index - 1]
            const isAfterEnd =
                index > 0 &&
                prevMeta.markOperations !== undefined &&
                prevMeta.markOperations?.find(op => op.end === prevMeta.elemId)

            if (isStart || isAfterEnd) {
                // Calculate the new marks that should start at this span
                let newMarks
                if (isStart && elMeta.markOperations !== undefined) {
                    newMarks = opsToMarks(elMeta.markOperations)
                } else {
                    // this is impossible
                    if (prevMeta.markOperations === undefined) throw new Error()

                    newMarks = opsToMarks(
                        prevMeta.markOperations.filter(
                            op => op.end !== prevMeta.elemId,
                        ),
                    )
                }

                // If the marks are different than previous span, time to start a new span!
                if (!isEqual(newMarks, marks) && charactersForSpan.length > 0) {
                    const newSpan = { text: charactersForSpan.join(""), marks }
                    spans.push(newSpan)
                    charactersForSpan = []
                }
                marks = newMarks
            }

            if (!elMeta.deleted) {
                charactersForSpan.push(text[visible])
                visible += 1
            }
        }

        if (charactersForSpan.length > 0) {
            spans.push({
                text: charactersForSpan.join(""),
                marks,
            })
        }

        return spans
    }

    public getCursor(path: OperationPath, index: number): Cursor {
        const objectId = this.getObjectIdForPath(path)

        return {
            objectId,
            elemId: this.getListElementId(objectId, index),
        }
    }

    public resolveCursor(cursor: Cursor): number {
        return this.findListElement(cursor.objectId, cursor.elemId).visible
    }

    /**
     * Adds an operation to a new change being generated, and also applies it to the document.
     * Returns the new operation's opId.
     */
    private makeNewOp(
        change: Change,
        op: DistributiveOmit<Operation, "opId">,
    ): { opId: OperationId; patches: Patch[] } {
        this.maxOp += 1
        const opId = `${this.maxOp}@${this.actorId}`
        const opWithId = { opId, ...op }
        const patches = this.applyOp(opWithId)
        change.ops.push(opWithId)
        return { opId, patches }
    }

    /**
     * Updates the document state by applying the change object `change`, in the format documented here:
     * https://github.com/automerge/automerge/blob/performance/BINARY_FORMAT.md#json-representation-of-changes
     */
    applyChange(change: Change): Patch[] {
        // Check that the change's dependencies are met
        const lastSeq = this.clock[change.actor] || 0
        if (change.seq !== lastSeq + 1) {
            throw new RangeError(
                `Expected sequence number ${lastSeq + 1}, got ${change.seq}`,
            )
        }
        for (const [actor, dep] of Object.entries(change.deps || {})) {
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

        return change.ops.flatMap(this.applyOp)
    }

    /**
     * Updates the document state with one of the operations from a change.
     */
    private applyOp = (op: Operation): Patch[] => {
        const metadata = this.metadata[op.obj]
        const obj = this.objects[op.obj]

        if (!metadata || obj === undefined) {
            throw new RangeError(`Object does not exist: ${String(op.obj)}`)
        }
        if (op.action === "makeMap") {
            this.objects[op.opId] = {}
            this.metadata[op.opId] = { [CHILDREN]: {} }
        } else if (op.action === "makeList") {
            this.objects[op.opId] = []
            this.metadata[op.opId] = []
        }

        if (Array.isArray(metadata)) {
            if (!Array.isArray(obj)) {
                throw new Error(
                    `Non-array object with array metadata: ${String(op.obj)}`,
                )
            }
            // Updating an array object (including text or rich text)
            if (op.action === "set") {
                if (op.elemId === undefined) {
                    throw new Error(
                        "Must specify elemId when calling set on an array",
                    )
                }
                return this.applyListInsert(op)
            } else if (op.action === "del") {
                if (op.elemId === undefined) {
                    throw new Error(
                        "Must specify elemId when calling del on an array",
                    )
                }
                return this.applyListUpdate(op)
            } else if (op.action === "addMark") {
                // find the active marks before; add this mark to that list
                const metadata = this.metadata[op.obj]
                if (!(metadata instanceof Array)) {
                    throw new Error(`Expected list metadata for a list`)
                }

                let opIntersectsItem = false
                for (const [index, elMeta] of metadata.entries()) {
                    if (elMeta.elemId === op.start) {
                        // Add this op to the starting item

                        opIntersectsItem = true
                        // Get the active formatting at this location--
                        // either directly from this element, or closest to the left
                        let existingOps: Array<
                            AddMarkOperation | RemoveMarkOperation
                        > = []
                        for (let i = index; i >= 0; i--) {
                            const metadataAtLocation =
                                metadata[i].markOperations
                            if (metadataAtLocation !== undefined) {
                                existingOps = metadataAtLocation
                                break
                            }
                        }

                        elMeta.markOperations = [...existingOps, op]
                    } else if (elMeta.elemId === op.end) {
                        opIntersectsItem = false
                        // Add this op to the end item

                        let existingOps: Array<
                            AddMarkOperation | RemoveMarkOperation
                        > = []
                        for (let i = index; i >= 0; i--) {
                            const metadataAtLocation =
                                metadata[i].markOperations
                            if (metadataAtLocation !== undefined) {
                                existingOps = metadataAtLocation.filter(
                                    existingOp =>
                                        existingOp.end !== metadata[i].elemId,
                                )
                                break
                            }
                        }

                        if (existingOps.includes(op)) {
                            elMeta.markOperations = [...existingOps]
                        } else {
                            elMeta.markOperations = [...existingOps, op]
                        }
                        break
                    } else if (
                        opIntersectsItem &&
                        elMeta.markOperations !== undefined
                    ) {
                        // Add this op to any items between start and end
                        elMeta.markOperations = [...elMeta.markOperations, op]
                    }
                }
                return []
            } else if (op.action === "removeMark") {
                return []
            } else if (op.action === "makeList" || op.action === "makeMap") {
                throw new Error("Unimplemented")
            } else {
                unreachable(op)
            }
        } else {
            if (op.action === "addMark" || op.action === "removeMark") {
                throw new Error("Can't call addMark or removeMark on a map")
            }
            if (op.key === undefined) {
                throw new Error(
                    "Must specify key when calling set or del on a map",
                )
            }
            // Updating a key in a map. Use last-writer-wins semantics: the operation takes effect if its
            // opId is greater than the last operation for that key; otherwise we ignore it.
            const obj = this.objects[op.obj]
            if (Array.isArray(obj)) {
                throw new Error(
                    `Metadata is map but object is array: ${String(op.obj)}`,
                )
            }
            const keyMeta = metadata[op.key]
            if (
                keyMeta === undefined ||
                compareOpIds(keyMeta, op.opId) === -1
            ) {
                metadata[op.key] = op.opId
                if (op.action === "del") {
                    delete obj[op.key]
                } else if (
                    op.action === "makeList" ||
                    op.action === "makeMap"
                ) {
                    obj[op.key] = this.objects[op.opId]
                    metadata[CHILDREN][op.key] = op.opId
                } else if (op.action === "set") {
                    obj[op.key] = op.value
                } else {
                    unreachable(op)
                }
            }
        }

        // If we've reached this point, that means we haven't yet implemented
        // the logic to return a correct patch for applying this particular op.
        return []
    }

    /**
     * Applies a list insertion operation.
     */
    // TODO: Extend this to take MakeMapOperation and MakeListOperation.
    private applyListInsert(op: InsertOperation): Patch[] {
        const meta = this.metadata[op.obj]
        if (!Array.isArray(meta)) {
            throw new Error(`Not a list: ${String(op.obj)}`)
        }

        // op.elemId is the ID of the reference element; we want to insert after this element
        let { index, visible } =
            op.elemId === HEAD
                ? { index: -1, visible: 0 }
                : this.findListElement(op.obj, op.elemId)
        if (index >= 0 && !meta[index].deleted) {
            visible++
        }
        index++

        // Skip over any elements whose elemId is greater than op.opId
        // (this ensures convergence when there are concurrent insertions at the same position)
        while (
            index < meta.length &&
            compareOpIds(op.opId, meta[index].elemId) < 0
        ) {
            if (!meta[index].deleted) {
                visible++
            }
            index++
        }

        // Insert the new list element at the correct index
        meta.splice(index, 0, {
            elemId: op.opId,
            valueId: op.opId,
            deleted: false,
        })

        const obj = this.objects[op.obj]
        if (!Array.isArray(obj)) {
            throw new Error(`Not a list: ${String(op.obj)}`)
        }
        const value =
            // TODO: Add this back in.
            // op.action === "makeList" || op.action === "makeMap"
            //     ? this.objects[op.opId] :
            op.value

        if (typeof value !== "string") {
            throw new Error(`Expected value inserted into text to be a string`)
        }
        obj.splice(visible, 0, value)

        return [
            {
                // TODO: We don't have convenient access to the path here so we just hardcode.
                // In a real implementation, would need to resolve object ID into path.
                path: [Micromerge.contentKey],
                action: "insert",
                index: visible,
                values: [value],
                marks: {},
            },
        ]
    }

    /**
     * Applies a list element update (setting the value of a list element, or deleting a list element).
     */
    private applyListUpdate(op: DeleteOperation): Patch[] {
        const { index, visible } = this.findListElement(op.obj, op.elemId)
        const listMeta = this.metadata[op.obj]
        if (listMeta === undefined) {
            throw new Error(`Object not found: ${String(op.obj)}`)
        }
        if (!Array.isArray(listMeta)) {
            throw new Error(`Not a list: ${String(op.obj)}`)
        }
        const meta = listMeta[index]
        // TODO: Do we need to compare op ids here for deletion?
        if (op.action === "del") {
            if (!meta.deleted) {
                const obj = this.objects[op.obj]
                if (!Array.isArray(obj)) {
                    throw new Error(`Not a list: ${String(op.obj)}`)
                }
                meta.deleted = true
                obj.splice(visible, 1)
                return [
                    {
                        path: [Micromerge.contentKey], // todo: populate actual path
                        action: "delete",
                        index: visible,
                        count: 1,
                    },
                ]
            }
        } else if (compareOpIds(meta.valueId, op.opId) < 0) {
            throw new Error("Not implemented yet")
            // // Currently this can never happen, but applies when there is an update
            // // operation that isn't deletion.
            // // TODO: Can we ever set an element in a list?
            // if (!meta.deleted) {
            //     const obj = this.objects[op.obj]
            //     if (!Array.isArray(obj)) {
            //         throw new Error(`Not a list: ${String(op.obj)}`)
            //     }
            //     obj[visible] =
            //         op.action === "makeList" || op.action === "makeMap"
            //             ? this.objects[op.opId]
            //             : op.value
            // }
            // meta.valueId = op.opId
        }

        return []
    }

    /**
     * Searches for the list element with ID `elemId` in the object with ID `objectId`. Returns an
     * object `{index, visible}` where `index` is the index of the element in the metadata array, and
     * `visible` is the number of non-deleted elements that precede the specified element.
     */
    private findListElement(
        objectId: ObjectId,
        elemId: ElemId,
    ): {
        index: number
        visible: number
    } {
        let index = 0
        let visible = 0
        const meta = this.metadata[objectId]
        if (!meta) {
            throw new Error(`Object ID not found: ${String(objectId)}`)
        }
        if (!Array.isArray(meta)) {
            throw new Error("Expected array metadata for findListElement")
        }
        while (index < meta.length && meta[index].elemId !== elemId) {
            if (!meta[index].deleted) visible++
            index++
        }
        if (index === meta.length) {
            throw new RangeError(`List element not found: ${String(elemId)}`)
        }
        return { index, visible }
    }

    /**
     * Scans the list object with ID `objectId` and returns the element ID of the `index`-th
     * non-deleted element. This is essentially the inverse of `findListElement()`.
     */
    private getListElementId(objectId: ObjectId, index: number): OperationId {
        let visible = -1
        const meta = this.metadata[objectId]
        if (!meta) {
            throw new Error(`Object ID not found: ${String(objectId)}`)
        }
        if (!Array.isArray(meta)) {
            throw new Error("Expected array metadata for findListElement")
        }
        for (const element of meta) {
            if (!element.deleted) {
                visible++
                if (visible === index) {
                    return element.elemId
                }
            }
        }
        throw new RangeError(`List index out of bounds: ${index}`)
    }
}

/**
 * Compares two operation IDs in the form `counter@actorId`. Returns -1 if `id1` is less than `id2`,
 * 0 if they are equal, and +1 if `id1` is greater than `id2`. Order is defined by first comparing
 * counter values; if the IDs have equal counter values, we lexicographically compare actorIds.
 */
export function compareOpIds(id1: OperationId, id2: OperationId): -1 | 0 | 1 {
    if (id1 == id2) return 0
    const regex = /^([0-9]+)@(.*)$/
    const match1 = regex.exec(id1),
        match2 = regex.exec(id2)
    if (!match1) {
        throw new Error(`Invalid operation ID: ${id1}`)
    }
    if (!match2) {
        throw new Error(`Invalid operation ID: ${id2}`)
    }
    const counter1 = parseInt(match1[1], 10),
        counter2 = parseInt(match2[1], 10)
    return counter1 < counter2 ||
        (counter1 === counter2 && match1[2] < match2[2])
        ? -1
        : +1
}
