import { createEditor } from "./bridge"
import { Publisher } from "./pubsub"
import type { Change } from "./micromerge"
import type { Editor } from "./bridge"
import { Mark } from "prosemirror-model"

const publisher = new Publisher<Array<Change>>()

const editors: { [key: string]: Editor } = {}

const renderMarks = (domNode: Element, marks: Mark[]): void => {
    domNode.innerHTML = marks
        .map(
            m =>
                `• ${m.type.name} ${
                    Object.keys(m.attrs).length !== 0
                        ? JSON.stringify(m.attrs)
                        : ""
                }`,
        )
        .join("<br/>")
}

const aliceNode = document.querySelector("#alice")
const aliceEditor = aliceNode?.querySelector(".editor")
const aliceChanges = aliceNode?.querySelector(".changes")
const aliceSteps = aliceNode?.querySelector(".prosemirror-steps")
const aliceMarks = aliceNode?.querySelector(".marks")
if (aliceNode && aliceEditor && aliceChanges && aliceMarks && aliceSteps) {
    editors["alice"] = createEditor({
        actorId: "alice",
        editorNode: aliceEditor,
        changesNode: aliceChanges,
        stepsNode: aliceSteps,
        initialValue: "This is the Peritext editor",
        publisher,
        handleClickOn: (view, pos, node, nodePos, event, direct) => {
            // Prosemirror calls this once per node that overlaps w/ the clicked pos.
            // We only want to run our callback once, on the innermost clicked node.
            if (!direct) return false

            const marksAtPosition = view.state.doc.resolve(pos).marks()
            renderMarks(aliceMarks, marksAtPosition)
            return true
        },
    })
} else {
    throw new Error(`Didn't find expected node in the DOM`)
}

const bobNode = document.querySelector("#bob")
const bobEditor = bobNode?.querySelector(".editor")
const bobChanges = bobNode?.querySelector(".changes")
const bobSteps = bobNode?.querySelector(".prosemirror-steps")
if (bobNode && bobEditor && bobChanges && bobSteps) {
    editors["bob"] = createEditor({
        actorId: "bob",
        editorNode: bobEditor,
        changesNode: bobChanges,
        stepsNode: bobSteps,
        initialValue: "This is the Peritext editor",
        publisher,
        handleClickOn: (view, pos, node, nodePos, event, direct) => {
            // Prosemirror calls this once per node that overlaps w/ the clicked pos.
            // We only want to run our callback once, on the innermost clicked node.
            if (!direct) return false

            const marksAtPosition = view.state.doc.resolve(pos).marks()
            renderMarks(aliceMarks, marksAtPosition)
            return true
        },
    })
} else {
    throw new Error(`Didn't find expected node in the DOM`)
}

// Add a button for connecting/disconnecting the two editors
let connected = true
document.querySelector("#toggle-connect")?.addEventListener("click", e => {
    if (connected) {
        for (const editor of Object.values(editors)) {
            editor.queue.drop()
        }
        if (e.target instanceof HTMLElement) {
            e.target.innerText = "🟢 Connect"
        }
        connected = false
    } else {
        for (const editor of Object.values(editors)) {
            editor.queue.start()
        }
        if (e.target instanceof HTMLElement) {
            e.target.innerText = "❌ Disconnect"
        }
        connected = true
    }
})

//
