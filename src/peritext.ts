/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { isEqual, sortBy } from "lodash"
import Micromerge, {
    Json, ObjectId, OperationId, OperationPath,
    BaseOperation, Patch,
    ListItemMetadata, ListMetadata,
    compareOpIds, getListElementId
} from "./micromerge"
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

type MarkOpsPosition = "markOpsBefore" | "markOpsAfter"

interface AddMarkOperationBase<M extends MarkType> extends BaseOperation {
    action: "addMark"
    /** List element to apply the mark start. */
    start: BoundaryPosition
    /** List element to apply the mark end, inclusive. */
    end: BoundaryPosition
    /** Mark to add. */
    markType: M
}

export interface FormatSpanWithText {
    text: string
    marks: MarkMap
}

export type AddMarkOperation = Values<{
    [M in MarkType]: keyof Omit<MarkValue[M], "active"> extends never
    ? AddMarkOperationBase<M> & { attrs?: undefined }
    : AddMarkOperationBase<M> & {
        attrs: Required<Omit<MarkValue[M], "active">>
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
        attrs: MarkValue["comment"]
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
    [M in MarkType]: keyof Omit<MarkValue[M], "active"> extends never
    ? AddMarkOperationInputBase<M> & { attrs?: undefined }
    : AddMarkOperationInputBase<M> & {
        attrs: Required<Omit<MarkValue[M], "active">>
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
        attrs: MarkValue["comment"]
    })
    | (RemoveMarkOperationInputBase<"link"> & {
        /** Data attributes for the mark. */
        attrs?: undefined
    })

type CommentMarkValue = {
    id: string
}

type BooleanMarkValue = { active: boolean }
type LinkMarkValue = { url: string }

export type MarkValue = Assert<
    {
        strong: BooleanMarkValue
        em: BooleanMarkValue
        comment: CommentMarkValue
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

export function applyAddRemoveMark(op: MarkOperation, object: Json, metadata: ListMetadata): Patch[] {
    if (!(metadata instanceof Array)) {
        throw new Error(`Expected list metadata for a list`)
    }

    if (!(object instanceof Array)) {
        throw new Error(`Expected list metadata for a list`)
    }

    // we shall build a list of patches to return
    const patches: Patch[] = []

    // Make an ordered list of all the document positions, walking from left to right
    type Positions = [number, MarkOpsPosition, ListItemMetadata][]
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
    side: MarkOpsPosition,
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

// PVH code comment
// we could radically simplify this by storing opId separately,
// giving em/strong a boolean attrs and treating equality as key/attr equality
// might be worth doing for the AM implementation
export function opsToMarks(ops: Set<MarkOperation>): MarkMap {
    const markMap: MarkMap = {}
    const opIdMap: Record<MarkType, OperationId> = {}

    // Construct a mark map which stores op IDs
    for (const op of ops) {
        const existingOpId = opIdMap[op.markType]
        // To ensure convergence, we don't always apply the operation to the mark map.
        // It only gets applied if its opID is greater than the previous op that
        // affected that value
        if (!markSpec[op.markType].allowMultiple) {
            if (existingOpId === undefined || compareOpIds(op.opId, existingOpId) === 1) {
                opIdMap[op.markType] = op.opId
                if (op.action === "addMark") {
                    markMap[op.markType] = {...op.attrs, active: true }
                }
                else {
                    delete markMap[op.markType]
                }
            }
        } else {
            if (op.action === "addMark" && !markMap[op.markType]?.find(c => c.id === op.attrs.id)) {
                // Keeping the comments in ID-sorted order helps make equality checks easier later
                // because we can just check mark maps for deep equality
                markMap[op.markType] = sortBy([...(markMap[op.markType] || []), op.attrs], c => c.id)
            } else if (op.action === "removeMark") {
                markMap[op.markType] = (markMap[op.markType] || []).filter(c => c.id !== op.attrs.id)
            }
        }
    }

    return markMap
}

export function getActiveMarksAtIndex(metadata: ListMetadata, index: number): MarkMap {
    return opsToMarks(findClosestMarkOpsToLeft({ metadata, index, side: "before" }))
}

/** Given a path to somewhere in the document, return a list of format spans w/ text.
 *  Each span specifies the formatting marks as well as the text within the span.
 *  (This function avoids the need for a caller to manually stitch together
 *  format spans with a text string.)
 */
export function getTextWithFormatting(text: Json, metadata: ListMetadata): Array<FormatSpanWithText> {
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
    let marks: MarkMap = {}
    let visible = 0

    for (const [index, elMeta] of metadata.entries()) {
        let newMarks: MarkMap | undefined

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
function findClosestMarkOpsToLeft(args: {
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
    marks: MarkMap
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

// TODO: what's up with these return types?
export function changeMark(
    inputOp: AddMarkOperationInput | RemoveMarkOperationInput,
    objId: ObjectId,
    meta: ListMetadata,
    obj: Json[] | (Json[] & Record<string, Json>)): DistributiveOmit<AddMarkOperation | RemoveMarkOperation, "opId"> {
    const { action, startIndex, endIndex, markType, attrs } = inputOp

    // TODO: factor this out to a proper per-mark-type config object somewhere
    const startGrows = false
    const endGrows = markSpec[inputOp.markType].inclusive

    let start: BoundaryPosition
    let end: BoundaryPosition

    /**
     *  [start]---["H"]---["e"]---["y"]---[end]
     *        |   |   |   |   |   |   |   |
     *        SA  0B  0A  1B  1A  2B  2A  EB
     *
     * Spans that grow attach to the next/preceding position, sometimes
     * on a different character, so if a span ends on character 1 "e" but should 
     * expand if new text is inserted, we actually attach the end of the span to 
     * character 2's "before" slot.
     */

    if (startGrows && inputOp.startIndex == 0) {
        start = { type: "startOfText" }
    } else if (startGrows) {
        start = { type: "after", elemId: getListElementId(meta, startIndex - 1) }
    } else {
        start = { type: "before", elemId: getListElementId(meta, startIndex) }
    }

    if (endGrows && inputOp.endIndex >= obj.length) {
        end = { type: "endOfText" }
    } else if (endGrows) {
        end = { type: "before", elemId: getListElementId(meta, endIndex) }
    } else {
        end = { type: "after", elemId: getListElementId(meta, endIndex - 1) }
    }

    const partialOp: DistributiveOmit<AddMarkOperation | RemoveMarkOperation, "opId"> = { action, obj: objId, start, end, markType, ...(attrs) && { attrs } }
    return partialOp
}