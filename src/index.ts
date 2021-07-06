import { createEditor } from "./bridge"
import { Publisher } from "./pubsub"
import type { Change } from "./micromerge"
import type { Editor } from "./bridge"

const publisher = new Publisher<Array<Change>>()

const editors: { [key: string]: Editor } = {}

const aliceNode = document.querySelector("#alice")
const aliceEditor = aliceNode?.querySelector(".editor")
const aliceChanges = aliceNode?.querySelector(".changes")
if (aliceNode && aliceEditor && aliceChanges) {
    editors["alice"] = createEditor({
        actorId: "alice",
        editorNode: aliceEditor,
        changesNode: aliceChanges,
        initialValue: "text",
        publisher,
    })
} else {
    throw new Error(`Didn't find expected editor node in the DOM: #alice`)
}

const bobNode = document.querySelector("#bob")
const bobEditor = bobNode?.querySelector(".editor")
const bobChanges = bobNode?.querySelector(".changes")
if (bobNode && bobEditor && bobChanges) {
    editors["bob"] = createEditor({
        actorId: "bob",
        editorNode: bobEditor,
        changesNode: bobChanges,
        initialValue: "text",
        publisher,
    })
} else {
    throw new Error(`Didn't find expected editor node in the DOM: #alice`)
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
