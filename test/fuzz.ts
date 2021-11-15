import assert from "assert"
import crypto from "crypto"
import { isEqual } from "lodash"
import fs from "fs"
import path from "path"
import { v4 as uuid } from "uuid"
import { getMissingChanges, applyChanges } from "./merge"
import Micromerge, { ActorId, Change, Patch } from "../src/micromerge"
import { generateDocs } from "./generateDocs"
import { accumulatePatches, assertDocsEqual } from "./accumulatePatches"

function assertUnreachable(x: never): never {
    throw new Error("Didn't expect to get here" + x);
}

type OpTypes = "insert" | "remove" | "addMark" | "removeMark"
const opTypes: OpTypes[] = ["insert", "remove", "addMark", "removeMark"]

type MarkTypes = "strong" | "em" | "link" | "comment"
const markTypes: MarkTypes[] = ["strong"]

const exampleURLs = "ABC".split("").map(letter => `${letter}.com`)

const commentHistory: string[] = []

function addMarkChange(doc: Micromerge) {
    const length = (doc.root.text as Json[]).length
    const startIndex = Math.floor(Math.random() * length)
    const endIndex = startIndex + Math.floor(Math.random() * (length - startIndex)) + 1
    const markType = markTypes[Math.floor(Math.random() * markTypes.length)]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharedStuff: any = {
        path: ["text"],
        action: "addMark",
        startIndex,
        endIndex,
        markType,
    }

    if (markType === "link") {
        // pick one of the four urls we use to encourage adjacent matching spans
        const url = exampleURLs[Math.floor(Math.random() * exampleURLs.length)]
        return doc.change([
            {
                ...sharedStuff,
                attrs: { url },
            },
        ])
    } else if (markType === "comment") {
        // make a new comment ID and remember it so we can try removing it later
        const id = "comment-" + crypto.randomBytes(2).toString("hex")
        commentHistory.push(id)
        return doc.change([
            {
                ...sharedStuff,
                attrs: { id },
            },
        ])
    } else {
        return doc.change([sharedStuff])
    }
}

function removeMarkChange(doc: Micromerge) {
    const length = (doc.root.text as any[]).length
    const startIndex = Math.floor(Math.random() * length)
    const endIndex = startIndex + Math.floor(Math.random() * (length - startIndex)) + 1
    const markType = markTypes[Math.floor(Math.random() * markTypes.length)]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharedStuff: any = {
        path: ["text"],
        action: "addMark",
        startIndex,
        endIndex,
        markType,
    }

    if (markType === "link") {
        const url = exampleURLs[Math.floor(Math.random() * exampleURLs.length)]
        return doc.change([
            {
                ...sharedStuff,
                attrs: { url }, // do we need a URL?
            },
        ])
    } else if (markType === "comment") {
        // note to gklitt: we should probably enumerate the existing comments, right now it just grows
        const id = commentHistory[Math.floor(Math.random() * commentHistory.length)]
        return doc.change([
            {
                ...sharedStuff,
                attrs: { id },
            },
        ])
    } else {
        return doc.change([sharedStuff])
    }
}

const MAX_CHARS = 2
function insertChange(doc: Micromerge) {
    const length = (doc.root.text as any[]).length
    const index = Math.floor(Math.random() * length)
    const numChars = Math.floor(Math.random() * MAX_CHARS)
    const values = crypto.randomBytes(numChars).toString("hex").split("")

    return doc.change([
        {
            path: ["text"],
            action: "insert",
            index,
            values,
        },
    ])
}

function removeChange(doc: Micromerge) {
    const length = (doc.root.text as any[]).length
    // gklitt: this appears to be a real bug! if you delete everything things go wonky
    const index = Math.floor(Math.random() * length) + 1
    const count = Math.ceil(Math.random() * (length - index))

    // console.log(`l ${length} i ${index} c ${count}`)

    const { change, patches } = doc.change([
        {
            path: ["text"],
            action: "delete",
            index,
            count,
        },
    ])
    return { change, patches }
}

function handleOp(op: OpTypes, doc: Micromerge): { change: Change, patches: Patch[] } {
    switch (op) {
        case "insert":
            return insertChange(doc)
        case "remove":
            return removeChange(doc)
        case "addMark":
            return addMarkChange(doc)
        case "removeMark":
            return removeMarkChange(doc)
        default:
            assertUnreachable(op)
    }
}

const { docs, patches: allPatches, initialChange } = generateDocs("ABCDE", 3)
const docIds = docs.map(d => d.actorId)

type SharedHistory = Record<ActorId, Change[]>
export const queues: SharedHistory = {}
docIds.forEach(id => (queues[id] = []))
queues["doc1"].push(initialChange)

const syncs = []
// eslint-disable-next-line no-constant-condition
while (true) {
    const randomTarget = Math.floor(Math.random() * docs.length)
    const doc = docs[randomTarget]
    const queue = queues[docIds[randomTarget]]
    const patchList = allPatches[randomTarget]

    const op = opTypes[Math.floor(Math.random() * opTypes.length)]

    const { change, patches } = handleOp(op, doc)
    queue.push(change)
    patchList.push(...patches)


    const shouldSync = true // (Math.random() < 0.2)
    if (shouldSync) {
        const left = Math.floor(Math.random() * docs.length)

        let right: number
        do {
            right = Math.floor(Math.random() * docs.length)
        } while (left == right)

        // console.log("merging", docs[left].actorId, docs[right].actorId)
        syncs.push({
            left: docs[left].actorId,
            right: docs[right].actorId,
            missingLeft: getMissingChanges(docs[left], docs[right]),
            missingRight: getMissingChanges(docs[right], docs[left]),
        })
        // console.log(util.inspect(getMissingChanges(docs[left], docs[right]), true, 10))
        // console.log(util.inspect(getMissingChanges(docs[right], docs[left]), true, 10))

        const rightPatches = applyChanges(docs[right], getMissingChanges(docs[left], docs[right]))
        const leftPatches = applyChanges(docs[left], getMissingChanges(docs[right], docs[left]))

        allPatches[right].push(...rightPatches)
        allPatches[left].push(...leftPatches)

        const leftText = docs[left].getTextWithFormatting(["text"])
        const rightText = docs[right].getTextWithFormatting(["text"])

        assertDocsEqual(accumulatePatches(allPatches[right]), rightText)
        assertDocsEqual(accumulatePatches(allPatches[left]), leftText)

        if (!isEqual(leftText, rightText)) {
            const filename = `../traces/fail-${uuid()}.json`
            fs.writeFileSync(
                path.resolve(__dirname, filename),
                JSON.stringify({
                    queues,
                    left: {
                        doc: docs[left].actorId,
                        text: leftText,
                        // @ts-ignore -- reach into private metadata, it's fine
                        meta: docs[left].metadata["1@doc1"].map(item => ({
                            ...item,
                            // show mark op sets as arrays in JSON
                            markOpsBefore: item.markOpsBefore && [...item.markOpsBefore],
                            markOpsAfter: item.markOpsAfter && [...item.markOpsAfter],
                        })),
                    },
                    right: {
                        doc: docs[right].actorId,
                        text: rightText,
                        // @ts-ignore -- reach into private metadata, it's fine
                        meta: docs[right].metadata["1@doc1"].map(item => ({
                            ...item,
                            // show mark op sets as arrays in JSON
                            markOpsBefore: item.markOpsBefore && [...item.markOpsBefore],
                            markOpsAfter: item.markOpsAfter && [...item.markOpsAfter],
                        })),
                    },
                    syncs,
                }),
            )
            console.log(`wrote failed trace to ${filename}`)
        }

        assert.deepStrictEqual(docs[left].clock, docs[right].clock)
        assert.deepStrictEqual(leftText, rightText)
    }
}

