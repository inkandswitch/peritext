import { createEditor, initializeDocs } from "./bridge"
import { Publisher } from "./pubsub"
import type { Change } from "./micromerge"
import type { Editor } from "./bridge"
import { Mark } from "prosemirror-model"
import Micromerge from "./micromerge"

const publisher = new Publisher<Array<Change>>()

const editors: { [key: string]: Editor } = {}

const renderMarks = (domNode: Element, marks: Mark[]): void => {
    domNode.innerHTML = marks
        .map(m => `• ${m.type.name} ${Object.keys(m.attrs).length !== 0 ? JSON.stringify(m.attrs) : ""}`)
        .join("<br/>")
}

const aliceDoc = new Micromerge("alice")
const bobDoc = new Micromerge("bob")

initializeDocs(
    [aliceDoc, bobDoc],
    [
        {
            path: [Micromerge.contentKey],
            action: "insert",
            index: 0,
            values: "This is the Peritext editor demo. Press sync to synchronize the editors. Ctrl-B for bold, Ctrl-i for italic, Ctrl-k for link, Ctrl-e for comment".split(
                "",
            ),
        },
        {
            path: [Micromerge.contentKey],
            action: "addMark",
            markType: "strong",
            startIndex: 84,
            endIndex: 88,
        },
        {
            path: [Micromerge.contentKey],
            action: "addMark",
            markType: "em",
            startIndex: 100,
            endIndex: 107,
        },
        {
            path: [Micromerge.contentKey],
            action: "addMark",
            markType: "link",
            attrs: { url: "http://inkandswitch.com" },
            startIndex: 120,
            endIndex: 124,
        },
        {
            path: [Micromerge.contentKey],
            action: "addMark",
            markType: "comment",
            attrs: { id: "1" },
            startIndex: 137,
            endIndex: 144,
        },
    ],
)

const aliceNode = document.querySelector("#alice")
const aliceEditor = aliceNode?.querySelector(".editor")
const aliceChanges = aliceNode?.querySelector(".changes")
const aliceMarks = aliceNode?.querySelector(".marks")

if (aliceNode && aliceEditor && aliceChanges && aliceMarks) {
    editors["alice"] = createEditor({
        actorId: "alice",
        editorNode: aliceEditor,
        changesNode: aliceChanges,
        doc: aliceDoc,
        publisher,
        editable: true,
        handleClickOn: (view, pos, node, nodePos, event, direct) => {
            // Prosemirror calls this once per node that overlaps w/ the clicked pos.
            // We only want to run our callback once, on the innermost clicked node.
            if (!direct) return false

            const marksAtPosition = view.state.doc.resolve(pos).marks()
            renderMarks(aliceMarks, marksAtPosition)
            return false
        },
    })
} else {
    throw new Error(`Didn't find expected node in the DOM`)
}

const bobNode = document.querySelector("#bob")
const bobEditor = bobNode?.querySelector(".editor")
const bobChanges = bobNode?.querySelector(".changes")
if (bobNode && bobEditor && bobChanges) {
    editors["bob"] = createEditor({
        actorId: "bob",
        editorNode: bobEditor,
        changesNode: bobChanges,
        doc: bobDoc,
        publisher,
        editable: true,
        handleClickOn: (view, pos, node, nodePos, event, direct) => {
            // Prosemirror calls this once per node that overlaps w/ the clicked pos.
            // We only want to run our callback once, on the innermost clicked node.
            if (!direct) return false

            const marksAtPosition = view.state.doc.resolve(pos).marks()
            renderMarks(aliceMarks, marksAtPosition)
            return false
        },
    })
} else {
    throw new Error(`Didn't find expected node in the DOM`)
}

for (const editor of Object.values(editors)) {
    editor.queue.drop()
}

// Add a button for syncing the two editors
document.querySelector("#sync")?.addEventListener("click", () => {
    for (const editor of Object.values(editors)) {
        editor.queue.flush()
    }
})
