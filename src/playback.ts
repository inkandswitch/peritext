import { TraceSpec } from "../test/micromerge"
import { Editor } from "./bridge"
import Micromerge, { InputOperation } from "./micromerge"

type TraceEvent = (InputOperation & { editorId: string }) | { action: "sync" }
type Trace = TraceEvent[]

/** Specify concurrent edits on two editors, which sync at the end */
const makeTrace = (traceSpec: TraceSpec): Trace => {
    const initialText = traceSpec.initialText
    if (initialText === undefined) {
        throw new Error(`Expected initial text`)
    }

    const trace: Trace = []

    trace.push({ editorId: "alice", path: [], action: "makeList", key: "text" })
    trace.push({
        editorId: "alice",
        path: ["text"],
        action: "insert",
        index: 0,
        values: initialText.split(""),
    })
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

export const playTrace = (trace: Trace, editor1: Editor, editor2: Editor) => {
    for (const event of trace) {
        switch (event.action) {
            case "sync": {
                editor1.queue.flush()
                editor2.queue.flush()
                break
            }
            default: {
                if (event.editorId === "alice") {
                    editor1.doc.change([event])
                } else {
                    editor2.doc.change([event])
                }
            }
        }
    }
}
