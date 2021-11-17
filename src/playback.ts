import { Editors } from "."
import { TraceSpec, PathlessInputOperation } from "../test/micromerge"
import { applyPatchToTransaction } from "./bridge"
import { InputOperation } from "./micromerge"

type TraceEvent = ((InputOperation & { editorId: string }) | { action: "sync" } | { action: "restart" }) & { delay?: number }
type Trace = TraceEvent[]

/** Specify concurrent edits on two editors, which sync at the end */
const makeTrace = (traceSpec: TraceSpec): Trace => {
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

const simulateTypingForInputOp = (name: string, o: PathlessInputOperation): TraceEvent[] => {
    if ("values" in o) {
        return o.values.map((v, i) => ({
            ...o,
            editorId: name,
            path: ["text"],
            delay: 200,
            values: [v],
            index: o.index + i
        }))
    }

    return [{ ...o, editorId: name, path: ["text"] }]
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
    // eslint-disable-next-line no-constant-condition
    while (true) {
        for (const event of trace) {
            const delay = event.delay || 1000
            await new Promise(resolve => setTimeout(resolve, delay));
            executeTraceEvent(event, editors)
        }
    }
}
