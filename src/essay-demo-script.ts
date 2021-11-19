import { Trace, TraceEvent } from "./playback"

export const simulateTypingForInputOp = (o: TraceEvent): TraceEvent[] => {
    if (o.action === "insert") {
        return o.values.map((v, i) => ({
            ...o,
            delay: 55 + Math.random() * 20,
            values: [v],
            index: o.index + i,
        }))
    }

    return [o]
}

const initialDemo: Trace = [
    { editorId: "alice", path: [], action: "makeList", key: "text", delay: 0 },
    ...simulateTypingForInputOp({
        editorId: "alice",
        path: ["text"],
        action: "insert",
        index: 0,
        values: "Peritext is a rich-text CRDT.".split(""),
    }),
    { action: "sync", delay: 0 },
    {
        editorId: "alice",
        action: "addMark",
        path: ["text"],
        startIndex: 14,
        endIndex: 22,
        markType: "em",
    },
    {
        editorId: "bob",
        action: "addMark",
        path: ["text"],
        startIndex: 24,
        endIndex: 28,
        markType: "strong",
    },
    { action: "sync", delay: 0 },
]

//             1         2        3
//   0123456789012345678901234578901234567
const formatting = [
    "Bold formatting can overlap with italic.\n",
    "Links conflict when they overlap.\n",
    "Comments can co-exist.\n",
]
const formattingDemo: Trace = [
    { editorId: "alice", path: [], action: "makeList", key: "text", delay: 0 },
    { action: "sync", delay: 0 },

    //            1         2        3
    //  0123456789012345678901234578901234567890
    // 'Bold formatting can overlap with italic.\n',
    ...simulateTypingForInputOp({
        editorId: "alice",
        path: ["text"],
        action: "insert",
        index: 0,
        values: formatting[0].split(""),
    }),
    { action: "sync", delay: 0 },
    {
        editorId: "alice",
        action: "addMark",
        path: ["text"],
        startIndex: 0,
        endIndex: 27,
        markType: "strong",
    },
    {
        editorId: "bob",
        action: "addMark",
        path: ["text"],
        startIndex: 5,
        endIndex: 40,
        markType: "em",
    },
    { action: "sync", delay: 1000 },

    //           1         2        3
    // 0123456789012345678901234578901234567
    // 'Links conflict when they overlap.\n'
    ...simulateTypingForInputOp({
        editorId: "alice",
        path: ["text"],
        action: "insert",
        index: formatting[0].length,
        values: formatting[1].split(""),
    }),
    { action: "sync", delay: 0 },
    {
        editorId: "alice",
        action: "addMark",
        path: ["text"],
        startIndex: formatting[0].length + 0,
        endIndex: formatting[0].length + 19,
        markType: "link",
        attrs: { url: "http://inkandswitch.com" },
    },
    {
        editorId: "bob",
        action: "addMark",
        path: ["text"],
        startIndex: formatting[0].length + 15,
        endIndex: formatting[0].length + 34,
        markType: "link",
        attrs: { url: "http://notion.so" },
    },
    { action: "sync", delay: 0 },

    //            1         2        3
    //  0123456789012345678901234578901234567
    // 'Comments can co-exist.\n'
    ...simulateTypingForInputOp({
        editorId: "alice",
        path: ["text"],
        action: "insert",
        index: formatting[0].length + formatting[1].length,
        values: formatting[2].split(""),
    }),
    { action: "sync", delay: 0 },
    {
        editorId: "alice",
        action: "addMark",
        path: ["text"],
        startIndex: formatting[0].length + formatting[1].length + 0,
        endIndex: formatting[0].length + formatting[1].length + 20,
        markType: "comment",
        attrs: { id: "comment-1" },
    },
    {
        editorId: "bob",
        action: "addMark",
        path: ["text"],
        startIndex: formatting[0].length + formatting[1].length + 9,
        endIndex: formatting[0].length + formatting[1].length + 20,
        markType: "comment",
        attrs: { id: "comment-2" },
    },
    {
        editorId: "bob",
        action: "addMark",
        path: ["text"],
        startIndex: formatting[0].length + formatting[1].length + 9,
        endIndex: formatting[0].length + formatting[1].length + 11,
        markType: "comment",
        attrs: { id: "comment-3" },
    },
    { action: "sync", delay: 0 },
    { editorId: "alice", path: [], action: "makeList", key: "text", delay: 0 },
    { action: "sync", delay: 0 },
]

//             1         2        3
//   0123456789012345678901234578901234567
const expansion = ["Bold formatting expands for new text.\n", "But links retain their size when text comes later."]
const expansionDemo: Trace = [
    //            1         2        3
    //  0123456789012345678901234578901234567
    // 'Bold formatting expands for new text.\n',
    // 'But links retain their size when text comes later.'
    ...simulateTypingForInputOp({
        editorId: "alice",
        path: ["text"],
        action: "insert",
        index: 0,
        values: expansion[0].split("").slice(0, 15).concat([".", "\n"]),
    }),
    { action: "sync", delay: 0 },
    {
        editorId: "alice",
        action: "addMark",
        path: ["text"],
        startIndex: 0,
        endIndex: 15,
        markType: "strong",
    },
    ...simulateTypingForInputOp({
        editorId: "bob",
        path: ["text"],
        action: "insert",
        index: 15,
        values: expansion[0].split("").slice(15, 36),
    }),
    { action: "sync", delay: 0 },
    ...simulateTypingForInputOp({
        editorId: "bob",
        path: ["text"],
        action: "insert",
        index: 38,
        values: "But links...".split(""),
    }),
    { action: "sync", delay: 0 },
    {
        editorId: "alice",
        action: "addMark",
        path: ["text"],
        startIndex: 38 + 4,
        endIndex: 38 + 4 + 5,
        markType: "link",
        attrs: { url: "https://inkandswitch.com" },
    },
    ...simulateTypingForInputOp({
        editorId: "bob",
        path: ["text"],
        action: "insert",
        index: 38 + 9,
        values: " retain their size".split(""),
    }),
    { action: "sync", delay: 0 },
    { editorId: "alice", path: [], action: "makeList", key: "text", delay: 2000 },
    { action: "sync", delay: 0 },
]

export const trace: Trace = [...initialDemo, ...formattingDemo, ...expansionDemo]
