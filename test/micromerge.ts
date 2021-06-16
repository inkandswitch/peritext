import assert from "assert"
import Micromerge from "../src/micromerge"

describe.only("Micromerge", () => {
    it("can insert and delete text", () => {
        const doc1 = new Micromerge("1234")
        doc1.change([
            { path: [], action: "makeList", key: "text" },
            {
                path: ["text"],
                action: "insert",
                index: 0,
                values: ["a", "b", "c", "d", "e"],
            },
        ])

        doc1.change([
            {
                path: ["text"],
                action: "delete",
                index: 0,
                count: 3,
            },
        ])

        assert.deepStrictEqual(doc1.root.text.join(""), "de")
    })

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

    it("correctly handles concurrent deletion and insertion", () => {
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
            { path: ["text"], action: "insert", index: 4, values: ["c", "a"] },
        ])

        // doc2: insert 'da' to form 'abrxadabra', and format the final 'dabra' in italic
        const change3 = doc2.change([
            { path: ["text"], action: "insert", index: 5, values: ["d", "a"] },
        ])

        // doc1 and doc2 sync their changes
        doc2.applyChange(change2)
        doc1.applyChange(change3)

        // Now both should be in the same state
        assert.deepStrictEqual(doc1.root, {
            text: ["a", "b", "r", "a", "c", "a", "d", "a", "b", "r", "a"],
        })
        assert.deepStrictEqual(doc2.root, {
            text: ["a", "b", "r", "a", "c", "a", "d", "a", "b", "r", "a"],
        })
    })

    it("flattens local formatting operations into flat spans", () => {
        const doc1 = new Micromerge("1234")
        const textChars = "The Peritext editor".split("")

        doc1.change([
            { path: [], action: "makeList", key: "text" },
            {
                path: ["text"],
                action: "insert",
                index: 0,
                values: textChars,
            },
            // Bold the word "Peritext"
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 11,
                markType: "strong",
            },
        ])

        assert.deepStrictEqual(doc1.root.text, textChars)

        assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
            { marks: {}, text: "The " },
            { marks: { strong: true }, text: "Peritext" },
            { marks: {}, text: " editor" },
        ])
    })

    it("correctly merges concurrent overlapping bold and italic", () => {
        const doc1 = new Micromerge("1234")
        const doc2 = new Micromerge("abcd")
        const textChars = "The Peritext editor".split("")

        const change1 = doc1.change([
            { path: [], action: "makeList", key: "text" },
            {
                path: ["text"],
                action: "insert",
                index: 0,
                values: textChars,
            },
        ])

        doc2.applyChange(change1)

        // Now both docs have the text in their state.
        // Concurrently format overlapping spans...
        const change2 = doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 0,
                end: 11,
                markType: "strong",
            },
        ])
        const change3 = doc2.change([
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 18,
                markType: "em",
            },
        ])

        // and swap changes across the remote peers...
        doc2.applyChange(change2)
        doc1.applyChange(change3)

        // Both sides should end up with the usual text:
        assert.deepStrictEqual(doc1.root.text, textChars)
        assert.deepStrictEqual(doc2.root.text, textChars)

        const expectedTextWithFormatting = [
            { marks: { strong: true }, text: "The " },
            { marks: { strong: true, em: true }, text: "Peritext" },
            { marks: { em: true }, text: " editor" },
        ]

        // And the same correct flattened format spans:
        assert.deepStrictEqual(
            doc1.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
        assert.deepStrictEqual(
            doc2.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
    })

    it("correctly merges concurrent bold and unbold", () => {
        const doc1 = new Micromerge("1234")
        const doc2 = new Micromerge("abcd")
        const textChars = "The Peritext editor".split("")

        const change1 = doc1.change([
            { path: [], action: "makeList", key: "text" },
            {
                path: ["text"],
                action: "insert",
                index: 0,
                values: textChars,
            },
        ])

        doc2.applyChange(change1)

        // Now both docs have the text in their state.
        // Concurrently format overlapping spans...
        const change2 = doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 0,
                end: 11,
                markType: "strong",
            },
        ])
        const change3 = doc2.change([
            {
                path: ["text"],
                action: "removeMark",
                start: 4,
                end: 18,
                markType: "strong",
            },
        ])

        // and swap changes across the remote peers...
        doc2.applyChange(change2)
        doc1.applyChange(change3)

        // Both sides should end up with the usual text:
        assert.deepStrictEqual(doc1.root.text, textChars)
        assert.deepStrictEqual(doc2.root.text, textChars)

        const expectedTextWithFormatting = [
            { marks: { strong: true }, text: "The " },
            { marks: {}, text: "Peritext editor" },
        ]

        // And the same correct flattened format spans:
        assert.deepStrictEqual(
            doc1.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
        assert.deepStrictEqual(
            doc2.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
    })

    describe("cursors", () => {
        it("can resolve a cursor position", () => {
            const doc1 = new Micromerge("1234")
            const textChars = "The Peritext editor".split("")
            doc1.change([
                { path: [], action: "makeList", key: "text" },
                {
                    path: ["text"],
                    action: "insert",
                    index: 0,
                    values: textChars,
                },
            ])

            // get a cursor for a path + index
            const cursor = doc1.getCursor(["text"], 5)
            // return { objectId: "1@abcd", elemId: "5@abcd" }

            const currentIndex = doc1.resolveCursor(cursor)

            assert.deepStrictEqual(currentIndex, 5)
        })

        it("increments cursor position when insert happens before cursor", () => {
            const doc1 = new Micromerge("1234")
            const textChars = "The Peritext editor".split("")
            doc1.change([
                { path: [], action: "makeList", key: "text" },
                {
                    path: ["text"],
                    action: "insert",
                    index: 0,
                    values: textChars,
                },
            ])

            // get a cursor for a path + index
            const cursor = doc1.getCursor(["text"], 5)
            // return { objectId: "1@abcd", elemId: "5@abcd" }

            // Insert 3 characters at beginning of the string
            doc1.change([
                {
                    path: ["text"],
                    action: "insert",
                    index: 0,
                    values: ["a", "b", "c"],
                },
            ])

            const currentIndex = doc1.resolveCursor(cursor)

            assert.deepStrictEqual(currentIndex, 5 + 3)
        })

        it("does not move cursor position when insert happens after cursor", () => {
            const doc1 = new Micromerge("1234")
            const textChars = "The Peritext editor".split("")
            doc1.change([
                { path: [], action: "makeList", key: "text" },
                {
                    path: ["text"],
                    action: "insert",
                    index: 0,
                    values: textChars,
                },
            ])

            // get a cursor for a path + index
            const cursor = doc1.getCursor(["text"], 5)
            // return { objectId: "1@abcd", elemId: "5@abcd" }

            // Insert 3 characters after the cursor
            doc1.change([
                {
                    path: ["text"],
                    action: "insert",
                    index: 7,
                    values: ["a", "b", "c"],
                },
            ])

            const currentIndex = doc1.resolveCursor(cursor)

            assert.deepStrictEqual(currentIndex, 5)
        })

        it("moves cursor left if deletion happens before cursor", () => {
            const doc1 = new Micromerge("1234")
            const textChars = "The Peritext editor".split("")
            doc1.change([
                { path: [], action: "makeList", key: "text" },
                {
                    path: ["text"],
                    action: "insert",
                    index: 0,
                    values: textChars,
                },
            ])

            // get a cursor for a path + index
            const cursor = doc1.getCursor(["text"], 5)
            // return { objectId: "1@abcd", elemId: "5@abcd" }

            // Insert 3 characters after the cursor
            doc1.change([
                {
                    path: ["text"],
                    action: "delete",
                    index: 0,
                    count: 3,
                },
            ])

            const currentIndex = doc1.resolveCursor(cursor)

            assert.deepStrictEqual(currentIndex, 5 - 3)
        })

        it("doesn't move cursor if deletion happens after cursor", () => {
            const doc1 = new Micromerge("1234")
            const textChars = "The Peritext editor".split("")
            doc1.change([
                { path: [], action: "makeList", key: "text" },
                {
                    path: ["text"],
                    action: "insert",
                    index: 0,
                    values: textChars,
                },
            ])

            // get a cursor for a path + index
            const cursor = doc1.getCursor(["text"], 5)
            // return { objectId: "1@abcd", elemId: "5@abcd" }

            // Insert 3 characters after the cursor
            doc1.change([
                {
                    path: ["text"],
                    action: "delete",
                    index: 7,
                    count: 3,
                },
            ])

            const currentIndex = doc1.resolveCursor(cursor)

            assert.deepStrictEqual(currentIndex, 5)
        })

        it("returns index 0 if everything before the cursor is deleted", () => {
            const doc1 = new Micromerge("1234")
            const textChars = "The Peritext editor".split("")
            doc1.change([
                { path: [], action: "makeList", key: "text" },
                {
                    path: ["text"],
                    action: "insert",
                    index: 0,
                    values: textChars,
                },
            ])

            // get a cursor for a path + index
            const cursor = doc1.getCursor(["text"], 5)

            // Delete the first 7 chars, including the cursor
            doc1.change([
                {
                    path: ["text"],
                    action: "delete",
                    index: 0,
                    count: 7,
                },
            ])

            const currentIndex = doc1.resolveCursor(cursor)

            assert.deepStrictEqual(currentIndex, 0)
        })
    })
})
