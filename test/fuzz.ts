import assert from "assert"
import crypto from "crypto"
import Micromerge, { ActorId, Change } from "../src/micromerge"
import { generateDocs } from "./generateDocs"
import util from "util"
import { isEqual } from "lodash"
import { debug } from "./micromerge"
import fs from "fs"
import path from "path"
import { v4 as uuid } from "uuid"

type MarkTypes = "strong" | "em" | "link" | "comment"
const markTypes: MarkTypes[] = ["link"] //, "em", "link", "comment"]

const exampleURLs = [
    "https://inkandswitch.com",
    "https://inkandswitch.com/cambria/",
    "https://inkandswitch.com/peritext/",
    "https://inkandswitch.com/pushpin",
]

const commentHistory: string[] = []

function addMarkChange(doc: Micromerge) {
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
        // pick one of the four urls we use to encourage adjacent matching spans
        const url = exampleURLs[Math.floor(Math.random() * exampleURLs.length)]
        const { change } = doc.change([
            {
                ...sharedStuff,
                attrs: { url },
            },
        ])
        return change
    } else if (markType === "comment") {
        // make a new comment ID and remember it so we can try removing it later
        const id = "comment-" + crypto.randomBytes(2).toString("hex")
        commentHistory.push(id)
        const { change } = doc.change([
            {
                ...sharedStuff,
                attrs: { id },
            },
        ])
        return change
    } else {
        const { change } = doc.change([sharedStuff])
        return change
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
        const { change } = doc.change([
            {
                ...sharedStuff,
                attrs: { url }, // do we need a URL?
            },
        ])
        return change
    } else if (markType === "comment") {
        // note to gklitt: we should probably enumerate the existing comments, right now it just grows
        const id = commentHistory[Math.floor(Math.random() * commentHistory.length)]
        const { change } = doc.change([
            {
                ...sharedStuff,
                attrs: { id },
            },
        ])
        return change
    } else {
        const { change } = doc.change([sharedStuff])
        return change
    }
}

const MAX_CHARS = 10
function insertChange(doc: Micromerge) {
    const length = (doc.root.text as any[]).length
    const index = Math.floor(Math.random() * length)
    const numChars = Math.floor(Math.random() * MAX_CHARS)
    const values = crypto.randomBytes(numChars).toString("hex").split("")

    const { change } = doc.change([
        {
            path: ["text"],
            action: "insert",
            index,
            values,
        },
    ])
    // pvh is not a huge fan of the mutable interface
    return change
}

function removeChange(doc: Micromerge) {
    const length = (doc.root.text as any[]).length
    // gklitt: this appears to be a real bug! if you delete everything things go wonky
    const index = Math.floor(Math.random() * length) + 1
    const count = Math.ceil(Math.random() * (length - index))

    // console.log(`l ${length} i ${index} c ${count}`)

    const { change } = doc.change([
        {
            path: ["text"],
            action: "delete",
            index,
            count,
        },
    ])
    return change
}

const { docs, initialChange } = generateDocs("ABCDE", 3)
const docIds = docs.map(d => d.actorId)

type SharedHistory = Record<ActorId, Change[]>
const queues: SharedHistory = {}
docIds.forEach(id => (queues[id] = []))
queues["doc1"].push(initialChange)

const opTypes = ["insert", "remove", "addMark", "removeMark"]

// eslint-disable-next-line no-constant-condition

// let allChanges = []
let syncs = []

while (true) {
    const randomTarget = Math.floor(Math.random() * docs.length)
    const doc = docs[randomTarget]
    const queue = queues[docIds[randomTarget]]

    const op = opTypes[Math.floor(Math.random() * opTypes.length)]

    switch (op) {
        case "insert":
            queue.push(insertChange(doc))
            break
        case "remove":
            queue.push(removeChange(doc))
            break
        case "addMark":
            queue.push(addMarkChange(doc))
            break
        case "removeMark":
            queue.push(removeMarkChange(doc))
            break
    }

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

        applyChanges(docs[right], getMissingChanges(docs[left], docs[right]))
        applyChanges(docs[left], getMissingChanges(docs[right], docs[left]))

        const leftText = docs[left].getTextWithFormatting(["text"])
        const rightText = docs[right].getTextWithFormatting(["text"])

        if (!isEqual(leftText, rightText)) {
            const filename = `../traces/fail-${uuid()}.json`
            fs.writeFileSync(
                path.resolve(__dirname, filename),
                JSON.stringify({
                    queues,
                    left: {
                        doc: docs[left].actorId,
                        text: leftText,
                        meta: docs[left].metadata,
                    },
                    right: {
                        doc: docs[right].actorId,
                        text: rightText,
                        meta: docs[right].metadata,
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

function applyChanges(document: Micromerge, changes: Change[]) {
    let iterations = 0
    while (changes.length > 0) {
        const change = changes.shift()
        if (!change) {
            return
        }
        try {
            // console.log("applying", document.actorId, change)
            document.applyChange(change)
        } catch {
            changes.push(change)
        }
        if (iterations++ > 10000) {
            throw "applyChanges did not converge"
        }
    }
}

function getMissingChanges(source: Micromerge, target: Micromerge) {
    const sourceClock = source.clock
    const targetClock = target.clock
    const changes = []
    for (const [actor, number] of Object.entries(sourceClock)) {
        if (targetClock[actor] === undefined) {
            changes.push(...queues[actor].slice(0, number))
        }
        if (targetClock[actor] < number) {
            changes.push(...queues[actor].slice(targetClock[actor], number))
        }
    }
    return changes
}
