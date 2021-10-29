import crypto from "crypto"
import { Schema } from "prosemirror-model"
import Micromerge from "../src/micromerge"

/* prosemirror boilerplate */
import { ALL_MARKS, schemaSpec } from "./schema"
const schema = new Schema(schemaSpec)
type MarkTypes = "strong" | "em" | "link" | "comment"
// end

const exampleURLs = ["https://inkandswitch.com",
    "https://inkandswitch.com/cambria/",
    "https://inkandswitch.com/peritext/",
    "https://inkandswitch.com/pushpin"]

const commentHistory: string[] = []

function addMarkChange(editor) {
    const length = editor.view.state.doc.textContent.length
    const start = Math.floor(Math.random() * length)
    const end = start + Math.floor(Math.random() * (length - start))
    const markType = ALL_MARKS[Math.floor(Math.random() * ALL_MARKS.length)];
    
    if (markType === "link") {
        // pick one of the four urls we use to encourage adjacent matching spans
        const url = exampleURLs[Math.floor(Math.random() * exampleURLs.length)];
        editor.view.dispatch(
            editor.view.state.tr.addMark(start, end, schema.marks[markType].create({ url }))
        )
    
    }
    else if (markType === "comment") {
        // make a new comment ID and remember it so we can try removing it later 
        const id = "comment-" + crypto.randomBytes(2).toString('hex')
        commentHistory.push(id)
        editor.view.dispatch(
            editor.view.state.tr.addMark(start, end, schema.marks[markType].create({ id }))
        )
    }
    else {
        editor.view.dispatch(
            editor.view.state.tr.addMark(start, end, schema.marks[markType].create())
        )
    }
}

function removeMarkChange(doc: Micromerge) {
    const length = (doc.root.text as any[]).length
    const start = Math.floor(Math.random() * length)
    const end = start + Math.floor(Math.random() * (length - start))
    const markType = ALL_MARKS[Math.floor(Math.random() * ALL_MARKS.length)];

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
function insertChange(editor) {
    const length = editor.view.state.doc.textContent.length
    const index = Math.floor(Math.random() * length)
    const numChars = Math.floor(Math.random() * MAX_CHARS)
    const value = crypto.randomBytes(numChars).toString('hex');

    editor.view.dispatch(
        // The insertion index is a little tricky here--
        // Prosemirror reserves position 0 for the position before our inline span,
        // so position 1 is the leftmost position in the actual text itself
        editor.view.state.tr.insertText(value, index + 1),
    )
}

function removeChange(editor) {
    const length = editor.view.state.doc.textContent.length
    // gklitt: this appears to be a real bug! if you delete everything things go wonky
    const index = Math.floor(Math.random() * length) + 1
    const count = Math.ceil(Math.random() * (length - index))

    // console.log(`l ${length} i ${index} c ${count}`)

    editor.view.dispatch(
        // The insertion index is a little tricky here--
        // Prosemirror reserves position 0 for the position before our inline span,
        // so position 1 is the leftmost position in the actual text itself
        editor.view.state.tr.deleteRange(index + 1, count),
    )
}

const opTypes = [/*"insert", "remove",*/ "addMark" /*, "removeMark"*/]

export function change(editor1, editor2): void {
    const randomTarget = (Math.random() < 0.5)
    const editor = randomTarget ? editor1 : editor2

    const op = opTypes[Math.floor(Math.random() * opTypes.length)];
    switch (op) {
        case "insert":
            // console.log(`I ${randomTarget ? "doc1" : "doc2"}`)
            insertChange(editor)
            break
        case "remove":
            // console.log(`D ${randomTarget ? "doc1" : "doc2"}`)
            removeChange(editor)
            break
        case "addMark":
            // console.log(`K ${randomTarget ? "doc1" : "doc2"}`)
            addMarkChange(editor)
            break
        case "removeMark":
            // console.log(`R ${randomTarget ? "doc1" : "doc2"}`)
            removeMarkChange(editor)
            break
    }
}
