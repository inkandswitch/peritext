import { createEditor } from "./bridge"
import { Publisher } from "./pubsub"
import type { Change } from "./micromerge"
import type { Editor } from "./bridge"
import { Mark } from "prosemirror-model"
import Micromerge from "./micromerge"
import { playTrace, trace } from "./playback"

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
    const { change } = doc.change([
        { path: [], action: "makeList", key: Micromerge.contentKey },
    ])


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

const initializeDemo = () => {
    const names = ["alice", "bob"]
    const editors = names.reduce((editors: Editors, name: string) => ({ ...editors, [name]: initializeEditor(name) }), {})

    for (const editor of Object.values(editors)) {
        editor.queue.drop()
    }

    playTrace(trace, editors)
}

initializeDemo()