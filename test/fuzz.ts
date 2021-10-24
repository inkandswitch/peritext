import assert from "assert"
import crypto from "crypto"
import Micromerge, { Change } from "../src/micromerge"
import { generateDocs } from "./generateDocs"

function addMarkChange(doc: Micromerge) {
    const length = (doc.root.text as any[]).length
    const start = Math.floor(Math.random() * length)
    const end = start + Math.floor(Math.random() * (length - start - 1))
    const { change } = doc.change([
        {
            path: ["text"],
            action: "addMark",
            start,
            end,
            markType: "comment",
            attrs: { id: `abc-${Math.floor(Math.random() * 1000)}` },
        },
    ])
    return change
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
    const index = Math.floor(Math.random() * length)
    const count = Math.floor(Math.random() * (length - index - 2))

    // console.log(`l ${length} i ${index} c ${ count}`)

    const { change } = doc.change([
        {
            path: ["text"],
            action: "delete",
            index,
            count
        },
    ])
    // pvh is not a huge fan of the mutable interface
    return change
}

// eslint-disable-next-line no-constant-condition
const [doc1, doc2] = generateDocs("alphabet")
const doc1Queue: Change[] = []
const doc2Queue: Change[] = []
const opTypes = ["insert", "remove", "addMark"]

while(true) {
    const randomTarget = (Math.random() < 0.5)
    const doc = randomTarget ? doc1 : doc2
    const queue = randomTarget ? doc1Queue : doc2Queue

    const op = opTypes[Math.floor(Math.random() * opTypes.length)];
    switch(op) {
        case "insert":
            console.log(`Inserting into ${randomTarget ? "doc1" : "doc2"}`)
            queue.push(insertChange(doc))
            break
        case "remove":
            console.log(`Deleting from ${randomTarget ? "doc1" : "doc2"}`)
            queue.push(removeChange(doc))
            break
        case "addMark":
            console.log(`Adding mark into ${randomTarget ? "doc1" : "doc2"}`)
            queue.push(addMarkChange(doc))
            break
    }

    const shouldSync = (Math.random() < 0.1)
    if (shouldSync) {
        console.log(`Merging ${doc1Queue.length} doc1 changes`)
        console.log(`Merging ${doc2Queue.length} doc2 changes`)

        doc1Queue.forEach(c => doc2.applyChange(c))
        doc2Queue.forEach(c => doc1.applyChange(c))
        doc1Queue.length = 0
        doc2Queue.length = 0 // typical JS "elegance"

        console.log(doc1.root.text.join(''))
        assert.deepStrictEqual(
            doc1.getTextWithFormatting(["text"]),
            doc2.getTextWithFormatting(["text"]),
        )
    }
}
