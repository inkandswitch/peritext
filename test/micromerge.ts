import assert from "assert"
import Micromerge from "../src/micromerge"

describe("Micromerge", () => {
    it("records local changes in the deps clock", () => {
        const doc1 = new Micromerge("1234")
        const doc2 = new Micromerge("abcd")

        // Generate a change on doc1
        const change1 = doc1.change([
            { path: [], action: "makeList", key: "text" },
            {
                path: ["text"],
                action: "insert",
                index: 0,
                values: ["a"],
            },
        ])

        // Generate change2 on doc2, which depends on change1
        doc2.applyChange(change1)
        const change2 = doc2.change([
            { path: ["text"], action: "insert", index: 1, values: ["b"] },
        ])

        // We should be able to successfully apply change2 on doc1 now;
        // its only dependency is change1, which should be recorded in doc1's clock
        // of changes that it's observed.
        assert.doesNotThrow(() => {
            doc1.applyChange(change2)
        })

        assert.deepStrictEqual(doc1.root.text, ["a", "b"])
        assert.deepStrictEqual(doc2.root.text, ["a", "b"])
    })

    it("correctly handles concurrent deletion and insertion with formatting", () => {
        const doc1 = new Micromerge("1234"),
            doc2 = new Micromerge("abcd")

        // insert 'abrxabra'
        const change1 = doc1.change([
            { path: [], action: "makeList", key: "text" },
            {
                path: ["text"],
                action: "insert",
                index: 0,
                values: ["a", "b", "r", "x", "a", "b", "r", "a"],
            },
        ])

        doc2.applyChange(change1)

        // doc1: delete the 'x', format the middle 'rab' in bold, then insert 'ca' to form 'abracabra'
        const change2 = doc1.change([
            { path: ["text"], action: "delete", index: 3, count: 1 },
            {
                path: ["text"],
                action: "formatSpan",
                start: 2,
                end: 4,
                type: "b",
            },
            { path: ["text"], action: "insert", index: 4, values: ["c", "a"] },
        ])

        // doc2: insert 'da' to form 'abrxadabra', and format the final 'dabra' in italic
        const change3 = doc2.change([
            { path: ["text"], action: "insert", index: 5, values: ["d", "a"] },
            {
                path: ["text"],
                action: "formatSpan",
                start: 5,
                end: 9,
                type: "i",
            },
        ])

        // doc1 and doc2 sync their changes
        doc2.applyChange(change2)
        doc1.applyChange(change3)

        // Now both should be in the same state
        assert.deepStrictEqual(doc1.root, {
            text: ["a", "b", "r", "a", "c", "a", "d", "a", "b", "r", "a"],
        })
        assert.deepStrictEqual(doc1.formatting["1@1234"].chars, [
            "",
            "",
            "b",
            "b",
            "b",
            "b",
            "b,i",
            "b,i",
            "b,i",
            "i",
            "i",
        ])
        assert.deepStrictEqual(doc2.root, {
            text: ["a", "b", "r", "a", "c", "a", "d", "a", "b", "r", "a"],
        })
        assert.deepStrictEqual(doc2.formatting["1@1234"].chars, [
            "",
            "",
            "b",
            "b",
            "b",
            "b",
            "b,i",
            "b,i",
            "b,i",
            "i",
            "i",
        ])
    })
})
