import crypto from "crypto"
import { Schema } from "prosemirror-model"
import { Editor } from "./bridge"

/* prosemirror boilerplate */
import { ALL_MARKS, schemaSpec, isMarkType } from "./schema"
const schema = new Schema(schemaSpec)
type MarkTypes = "strong" | "em" | "link" | "comment"
// end

const exampleURLs = ["https://inkandswitch.com",
    "https://inkandswitch.com/cambria/",
    "https://inkandswitch.com/peritext/",
    "https://inkandswitch.com/pushpin"]

const commentHistory: string[] = []

function addMarkChange(editor: Editor) {
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

function removeMarkChange(editor: Editor) {
    const length = editor.view.state.doc.textContent.length
    const start = Math.floor(Math.random() * length)
    const end = start + Math.floor(Math.random() * (length - start))
    const markType = ALL_MARKS[Math.floor(Math.random() * ALL_MARKS.length)];
    
    if (!isMarkType(markType)) {
        throw new Error(`Invalid mark type: ${markType}`)
    }

    if (markType === "link") {
        // pick one of the four urls we use to encourage adjacent matching spans
        const url = exampleURLs[Math.floor(Math.random() * exampleURLs.length)];
        editor.view.dispatch(
            editor.view.state.tr.removeMark(start, end)
        )
    
    }
    else if (markType === "comment") {
        // make a new comment ID and remember it so we can try removing it later 
        const id = "comment-" + crypto.randomBytes(2).toString('hex')
        commentHistory.push(id)
        editor.view.dispatch(
            editor.view.state.tr.removeMark(start, end)
        )
    }
    else {
        console.log('removing')

        editor.view.dispatch(
            editor.view.state.tr.removeMark(start, end)
        )
    }
}

const MAX_CHARS = 10
function insertChange(editor: Editor) {
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

function removeChange(editor: Editor) {
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

const opTypes = ["insert", "remove", "addMark", "removeMark"]

export function change(editor1: Editor, editor2: Editor): void {
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
