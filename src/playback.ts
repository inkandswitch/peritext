import { Editors } from "."
import { TraceSpec, PathlessInputOperation } from "../test/micromerge"
import { applyPatchToTransaction } from "./bridge"
import { InputOperation } from "./micromerge"

export type TraceEvent = ((InputOperation & { editorId: string }) | { action: "sync" } | { action: "restart" }) & {
    delay?: number
}
export type Trace = TraceEvent[]

/** Specify concurrent edits on two editors, which sync at the end */
const testToTrace = (traceSpec: TraceSpec): Trace => {
    if (!traceSpec.initialText || !traceSpec.inputOps1 || !traceSpec.inputOps2) {
        throw new Error(`Expected full trace spec`)
    }

    const trace: Trace = []

    trace.push({ editorId: "alice", path: [], action: "makeList", key: "text", delay: 0 })
    trace.push({ action: "sync", delay: 0 })
    trace.push({
        editorId: "alice",
        path: ["text"],
        action: "insert",
        index: 0,
        values: traceSpec.initialText.split(""),
    })
    trace.push({ action: "sync" })

    traceSpec.inputOps1.forEach(o => trace.push(...simulateTypingForInputOp("alice", o)))
    traceSpec.inputOps2.forEach(o => trace.push(...simulateTypingForInputOp("bob", o)))
    trace.push({ action: "sync" })

    return trace
}

export const simulateTypingForInputOp = (name: string, o: PathlessInputOperation): TraceEvent[] => {
    if (o.action === "insert") {
        return o.values.map((v, i) => ({
            ...o,
            editorId: name,
            path: ["text"],
            delay: 50,
            values: [v],
            index: o.index + i,
        }))
    }

    return [{ ...o, editorId: name, path: ["text"] }]
}

export const trace = testToTrace({
    initialText: "The Peritext editor",
    inputOps1: [
        {
            action: "addMark",
            startIndex: 0,
            endIndex: 12,
            markType: "strong",
        },
    ],
    inputOps2: [
        {
            action: "addMark",
            startIndex: 4,
            endIndex: 19,
            markType: "em",
        },
    ],
    expectedResult: [
        { marks: { strong: { active: true } }, text: "The " },
        {
            marks: { strong: { active: true }, em: { active: true } },
            text: "Peritext",
        },
        { marks: { em: { active: true } }, text: " editor" },
    ],
})

console.log({ trace })

const executeTraceEvent = async (event: TraceEvent, editors: Editors, handleSyncEvent: () => void): Promise<void> => {
    switch (event.action) {
        case "sync": {
            const demiDelay = (event.delay) ? event.delay / 2 : 500
            // Call the sync event handler, then wait before actually syncing.
            // This makes the sync indicator seem more realistic because it
            // starts activating before the sync completes.
            handleSyncEvent()
            await new Promise(resolve => setTimeout(resolve, demiDelay))
            Object.values(editors).forEach(e => e.queue.flush())

            // Wait after the sync happens, to let the user see the results
            await new Promise(resolve => setTimeout(resolve, demiDelay))
            break
        }
        case "restart": {
            break
        }
        default: {
            const editor = editors[event.editorId]
            if (!editor) {
                throw new Error("Encountered a trace event for a missing editor")
            }

            const { change, patches } = editor.doc.change([event])
            let transaction = editor.view.state.tr
            for (const patch of patches) {
                transaction = applyPatchToTransaction(transaction, patch)
            }
            editor.view.state = editor.view.state.apply(transaction)
            editor.view.updateState(editor.view.state)
            editor.queue.enqueue(change)
            editor.outputDebugForChange(change)
        }
    }
}

export const playTrace = async (trace: Trace, editors: Editors, handleSyncEvent: () => void): Promise<void> => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        for (const event of trace) {
            console.log({ event })
            const delay = event.delay || 100
            await new Promise(resolve => setTimeout(resolve, delay))
            await executeTraceEvent(event, editors, handleSyncEvent)
        }
    }
}
