import assert from "assert"
import Micromerge, { Change } from "../src/micromerge"
import { generateDocs } from "./generateDocs"

function addMarkChange(doc: Micromerge) {
    const { change } = doc.change([
        {
            path: ["text"],
            action: "addMark",
            start: 0,
            end: 3,
            markType: "comment",
            attrs: { id: "abc-123" },
        },
    ])
    return change
}

function insertChange(doc: Micromerge) {
    const { change } = doc.change([
        {
            path: ["text"],
            action: "insert",
            index: 0,
            values: "textChars".split(""),
        },
    ])
    // pvh is not a huge fan of the mutable interface
    return change
}

function removeChange(doc: Micromerge) {
    const { change } = doc.change([
        {
            path: ["text"],
            action: "delete",
            index: 0,
            count: 2
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
            console.log(`Inserting into ${randomTarget ? "doc1" : "doc2"}`)
            queue.push(removeChange(doc))
            break
        case "addMark":
            console.log(`Inserting into ${randomTarget ? "doc1" : "doc2"}`)
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

        assert.deepStrictEqual(
            doc1.getTextWithFormatting(["text"]),
            doc2.getTextWithFormatting(["text"]),
        )
        console.log(doc1.getTextWithFormatting(["text"]))
    }
}
