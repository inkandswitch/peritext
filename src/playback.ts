import { TraceSpec } from "../test/micromerge"
import { applyPatchToTransaction, Editor } from "./bridge"
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

const executeTraceEvent = (event: TraceEvent, editor1: Editor, editor2: Editor): void {
    switch (event.action) {
        case "sync": {
            console.log('sync')
            editor1.queue.flush()
            editor2.queue.flush()
            break
        }
        default: {
            const editor = (event.editorId === "alice") ? editor1 : editor2
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


export const playTrace = async (trace: Trace, editor1: Editor, editor2: Editor): void => {
    for (const event of trace) {
        executeTraceEvent(event, editor1, editor2)
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}
