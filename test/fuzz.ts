import assert from "assert"
import crypto from "crypto"
import Micromerge, { ActorId, Change, Clock } from "../src/micromerge"
import { generateDocs } from "./generateDocs"

type MarkTypes = "strong" | "em" | "link" | "comment"
const markTypes: MarkTypes[] = ["strong", "em", "link", "comment"]

const exampleURLs = ["https://inkandswitch.com",
    "https://inkandswitch.com/cambria/",
    "https://inkandswitch.com/peritext/",
    "https://inkandswitch.com/pushpin"]

const commentHistory: string[] = []

function addMarkChange(doc: Micromerge) {
    const length = (doc.root.text as any[]).length
    const start = Math.floor(Math.random() * length)
    const end = start + Math.floor(Math.random() * (length - start))
    const markType = markTypes[Math.floor(Math.random() * markTypes.length)];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharedStuff: any = {
        path: ["text"],
        action: "addMark",
        start,
        end,
        markType,
    }

    if (markType === "link") {
        // pick one of the four urls we use to encourage adjacent matching spans
        const url = exampleURLs[Math.floor(Math.random() * exampleURLs.length)];
        const { change } = doc.change([
            {
                ...sharedStuff,
                attrs: { url },
            },
        ])
        return change
    }
    else if (markType === "comment") {
        // make a new comment ID and remember it so we can try removing it later 
        const id = "comment-" + crypto.randomBytes(2).toString('hex')
        commentHistory.push(id)
        const { change } = doc.change([
            {
                ...sharedStuff,
                attrs: { id },
            },
        ])
        return change
    }
    else {
        const { change } = doc.change([sharedStuff])
        return change
    }
}

function removeMarkChange(doc: Micromerge) {
    const length = (doc.root.text as any[]).length
    const start = Math.floor(Math.random() * length)
    const end = start + Math.floor(Math.random() * (length - start))
    const markType = markTypes[Math.floor(Math.random() * markTypes.length)];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharedStuff: any = {
        path: ["text"],
        action: "addMark",
        start,
        end,
        markType,
    }

    if (markType === "link") {
        const url = exampleURLs[Math.floor(Math.random() * exampleURLs.length)];
        const { change } = doc.change([
            {
                ...sharedStuff,
                attrs: { url } // do we need a URL?
            },
        ])
        return change
    }
    else if (markType === "comment") {
        // note to gklitt: we should probably enumerate the existing comments, right now it just grows
        const id = commentHistory[Math.floor(Math.random() * commentHistory.length)];
        const { change } = doc.change([
            {
                ...sharedStuff,
                attrs: { id },
            },
        ])
        return change
    }
    else {
        const { change } = doc.change([sharedStuff])
        return change
    }

}

const MAX_CHARS = 10
function insertChange(doc: Micromerge) {
    const length = (doc.root.text as any[]).length
    const index = Math.floor(Math.random() * length)
    const numChars = Math.floor(Math.random() * MAX_CHARS)
    const values = crypto.randomBytes(numChars).toString('hex').split('');

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
            count
        },
    ])
    return change
}

const { docs, initialChange } = generateDocs("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 4)
const docIds = docs.map(d => d.actorId)

type SharedHistory = Record<ActorId, Change[]>
const queues: SharedHistory = {}
docIds.forEach(id => queues[id] = [])
queues["doc0"].push(initialChange)

const opTypes = ["insert", "remove", "addMark", "removeMark"]

// eslint-disable-next-line no-constant-condition
let totalChanges = 0
while (totalChanges++ < 1_000_000) {
    const randomTarget = Math.floor(Math.random() * docs.length)
    const doc = docs[randomTarget]
    const queue = queues[docIds[randomTarget]]

    const op = opTypes[Math.floor(Math.random() * opTypes.length)];

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

    const shouldSync = (Math.random() < 0.2)
    if (shouldSync) {

        const left = Math.floor(Math.random() * docs.length)

        let right: number
        do {
            right = Math.floor(Math.random() * docs.length)
        } while (left == right)


        console.log('before', docs[left].clock, docs[right].clock)
        const changesForRight = getMissingChanges(docs[left], docs[right])
        changesForRight.forEach(c => docs[right].applyChange(c))
        
        const changesForLeft = getMissingChanges(docs[right], docs[left])
        changesForLeft.forEach(c => docs[left].applyChange(c))
        console.log('after', docs[left].clock, docs[right].clock)

        // console.log(docs[left].getTextWithFormatting(["text"]))
        assert.deepStrictEqual(docs[left].clock, docs[right].clock)
        assert.deepStrictEqual(
            docs[left].getTextWithFormatting(["text"]),
            docs[right].getTextWithFormatting(["text"]),
        )
    }
}

function changeCompare(c: Change, d: Change): number {
    // c is less than d iff c is a dependency of d
    console.log('comparing: ', [c, d].map(c => [`${c.actor}@${c.seq}`, c.deps]))
    if (c.actor == d.actor) {
        console.log('actors match')
        if (c.seq < d.seq) { return -1 }
        if (c.seq > d.seq) { return 1 }
        return 0
    }
    
    if (d.deps[c.actor] >= c.seq) {
        console.log('d depends on c, so c has to go first')
        return -1
    }
    if (c.deps[d.actor] >= d.seq) {
        console.log('c depends on d, so d has to go first')
        return 1
    }
    console.log("c doesn't depend on d or vice versa")
    return 1
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
    changes.sort((c, d) => changeCompare(c, d))
    console.log('result')
    console.log(changes.map(c => [`${c.actor}@${c.seq}`, c.deps]))
    return changes
}