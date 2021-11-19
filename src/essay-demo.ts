import { createEditor } from "./bridge"
import { Publisher } from "./pubsub"
import type { Change } from "./micromerge"
import type { Editor } from "./bridge"
import Micromerge from "./micromerge"
import { executeTraceEvent, Trace } from "./playback"
import { trace } from "./essay-demo-script"

export type Editors = { [key: string]: Editor }

const publisher = new Publisher<Array<Change>>()

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
        handleClickOn: () => false,
        changesNode,
    })

    editor.queue.enqueue(change)

    return editor
}

// This handler gets called 500ms before the sync happens.
// If we keep the sync icon visible for ~1000ms it feels good.
const displaySyncEvent = () => {
    for (const changesNode of document.querySelectorAll(".changes")) {
        changesNode.classList.add("syncing")
        setTimeout(() => {
            changesNode.classList.remove("syncing")
            changesNode.innerHTML = ""
        }, 900)
    }
}

export function* endlessLoop<T>(t: T[]): Generator<T> {
    while (true) {
        for (const e of t) {
            yield e
        }
    }
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

    let playing = true
    const traceGen = endlessLoop(trace)

    const playTrace = async (trace: Trace, editors: Editors, handleSyncEvent: () => void): Promise<void> => {
        if (!playing) { return }

        const event = traceGen.next().value
        await executeTraceEvent(event, editors, handleSyncEvent)
        const delay = event.delay || 1000
        setTimeout(() => playTrace(trace, editors, handleSyncEvent), delay)
    }

    const playPause = () => {
        playing = !playing
        if (playing) {
            playTrace(trace, editors, displaySyncEvent)
        }
    }

    playTrace(trace, editors, displaySyncEvent)

    document.querySelector('#playpause')?.addEventListener("click", playPause)
}

initializeDemo()

