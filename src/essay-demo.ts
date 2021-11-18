import { createEditor } from "./bridge"
import { Publisher } from "./pubsub"
import type { Change, Operation } from "./micromerge"
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

// Returns a natural language description of an op in our CRDT.
// Just for demo / debug purposes, doesn't cover all cases
function describeOp(op: Operation): string {
    if (op.action === "set" && op.elemId !== undefined) {
        return `insert <strong>"${op.value}"</strong>`
    } else if (op.action === "del" && op.elemId !== undefined) {
        return `delete <strong>${String(op.elemId)}</strong>`
    } else if (op.action === "addMark") {
        return `add mark <strong>${op.markType}</strong>`
    } else if (op.action === "removeMark") {
        return `remove mark <strong>${op.markType}</strong>`
    } else {
        return op.action
    }
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
        doc,
        publisher,
        handleClickOn: (view, pos, node, nodePos, event, direct) => false,
        changesNode,
    })

    editor.queue.enqueue(change)

    return editor
}

// This handler gets called 500ms before the sync happens.
// If we keep the sync icon visible for ~700ms it feels good.
const displaySyncEvent = () => {
    const syncElement = document.querySelector(".sync-indicator") as HTMLElement
    syncElement!.style.visibility = "visible"
    setTimeout(() => {
        syncElement!.style.visibility = "hidden"
    }, 700)
}

const initializeDemo = () => {
    const names = ["alice", "bob"]
    const editors = names.reduce(
        (editors: Editors, name: string) => ({ ...editors, [name]: initializeEditor(name) }),
        {},
    )

    // disable live sync & use manual calls to flush()
    for (const editor of Object.values(editors)) {
        editor.queue.drop()
    }

    playTrace(trace, editors, displaySyncEvent)
}

initializeDemo()
