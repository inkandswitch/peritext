import { createEditor } from "./bridge"
import { Publisher } from "./pubsub"
import * as crdt from "./crdt"

import type { Editor } from "./bridge"

const publisher = new Publisher<Array<crdt.Change>>()

const editors: { [key: string]: Editor } = {}

const aliceNode = document.querySelector("#alice")
if (aliceNode) {
    editors["alice"] = createEditor({
        actorId: "alice",
        editorNode: aliceNode,
        initialValue: "alice",
        publisher,
    })
} else {
    throw new Error(`Didn't find expected editor node in the DOM: #alice`)
}

const bobNode = document.querySelector("#bob")
if (bobNode) {
    editors["bob"] = createEditor({
        actorId: "bob",
        editorNode: bobNode,
        initialValue: "bob",
        publisher,
    })
} else {
    throw new Error(`Didn't find expected editor node in the DOM: #alice`)
}
