import { createEditor } from "./bridge"
import { Publisher } from "./pubsub"
import type { Change } from "./micromerge"
import type { Editor } from "./bridge"
import { Mark } from "prosemirror-model"
import Micromerge from "./micromerge"

export type Editors = { [key: string]: Editor }

const publisher = new Publisher<Array<Change>>()

const renderMarks = (domNode: Element, marks: Mark[]): void => {
    domNode.innerHTML = marks
        .map(m => `• ${m.type.name} ${Object.keys(m.attrs).length !== 0 ? JSON.stringify(m.attrs) : ""}`)
        .join("<br/>")
}

const initializeEditor = (name: string) => {
    const node = document.querySelector(`#${name}`)
    const editorNode = node?.querySelector(".editor")
    const changesNode = node?.querySelector(".changes")
    const marks = node?.querySelector(".marks")

    if (!(node && editorNode && changesNode && marks)) {
        throw new Error(`Didn't find expected node in the DOM`)
    }

    const doc = new Micromerge(name)
    // note: technically this could cause problems because we're recreating
    //       the document on each side with no shared history and not syncing, so
    //       it might just be luck / compensating bugs that makes this work
    const { change } = doc.change([{ path: [], action: "makeList", key: Micromerge.contentKey }])

    const editor = createEditor({
        actorId: name,
        editorNode,
        changesNode,
        doc,
        publisher,
        handleClickOn: (view, pos, node, nodePos, event, direct) => {
            // Prosemirror calls this once per node that overlaps w/ the clicked pos.
            // We only want to run our callback once, on the innermost clicked node.
            if (!direct) return false

            const marksAtPosition = view.state.doc.resolve(pos).marks()
            renderMarks(marks, marksAtPosition)
            return false
        },
    })

    editor.queue.enqueue(change)

    return editor
}

initializeEditor("alice")
initializeEditor("bob")
