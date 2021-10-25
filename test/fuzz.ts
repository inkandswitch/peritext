import assert from "assert"
import crypto from "crypto"
import Micromerge, { Change } from "../src/micromerge"
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
    const index = Math.floor(Math.random() * length) + 1
    const count = Math.ceil(Math.random() * (length - index))

    console.log(`l ${length} i ${index} c ${count}`)

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

const { doc1, doc2 } = generateDocs("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
const doc1Queue: Change[] = []
const doc2Queue: Change[] = []
const opTypes = ["insert", "remove", "addMark", "removeMark"]

// eslint-disable-next-line no-constant-condition
let totalChanges = 0
while (totalChanges++ < 1_000_000) {
    const randomTarget = (Math.random() < 0.5)
    const doc = randomTarget ? doc1 : doc2
    const queue = randomTarget ? doc1Queue : doc2Queue

    const op = opTypes[Math.floor(Math.random() * opTypes.length)];
    switch (op) {
        case "insert":
            // console.log(`I ${randomTarget ? "doc1" : "doc2"}`)
            queue.push(insertChange(doc))
            break
        case "remove":
            // console.log(`D ${randomTarget ? "doc1" : "doc2"}`)
            queue.push(removeChange(doc))
            break
        case "addMark":
            // console.log(`K ${randomTarget ? "doc1" : "doc2"}`)
            queue.push(addMarkChange(doc))
            break
        case "removeMark":
            // console.log(`R ${randomTarget ? "doc1" : "doc2"}`)
            queue.push(removeMarkChange(doc))
            break
    }

    const shouldSync = (Math.random() < 0.2)
    if (shouldSync) {
        console.log(`M doc1: ${doc1Queue.length} doc2: ${doc2Queue.length}`)

        doc1Queue.forEach(c => doc2.applyChange(c))
        doc2Queue.forEach(c => doc1.applyChange(c))
        doc1Queue.length = 0
        doc2Queue.length = 0 // typical JS "elegance"

        console.log(doc1.getTextWithFormatting(["text"]))
        assert.deepStrictEqual(
            doc1.getTextWithFormatting(["text"]),
            doc2.getTextWithFormatting(["text"]),
        )
    }
}
