import type { Editor } from "./bridge"
import { createEditor } from "./bridge"

const editors: { [key: string]: Editor } = {}

const aliceNode = document.querySelector("#alice")
if (aliceNode) {
    editors["alice"] = createEditor({
        actorId: "alice",
        editorNode: aliceNode,
        initialValue: "hello",
    })
} else {
    throw new Error(`Didn't find expected editor node in the DOM: #alice`)
}

const bobNode = document.querySelector("#bob")
if (bobNode) {
    editors["bob"] = createEditor({
        actorId: "bob",
        editorNode: bobNode,
        initialValue: "hello",
    })
} else {
    throw new Error(`Didn't find expected editor node in the DOM: #alice`)
}
