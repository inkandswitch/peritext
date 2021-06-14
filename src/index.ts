import type { Editor } from "./bridge"
import { createEditor } from "./bridge"

const editors: { [key: string]: Editor } = {}

const aliceNode = document.querySelector("#alice")
if (aliceNode) {
    editors["alice"] = createEditor("alice", aliceNode, "hello")
} else {
    throw new Error(`Didn't find expected editor node in the DOM: #alice`)
}

const bobNode = document.querySelector("#bob")
if (bobNode) {
    editors["bob"] = createEditor("bob", bobNode, "hello")
} else {
    throw new Error(`Didn't find expected editor node in the DOM: #alice`)
}
