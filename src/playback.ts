import { Editors } from "."
import { TraceSpec } from "../test/micromerge"
import { applyPatchToTransaction } from "./bridge"
import { InputOperation } from "./micromerge"

type TraceEvent = (InputOperation & { editorId: string }) | { action: "sync" } | { action: "restart" }
type Trace = TraceEvent[]

/** Specify concurrent edits on two editors, which sync at the end */
const makeTrace = (traceSpec: TraceSpec): Trace => {
    if (!traceSpec.initialText || !traceSpec.inputOps1 || !traceSpec.inputOps2) {
        throw new Error(`Expected full trace spec`)
    }

    const trace: Trace = []

    trace.push({ editorId: "alice", path: [], action: "makeList", key: "text" })
    trace.push({ action: "sync" })
    trace.push({
        editorId: "alice",
        path: ["text"],
        action: "insert",
        index: 0,
        values: traceSpec.initialText.split(""),
    })
    trace.push({ action: "sync" })

    traceSpec.inputOps1.map(o => trace.push({ editorId: "alice", path: ["text"], ...o }))
    traceSpec.inputOps2.map(o => trace.push({ editorId: "bob", path: ["text"], ...o }))
    trace.push({ action: "sync" })

    return trace
}

export const trace = makeTrace({
    initialText: "abrxabra",
    // doc1: delete the 'x', then insert 'ca' to form 'abracabra'
    inputOps1: [
        { action: "delete", index: 3, count: 1 },
        { action: "insert", index: 4, values: ["c", "a"] },
    ],
    // doc2: insert 'da' to form 'abrxadabra'
    inputOps2: [{ action: "insert", index: 5, values: ["d", "a"] }],
    expectedResult: [{ marks: {}, text: "abracadabra" }],
})

const executeTraceEvent = (event: TraceEvent, editors: Editors): void => {
    switch (event.action) {
        case "sync": {
            Object.values(editors).forEach(e => e.queue.flush())
            break
        }
        case "restart": {
            break
        }
        default: {
            const editor = editors[event.editorId]
            console.log(editors)
            if (!editor) { throw new Error("Encountered a trace event for a missing editor") }

            const { change, patches } = editor.doc.change([event])
            let transaction = editor.view.state.tr
            for (const patch of patches) {
                transaction = applyPatchToTransaction(transaction, patch)
            }
            // lol
            editor.view.state = editor.view.state.apply(transaction)
            editor.view.updateState(editor.view.state)
            editor.queue.enqueue(change)
        }
    }
}


export const playTrace = async (trace: Trace, editors: Editors): Promise<void> => {
    for (const event of trace) {
        executeTraceEvent(event, editors)
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}
