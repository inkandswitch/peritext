import assert from "assert"
import crypto from "crypto"
import Micromerge, { Change } from "../src/micromerge"
import { generateDocs } from "./generateDocs"

type MarkTypes = "strong" | "em"
const markTypes: MarkTypes[] = ["strong", "em"]

function addConflictingMarkChange(doc: Micromerge) {
    const length = (doc.root.text as any[]).length
    const start = Math.floor(Math.random() * length)
    const end = start + Math.floor(Math.random() * (length - start - 1))
    const markType = markTypes[Math.floor(Math.random() * markTypes.length)];
    const { change } = doc.change([
        {
            path: ["text"],
            action: "addMark",
            start,
            end,
            markType
        },
    ])
    return change
}

function removeMarkChange(doc: Micromerge) {
    const length = (doc.root.text as any[]).length
    const start = Math.floor(Math.random() * length)
    const end = start + Math.floor(Math.random() * (length - start - 1))
    const markType = markTypes[Math.floor(Math.random() * markTypes.length)];
    const { change } = doc.change([
        {
            path: ["text"],
            action: "removeMark",
            start,
            end,
            markType
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

const [doc1, doc2] = generateDocs("alphabet")
const doc1Queue: Change[] = []
const doc2Queue: Change[] = []
const opTypes = ["insert", "remove", "addMark", "removeMark"]

// eslint-disable-next-line no-constant-condition
let totalChanges = 0
while(totalChanges++ < 1_000_000) {
    if (totalChanges % 1000 == 0) { console.log("Total changes: ", totalChanges) }
    const randomTarget = (Math.random() < 0.5)
    const doc = randomTarget ? doc1 : doc2
    const queue = randomTarget ? doc1Queue : doc2Queue

    const op = opTypes[Math.floor(Math.random() * opTypes.length)];
    switch(op) {
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
            queue.push(addConflictingMarkChange(doc))
            break
        case "removeMark":
            // console.log(`R ${randomTarget ? "doc1" : "doc2"}`)
            queue.push(removeMarkChange(doc))
            break
        }

    const shouldSync = (Math.random() < 0.1)
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
