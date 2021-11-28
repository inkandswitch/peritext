/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { isEqual, sortBy } from "lodash"
import Micromerge, { BaseOperation, Change, compareOpIds, getListElementId, Json, JsonComposite, ListItemMetadata, ListMetadata, Metadata, ObjectId, OperationId, OperationPath, Patch } from "./micromerge"
import { Marks, markSpec, MarkType } from "./schema"

export type MarkOperation = AddMarkOperation | RemoveMarkOperation

/** A position at which a mark operation can start or end.
 *  In a text string with n characters, there are 2n+2 boundary positions:
 *  one to the left or right of each character, plus the start and end of the string.
 */
export type BoundaryPosition =
    | { type: "before"; elemId: OperationId }
    | { type: "after"; elemId: OperationId }
    | { type: "startOfText" }
    | { type: "endOfText" }

interface AddMarkOperationBase<M extends MarkType> extends BaseOperation {
    action: "addMark"
    /** List element to apply the mark start. */
    start: BoundaryPosition
    /** List element to apply the mark end, inclusive. */
    end: BoundaryPosition
    /** Mark to add. */
    markType: M
}

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

export type AddMarkOperation = Values<{
    [M in MarkType]: keyof Omit<MarkValue[M], "opId" | "active"> extends never
    ? AddMarkOperationBase<M> & { attrs?: undefined }
    : AddMarkOperationBase<M> & {
        attrs: Required<Omit<MarkValue[M], "opId" | "active">>
    }
}>

interface RemoveMarkOperationBase<M extends MarkType> extends BaseOperation {
    action: "removeMark"
    /** List element to apply the mark start. */
    start: BoundaryPosition
    /** List element to apply the mark end, inclusive. */
    end: BoundaryPosition
    /** Mark to add. */
    markType: M
}

export type RemoveMarkOperation =
    | RemoveMarkOperationBase<"strong">
    | RemoveMarkOperationBase<"em">
    | (RemoveMarkOperationBase<"comment"> & {
        /** Data attributes for the mark. */
        attrs: DistributiveOmit<MarkValue["comment"], "opId">
    })
    | RemoveMarkOperationBase<"link">

interface AddMarkOperationInputBase<M extends MarkType> {
    action: "addMark"
    /** Path to a list object. */
    path: OperationPath
    /** Index in the list to apply the mark start, inclusive. */
    startIndex: number
    /** Index in the list to end the mark, exclusive. */
    endIndex: number
    /** Mark to add. */
    markType: M
}

// TODO: automatically populate attrs type w/o manual enumeration
export type AddMarkOperationInput = Values<{
    [M in MarkType]: keyof Omit<MarkValue[M], "opId" | "active"> extends never
    ? AddMarkOperationInputBase<M> & { attrs?: undefined }
    : AddMarkOperationInputBase<M> & {
        attrs: Required<Omit<MarkValue[M], "opId" | "active">>
    }
}>

// TODO: What happens if the mark isn't active at all of the given indices?
// TODO: What happens if the indices are out of bounds?
interface RemoveMarkOperationInputBase<M extends MarkType> {
    action: "removeMark"
    /** Path to a list object. */
    path: OperationPath
    /** Index in the list to remove the mark, inclusive. */
    startIndex: number
    /** Index in the list to end the mark removal, exclusive. */
    endIndex: number
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

type IdMarkValue = {
    id: string
    /** A MarkValue should always have the ID of the operation that last modified it. */
    opId: OperationId
}

type BooleanMarkValue =
    | {
        active: true
        /** A MarkValue should always have the ID of the operation that last modified it. */
        opId: OperationId
    }
    | {
        active: false
        opId: OperationId
    }

type LinkMarkValue =
    | {
        url: string
        /** A MarkValue should always have the ID of the operation that last modified it. */
        opId: OperationId
        active: true
    }
    | {
        url?: undefined
        opId: OperationId
        active: false
    }

export type MarkValue = Assert<
    {
        strong: BooleanMarkValue
        em: BooleanMarkValue
        comment: IdMarkValue
        link: LinkMarkValue
    },
    { [K in MarkType]: Record<string, unknown> }
>

export type MarkMap = {
    [K in MarkType]?: Marks[K]["allowMultiple"] extends true ? Array<MarkValue[K]> : MarkValue[K]
}

export type FormatSpan = {
    marks: MarkMap
    start: number
}

/**
 * As we walk through the document applying the operation, we keep track of whether we've reached the right area.
 */
type MarkOpState = "BEFORE" | "DURING" | "AFTER"

/** A patch which only has a start index and not an end index yet.
 *  Used when we're iterating thru metadata sequence and constructing a patch to emit.
 */
type PartialPatch = Omit<AddMarkOperationInput, "endIndex"> | Omit<RemoveMarkOperationInput, "endIndex">

export function applyAddRemoveMark(op: MarkOperation, object: JsonComposite, metadata: Metadata): Patch[] {
    if (!(metadata instanceof Array)) {
        throw new Error(`Expected list metadata for a list`)
    }

    // we shall build a list of patches to return
    const patches: Patch[] = []

    // Make an ordered list of all the document positions, walking from left to right
    type Positions = [number, "markOpsAfter" | "markOpsBefore", ListItemMetadata][]
    const positions = Array.from(metadata.entries(), ([i, elMeta]) => [
        [i, "markOpsBefore", elMeta],
        [i, "markOpsAfter", elMeta]
    ]).flat() as Positions;

    // set up some initial counters which will keep track of the state of the document.
    // these are explained where they're used. 
    let visibleIndex = 0
    let currentOps = new Set<MarkOperation>()
    let opState: MarkOpState = "BEFORE"
    let partialPatch: PartialPatch | undefined
    const objLength = object.length as number // pvh wonders: why does this not account for deleted items?

    for (const [, side, elMeta] of positions) {
        // First we update the currently known formatting operations affecting this position
        currentOps = elMeta[side] || currentOps
        let changedOps
        [opState, changedOps] = calculateOpsForPosition(op, currentOps, side, elMeta, opState)
        if (changedOps) { elMeta[side] = changedOps }

        // Next we need to do patch maintenance.
        // Once we are DURING the operation, we'll start a patch, emitting an intermediate patch
        // any time the formatting changes during that range, and eventually emitting one last patch
        // at the end of the range (or document.) 
        if (side === "markOpsAfter" && !elMeta.deleted) {
            // We need to keep track of the "visible" index, since the outside world won't know about
            // deleted characters.
            visibleIndex += 1
        }

        if (changedOps) {
            // First see if we need to emit a new patch, which occurs when formatting changes
            // within the range of characters the formatting operation targets.
            if (partialPatch) {
                const patch = finishPartialPatch(partialPatch, visibleIndex, objLength)
                if (patch) { patches.push(patch) }
                partialPatch = undefined
            }

            // Now begin a new patch since we have new formatting to send out.
            if (opState == "DURING" && !isEqual(opsToMarks(currentOps), opsToMarks(changedOps))) {
                partialPatch = beginPartialPatch(op, visibleIndex)
            }
        }

        if (opState == "AFTER") { break }
    }

    // If we have a partial patch leftover at the end, emit it
    if (partialPatch) {
        const patch = finishPartialPatch(partialPatch, visibleIndex, objLength)
        if (patch) { patches.push(patch) }
    }

    return patches
}

function calculateOpsForPosition(
    op: MarkOperation, currentOps: Set<MarkOperation>,
    side: "markOpsBefore" | "markOpsAfter",
    elMeta: ListItemMetadata,
    opState: MarkOpState): [opState: MarkOpState, newOps?: Set<MarkOperation>] {
    // Compute an index in the visible characters which will be used for patches.
    // If this character is visible and we're on the "after slot", then the relevant
    // index is one to the right of the current visible index.
    // Otherwise, just use the current visible index.
    const opSide = side === "markOpsAfter" ? "after" : "before"

    if (op.start.type === opSide && op.start.elemId === elMeta.elemId) {
        // we've reached the start of the operation
        return ["DURING", new Set([...currentOps, op])]
    } else if (op.end.type === opSide && op.end.elemId === elMeta.elemId) {
        // and here's the end of the operation
        return ["AFTER", new Set([...currentOps].filter(opInSet => opInSet !== op))]
    } else if (opState == "DURING" && elMeta[side] !== undefined) {
        // we've hit some kind of change in formatting mid-operation
        return ["DURING", new Set([...currentOps, op])]
    }

    // No change...
    return [opState, undefined]
}

function beginPartialPatch(
    op: MarkOperation,
    startIndex: number
): PartialPatch {
    const partialPatch: PartialPatch = {
        action: op.action,
        markType: op.markType,
        path: [Micromerge.contentKey],
        startIndex,
    }

    if (op.action === "addMark" && (op.markType === "link" || op.markType === "comment")) {
        partialPatch.attrs = op.attrs
    }

    return partialPatch
}

function finishPartialPatch(partialPatch: PartialPatch, endIndex: number, length: number): Patch | undefined {
    // Exclude certain patches which make sense from an internal metadata perspective,
    // but wouldn't make sense to an external caller:
    // - Any patch where the start or end is after the end of the currently visible text
    // - Any patch that is zero width, affecting no visible characters
    const patch = { ...partialPatch, endIndex: Math.min(endIndex, length) } as AddMarkOperationInput | RemoveMarkOperationInput
    const patchIsNotZeroLength = endIndex > partialPatch.startIndex
    const patchAffectsVisibleDocument = partialPatch.startIndex < length
    if (patchIsNotZeroLength && patchAffectsVisibleDocument) {
        return patch
    }
    return undefined
}


/** Given a set of mark operations for a span, produce a
 *  mark map reflecting the effects of those operations.
 *  (The ops can be in arbitrary order and the result is always
 *  the same, because we do op ID comparisons.)
 */
export function opsToMarks(ops: Set<MarkOperation>): MarkMapWithoutOpIds {
    const markMap: MarkMap = {}

    // Construct a mark map which stores op IDs
    for (const op of ops) {
        const existingValue = markMap[op.markType]
        // To ensure convergence, we don't always apply the operation to the mark map.
        // It only gets applied if its opID is greater than the previous op that
        // affected that value
        if (
            (op.markType === "strong" || op.markType === "em") &&
            (existingValue === undefined ||
                (!(existingValue instanceof Array) && compareOpIds(op.opId, existingValue.opId) === 1))
        ) {
            markMap[op.markType] = {
                active: op.action === "addMark" ? true : false,
                opId: op.opId,
            }
        } else if (
            op.markType === "comment" &&
            op.action === "addMark" &&
            !markMap["comment"]?.find(c => c.id === op.attrs.id)
        ) {
            const newMark = {
                id: op.attrs.id,
                opId: op.opId,
            }

            // Keeping the comments in ID-sorted order helps make equality checks easier later
            // because we can just check mark maps for deep equality
            markMap["comment"] = sortBy([...(markMap["comment"] || []), newMark], c => c.id)
        } else if (op.markType === "comment" && op.action === "removeMark") {
            markMap["comment"] = (markMap["comment"] || []).filter(c => c.id !== op.attrs.id)
        } else if (
            op.markType === "link" &&
            (existingValue === undefined ||
                (!(existingValue instanceof Array) && compareOpIds(op.opId, existingValue.opId) === 1))
        ) {
            if (op.action === "addMark") {
                markMap["link"] = {
                    active: true,
                    opId: op.opId,
                    url: op.attrs.url,
                }
            } else {
                markMap["link"] = {
                    active: false,
                    opId: op.opId,
                }
            }
        }
    }

    // Next, we remove op IDs from the mark map for final output.
    // This looks somewhat convoluted but we're just removing op IDs
    // and need to make the Typescript compiler happy...
    const cleanedMap: MarkMapWithoutOpIds = {}

    for (const [markType, markValue] of Object.entries(markMap)) {
        if ((markType === "strong" || markType === "em") && !(markValue instanceof Array) && markValue.active) {
            cleanedMap[markType] = { active: true }
        } else if (markType === "comment") {
            cleanedMap[markType] = sortBy(markMap["comment"]!, (c: IdMarkValue) => c.id).map((c: IdMarkValue) => ({
                id: c.id,
            }))
        } else if (markType === "link") {
            if (markMap["link"]!.active) {
                cleanedMap["link"] = {
                    active: true,
                    url: markMap["link"]!.url,
                }
            } else {
                cleanedMap["link"] = { active: false }
            }
        }
    }

    return cleanedMap
}


/** Given a path to somewhere in the document, return a list of format spans w/ text.
 *  Each span specifies the formatting marks as well as the text within the span.
 *  (This function avoids the need for a caller to manually stitch together
 *  format spans with a text string.)
 */
export function getTextWithFormatting(text: JsonComposite, metadata: Metadata): Array<FormatSpanWithText> {
    // Conveniently print out the metadata array, useful for debugging
    // console.log(
    //     inspect(
    //         {
    //             actorId: this.actorId,
    //             metadata: metadata?.map((item: ListItemMetadata, index: number) => ({
    //                 char: text[index],
    //                 before: item.markOpsBefore,
    //                 after: item.markOpsAfter,
    //             })),
    //         },
    //         false,
    //         4,
    //     ),
    // )
    // XXX: should i pass in the objectId for this?
    if (text === undefined || !(text instanceof Array)) {
        throw new Error(`Expected a list at object ID ${"objectId".toString()}`)
    }
    if (metadata === undefined || !(metadata instanceof Array)) {
        throw new Error(`Expected list metadata for object ID ${"objectId".toString()}`)
    }

    const spans: FormatSpanWithText[] = []
    let characters: string[] = []
    let marks: MarkMapWithoutOpIds = {}
    let visible = 0

    for (const [index, elMeta] of metadata.entries()) {
        let newMarks: MarkMapWithoutOpIds | undefined

        // Figure out if new formatting became active in the gap before this character:
        // either on the "before" set of this character, or the "after" of previous character.
        // The "before" of this character takes precedence because it's later in the sequence.
        if (elMeta.markOpsBefore) {
            newMarks = opsToMarks(elMeta.markOpsBefore)
        } else if (index > 0 && metadata[index - 1].markOpsAfter) {
            newMarks = opsToMarks(metadata[index - 1].markOpsAfter!)
        }

        if (newMarks !== undefined) {
            // If we have some characters to emit, need to add to formatted spans
            addCharactersToSpans({ characters, spans, marks })
            characters = []
            marks = newMarks
        }

        if (!elMeta.deleted) {
            // todo: what happens if the char isn't a string?
            characters.push(text[visible] as string)
            visible += 1
        }
    }

    addCharactersToSpans({ characters, spans, marks })

    return spans
}


// Given a position before or after a character in a list, returns a set of mark operations
// which represent the closest set of mark ops to the left in the metadata.
// - The search excludes the passed-in position itself, so if there is metadata at that position
//   it will not be returned.
// - Returns a new Set object that clones the existing one to avoid problems with sharing references.
// - If no mark operations are found between the beginning of the sequence and this position,
//
export function findClosestMarkOpsToLeft(args: {
    index: number
    side: "before" | "after"
    metadata: ListMetadata
}): Set<MarkOperation> {
    const { index, side, metadata } = args

    let ops = new Set<MarkOperation>()

    // First, if our initial position is after a character, look before that character
    if (side === "after" && metadata[index].markOpsBefore !== undefined) {
        return new Set(metadata[index].markOpsBefore!)
    }

    // Iterate through all characters to the left of the initial one;
    // first look after each character, then before it.
    for (let i = index - 1; i >= 0; i--) {
        const metadataAfter = metadata[i].markOpsAfter
        if (metadataAfter !== undefined) {
            ops = new Set(metadataAfter)
            break
        }

        const metadataBefore = metadata[i].markOpsBefore
        if (metadataBefore !== undefined) {
            ops = new Set(metadataBefore)
            break
        }
    }

    return ops
}
/** Add some characters with given marks to the end of a list of spans */
export function addCharactersToSpans(args: {
    characters: string[]
    marks: MarkMapWithoutOpIds
    spans: FormatSpanWithText[]
}): void {
    const { characters, marks, spans } = args
    if (characters.length === 0) {
        return
    }
    // If the new marks are same as the previous span, we can just
    // add the new characters to the last span
    if (spans.length > 0 && isEqual(spans.slice(-1)[0].marks, marks)) {
        spans.slice(-1)[0].text = spans.slice(-1)[0].text.concat(characters.join(""))
    } else {
        // Otherwise we create a new span with the characters
        spans.push({ text: characters.join(""), marks })
    }
}


export function changeMark(
    inputOp: (AddMarkOperationInputBase<"strong"> & { attrs?: undefined }) | (AddMarkOperationInputBase<"em"> & { attrs?: undefined }) | (AddMarkOperationInputBase<"comment"> & { attrs: Required<Omit<{ id: string; opId: string }, "opId" | "active">> }) | (AddMarkOperationInputBase<"link"> & { attrs: Required<Omit<{ url: string; opId: string; active: true } | { url?: undefined; opId: string; active: false }, "opId" | "active">> }) | (RemoveMarkOperationInputBase<"strong"> & { attrs?: undefined /** Value to set at the given field. */ }) | (RemoveMarkOperationInputBase<"em"> & { attrs?: undefined }) | (RemoveMarkOperationInputBase<"comment"> & { attrs: Omit<{ id: string; opId: string }, "opId"> }) | (RemoveMarkOperationInputBase<"link"> & { attrs?: undefined }),
    objId: ObjectId,
    meta: Metadata,
    obj: Json[] | (Json[] & Record<string, Json>),
    change: Change,
    patchesForChange: Patch[],
    // eslint-disable-next-line @typescript-eslint/ban-types
    makeNewOp: Function): void {
    const { action } = inputOp

    // TODO: factor this out to a proper per-mark-type config object somewhere
    const startGrows = false
    const endGrows = markSpec[inputOp.markType].inclusive

    let start: BoundaryPosition
    let end: BoundaryPosition

    if (startGrows) {
        if (inputOp.startIndex > 0) {
            start = { type: "after", elemId: getListElementId(meta, inputOp.startIndex - 1) }
        } else {
            start = { type: "startOfText" }
        }
    } else {
        start = {
            type: "before",
            elemId: getListElementId(meta, inputOp.startIndex),
        }
    }

    if (endGrows) {
        if (inputOp.endIndex < obj.length) {
            // Because the end index on the input op is exclusive, to attach the end of the op
            // to the following character we just use the index as-is
            end = { type: "before", elemId: getListElementId(meta, inputOp.endIndex) }
        } else {
            end = { type: "endOfText" }
        }
    } else {
        end = {
            type: "after",
            elemId: getListElementId(meta, inputOp.endIndex - 1),
        }
    }

    const partialOp = { action, obj: objId, start, end } as const

    if (action === "addMark") {
        if (inputOp.markType === "comment") {
            const { markType, attrs } = inputOp
            const { patches } = makeNewOp(change, { ...partialOp, action, markType, attrs })
            patchesForChange.push(...patches)
        } else if (inputOp.markType === "link") {
            const { markType, attrs } = inputOp
            const { patches } = makeNewOp(change, { ...partialOp, action, markType, attrs })
            patchesForChange.push(...patches)
        } else {
            const { patches } = makeNewOp(change, { ...partialOp, markType: inputOp.markType })
            patchesForChange.push(...patches)
        }
    } else {
        if (inputOp.markType === "comment") {
            const { patches } = makeNewOp(change, {
                ...partialOp,
                action,
                markType: inputOp.markType,
                attrs: inputOp.attrs,
            })
            patchesForChange.push(...patches)
        } else {
            const { patches } = makeNewOp(change, {
                ...partialOp,
                action,
                markType: inputOp.markType,
            })
            patchesForChange.push(...patches)
        }
    }
}
