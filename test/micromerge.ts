import assert from "assert"
import Micromerge, { InputOperation, Patch } from "../src/micromerge"
import type { RootDoc } from "../src/bridge"
import { inspect } from "util"

const defaultText = "The Peritext editor"
const textChars = defaultText.split("")

const debug = (obj: any) => {
    console.log(inspect(obj, false, 4))
}

/** Create and return two Micromerge documents with the same text content.
 *  Useful for creating a baseline upon which to play further changes
 */
const generateDocs = (text: string = defaultText): [Micromerge, Micromerge] => {
    const doc1 = new Micromerge("doc1")
    const doc2 = new Micromerge("doc2")
    const textChars = text.split("")

    // Generate a change on doc1
    const { change: change1 } = doc1.change([
        { path: [], action: "makeList", key: "text" },
        {
            path: ["text"],
            action: "insert",
            index: 0,
            values: textChars,
        },
    ])

    // Generate change2 on doc2, which depends on change1
    doc2.applyChange(change1)
    return [doc1, doc2]
}

describe("Micromerge", () => {
    it("can insert and delete text", () => {
        const [doc1] = generateDocs("abcde")

        doc1.change([
            {
                path: ["text"],
                action: "delete",
                index: 0,
                count: 3,
            },
        ])

        const root = doc1.getRoot<RootDoc>()
        if (root.text) {
            assert.deepStrictEqual(root.text.join(""), "de")
        } else {
            assert.fail("Doc does not contain text")
        }
    })

    it("records local changes in the deps clock", () => {
        const [doc1, doc2] = generateDocs("a")
        const { change: change2 } = doc2.change([
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
        const [doc1, doc2] = generateDocs("abrxabra")

        // doc1: delete the 'x', format the middle 'rab' in bold, then insert 'ca' to form 'abracabra'
        const { change: change2 } = doc1.change([
            { path: ["text"], action: "delete", index: 3, count: 1 },
            { path: ["text"], action: "insert", index: 4, values: ["c", "a"] },
        ])

        // doc2: insert 'da' to form 'abrxadabra', and format the final 'dabra' in italic
        const { change: change3 } = doc2.change([
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
        const [doc1] = generateDocs()

        doc1.change([
            // Bold the word "Peritext"
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 11,
                markType: "strong",
            },
        ])

        console.log(
            inspect(
                {
                    doc1: doc1.getTextWithFormatting(["text"]),
                },
                false,
                4,
            ),
        )

        assert.deepStrictEqual(doc1.root.text, textChars)

        assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
            { marks: {}, text: "The " },
            { marks: { strong: { active: true } }, text: "Peritext" },
            { marks: {}, text: " editor" },
        ])
    })

    it("correctly merges concurrent overlapping bold and italic", () => {
        const [doc1, doc2] = generateDocs()

        const { change: change1 } = doc1.change([
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
        const { change: change2 } = doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 0,
                end: 11,
                markType: "strong",
            },
        ])
        const { change: change3 } = doc2.change([
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 18,
                markType: "em",
            },
        ])

        // and swap changes across the remote peers...
        const patchesOnDoc2 = doc2.applyChange(change2)
        const patchesOnDoc1 = doc1.applyChange(change3)

        console.log(
            inspect(
                {
                    patchesOnDoc1,
                    patchesOnDoc2,
                },
                false,
                4,
            ),
        )

        // Both sides should end up with the usual text:
        assert.deepStrictEqual(doc1.root.text, textChars)
        assert.deepStrictEqual(doc2.root.text, textChars)

        const expectedTextWithFormatting = [
            { marks: { strong: { active: true } }, text: "The " },
            {
                marks: { strong: { active: true }, em: { active: true } },
                text: "Peritext",
            },
            { marks: { em: { active: true } }, text: " editor" },
        ]

        const formatted1 = doc1.getTextWithFormatting(["text"])
        const formatted2 = doc2.getTextWithFormatting(["text"])

        // And the same correct flattened format spans:
        assert.deepStrictEqual(formatted1, expectedTextWithFormatting)
        assert.deepStrictEqual(formatted2, expectedTextWithFormatting)

        // Check the patches that got generated on both sides.

        // On doc2, we're applying strong from 0 to 11, but there's already em
        // from 4 to 18, so we need to apply the strong in two separate spans:
        assert.deepStrictEqual(patchesOnDoc2, [
            {
                action: "addMark",
                start: 0,
                end: 3,
                markType: "strong",
                path: ["text"],
            },
            {
                action: "addMark",
                start: 4,
                end: 11,
                markType: "strong",
                path: ["text"],
            },
        ])

        // on doc1, we're applying em from 4 to 18, but there's already strong
        // from 0 to 11, so we need to apply the em in two separate spans:
        assert.deepStrictEqual(patchesOnDoc1, [
            {
                action: "addMark",
                start: 4,
                end: 11,
                markType: "em",
                path: ["text"],
            },
            {
                action: "addMark",
                start: 12,
                end: 18,
                markType: "em",
                path: ["text"],
            },
        ])
    })

    it("updates format span indexes when chars are inserted before", () => {
        const [doc1] = generateDocs()
        doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 11,
                markType: "strong",
            },
        ])

        assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
            { marks: {}, text: "The " },
            { marks: { strong: { active: true } }, text: "Peritext" },
            { marks: {}, text: " editor" },
        ])

        // When we insert some text at the beginning,
        // the formatting should stay attached to the same characters
        doc1.change([
            {
                path: ["text"],
                action: "insert",
                index: 0,
                values: "Hello to ".split(""),
            },
        ])

        assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
            { marks: {}, text: "Hello to The " },
            { marks: { strong: { active: true } }, text: "Peritext" },
            { marks: {}, text: " editor" },
        ])
    })

    it("correctly merges concurrent bold and unbold", () => {
        const [doc1, doc2] = generateDocs()

        // Now both docs have the text in their state.
        // Concurrently format overlapping spans...
        const { change: change2 } = doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 0,
                end: 11,
                markType: "strong",
            },
        ])
        const { change: change3 } = doc2.change([
            {
                path: ["text"],
                action: "removeMark",
                start: 4,
                end: 18,
                markType: "strong",
            },
        ])

        // and swap changes across the remote peers...
        const patchesOnDoc2: Patch[] = doc2.applyChange(change2)
        const patchesOnDoc1: Patch[] = doc1.applyChange(change3)

        // Both sides should end up with the usual text:
        assert.deepStrictEqual(doc1.root.text, textChars)
        assert.deepStrictEqual(doc2.root.text, textChars)

        const expectedTextWithFormatting = [
            { marks: { strong: { active: true } }, text: "The " },
            { marks: {}, text: "Peritext editor" },
        ]

        const text1 = doc1.getTextWithFormatting(["text"])
        const text2 = doc2.getTextWithFormatting(["text"])

        // debug({ text1, text2 })

        // And the same correct flattened format spans:
        assert.deepStrictEqual(text1, expectedTextWithFormatting)
        assert.deepStrictEqual(text2, expectedTextWithFormatting)

        console.log("patches")
        debug({ patchesOnDoc1, patchesOnDoc2 })

        assert.deepStrictEqual(patchesOnDoc1, [
            {
                path: ["text"],
                action: "removeMark",
                start: 4,
                end: 11,
                markType: "strong",
            },
        ])

        assert.deepStrictEqual(patchesOnDoc2, [
            {
                path: ["text"],
                action: "addMark",
                start: 0,
                end: 3,
                markType: "strong",
            },
        ])
    })

    it("doesn't update format span indexes when chars are inserted after", () => {
        const [doc1] = generateDocs()
        doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 11,
                markType: "strong",
            },
        ])

        assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
            { marks: {}, text: "The " },
            { marks: { strong: { active: true } }, text: "Peritext" },
            { marks: {}, text: " editor" },
        ])

        // When we insert some text after the bold span,
        // the formatting should stay attached to the same characters
        doc1.change([
            {
                path: ["text"],
                action: "insert",
                index: 19,
                values: " is great".split(""),
            },
        ])

        assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
            { marks: {}, text: "The " },
            { marks: { strong: { active: true } }, text: "Peritext" },
            { marks: {}, text: " editor is great" },
        ])
    })

    it("updates format span indexes when chars are deleted before", () => {
        const [doc1] = generateDocs()
        doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 11,
                markType: "strong",
            },
        ])

        assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
            { marks: {}, text: "The " },
            { marks: { strong: { active: true } }, text: "Peritext" },
            { marks: {}, text: " editor" },
        ])

        // When we delete some text before the bold span,
        // the formatting should stay attached to the same characters
        doc1.change([
            {
                path: ["text"],
                action: "delete",
                index: 0,
                count: 4,
            },
        ])

        assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
            { marks: { strong: { active: true } }, text: "Peritext" },
            { marks: {}, text: " editor" },
        ])
    })

    it("updates format span indexes when chars are deleted after", () => {
        const [doc1] = generateDocs()
        doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 11,
                markType: "strong",
            },
        ])

        assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
            { marks: {}, text: "The " },
            { marks: { strong: { active: true } }, text: "Peritext" },
            { marks: {}, text: " editor" },
        ])

        // When we delete some text after the bold span,
        // the formatting should stay attached to the same characters
        doc1.change([
            {
                path: ["text"],
                action: "delete",
                index: 12,
                count: 7,
            },
        ])

        assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
            { marks: {}, text: "The " },
            { marks: { strong: { active: true } }, text: "Peritext" },
        ])
    })

    it("correctly handles spans that have been collapsed to zero width", () => {
        const [doc1] = generateDocs()

        doc1.change([
            // add strong mark to the word "Peritext" in "The Peritext editor"
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 11,
                markType: "strong",
            },

            // delete all characters inside "Peritext"
            {
                path: ["text"],
                action: "delete",
                index: 4,
                count: 8,
            },
        ])

        const { patches: insertPatches } = doc1.change([
            // insert a new character where the word used to be
            {
                path: ["text"],
                action: "insert",
                index: 4,
                values: ["x"],
            },
        ])

        console.log(inspect(doc1.getTextWithFormatting(["text"]), false, 4))

        // Confirm the new document has the correct content
        assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
            { marks: {}, text: "The x editor" },
        ])

        // Confirm that the generated patch has the correct content.
        // In particular, the character shouldn't have any formatting
        // because we deleted all of the bolded text.
        assert.deepStrictEqual(insertPatches, [
            {
                action: "insert",
                path: [Micromerge.contentKey],
                index: 4,
                values: ["x"],
                marks: {},
            },
        ])
    })

    it("correctly merges concurrent bold and insertion at the mark boundary", () => {
        const [doc1, doc2] = generateDocs()

        // In doc1, we format the word "Peritext" as bold
        const { change: change1 } = doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 11,
                markType: "strong",
            },
        ])

        // Concurrently, in doc2, we add asterisks before and after the word "Peritext"
        const { change: change2 } = doc2.change([
            {
                path: ["text"],
                action: "insert",
                index: 4,
                values: ["*"],
            },
            {
                path: ["text"],
                action: "insert",
                index: 13,
                values: ["*"],
            },
        ])

        // Apply the concurrent changes to the respective other document
        doc2.applyChange(change1)
        doc1.applyChange(change2)

        // Both sides should end up with the text with asterisks
        assert.deepStrictEqual(
            doc1.root.text,
            "The *Peritext* editor".split(""),
        )
        assert.deepStrictEqual(
            doc2.root.text,
            "The *Peritext* editor".split(""),
        )

        // The asterisks should not be bold
        const expectedTextWithFormatting = [
            { marks: {}, text: "The *" },
            { marks: { strong: { active: true } }, text: "Peritext" },
            { marks: {}, text: "* editor" },
        ]

        assert.deepStrictEqual(
            doc1.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
        assert.deepStrictEqual(
            doc2.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
    })

    it("correctly handles insertion where one mark ends and another begins", () => {
        const [doc1, doc2] = generateDocs()

        // In doc1, we format the word "Peritext" as bold, and " editor" as italic
        const { change: change1 } = doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 11,
                markType: "strong",
            },
            {
                path: ["text"],
                action: "addMark",
                start: 12,
                end: 18,
                markType: "em",
            },
        ])

        // Concurrently, in doc2, we add a footnote after "Peritext"
        const { change: change2 } = doc2.change([
            {
                path: ["text"],
                action: "insert",
                index: 12,
                values: "[1]".split(""),
            },
        ])

        // Apply the concurrent changes to the respective other document
        doc2.applyChange(change1)
        doc1.applyChange(change2)

        // Both sides should end up with the text with footnote
        assert.deepStrictEqual(
            doc1.root.text,
            "The Peritext[1] editor".split(""),
        )
        assert.deepStrictEqual(
            doc2.root.text,
            "The Peritext[1] editor".split(""),
        )

        // The footnote marker should be neither bold nor italic
        const expectedTextWithFormatting = [
            { marks: {}, text: "The " },
            { marks: { strong: { active: true } }, text: "Peritext" },
            { marks: {}, text: "[1]" },
            { marks: { em: { active: true } }, text: " editor" },
        ]

        const text1 = doc1.getTextWithFormatting(["text"])
        const text2 = doc2.getTextWithFormatting(["text"])

        debug({ text1, text2 })

        assert.deepStrictEqual(text1, expectedTextWithFormatting)
        assert.deepStrictEqual(text2, expectedTextWithFormatting)
    })

    it("handles an insertion at a boundary between bold and unbolded spans", () => {
        const [doc1, doc2] = generateDocs("AC")

        // In doc1, we format "AC" as bold, then unbold "C"
        const { change: change1 } = doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 0,
                end: 1,
                markType: "strong",
            },
            {
                path: ["text"],
                action: "removeMark",
                start: 1,
                end: 1,
                markType: "strong",
            },
        ])

        // Concurrently, in doc2, we insert "B" in between
        const { change: change2 } = doc2.change([
            {
                path: ["text"],
                action: "insert",
                index: 1,
                values: ["B"],
            },
        ])

        // Apply the concurrent changes to the respective other document
        doc2.applyChange(change1)
        doc1.applyChange(change2)

        assert.deepStrictEqual(doc1.root.text, "ABC".split(""))
        assert.deepStrictEqual(doc2.root.text, "ABC".split(""))

        // The B should be bold
        const expectedTextWithFormatting = [
            { marks: { strong: { active: true } }, text: "AB" },
            { marks: {}, text: "C" },
        ]

        assert.deepStrictEqual(
            doc1.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
        assert.deepStrictEqual(
            doc2.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
    })

    it("handles an insertion at boundary between unbolded and bold spans", () => {
        const [doc1, doc2] = generateDocs("AC")

        // In doc1, we format "AC" as bold, then unbold "A"
        const { change: change1 } = doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 0,
                end: 1,
                markType: "strong",
            },
            {
                path: ["text"],
                action: "removeMark",
                start: 0,
                end: 0,
                markType: "strong",
            },
        ])

        // Concurrently, in doc2, we insert "B" in between
        const { change: change2 } = doc2.change([
            {
                path: ["text"],
                action: "insert",
                index: 1,
                values: ["B"],
            },
        ])

        // Apply the concurrent changes to the respective other document
        doc2.applyChange(change1)
        doc1.applyChange(change2)

        assert.deepStrictEqual(doc1.root.text, "ABC".split(""))
        assert.deepStrictEqual(doc2.root.text, "ABC".split(""))

        // The B should be bold
        const expectedTextWithFormatting = [
            { marks: {}, text: "A" },
            { marks: { strong: { active: true } }, text: "BC" },
        ]

        assert.deepStrictEqual(
            doc1.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
        assert.deepStrictEqual(
            doc2.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
    })

    it("correctly handles an addMark boundary that is a tombstone", () => {
        const [doc1, doc2] = generateDocs("The *Peritext* editor")

        // In doc1, we format "*Peritext*" as bold and then delete the asterisks
        const { change: change1 } = doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 13,
                markType: "strong",
            },
            {
                path: ["text"],
                action: "delete",
                index: 4,
                count: 1,
            },
            {
                path: ["text"],
                action: "delete",
                index: 12,
                count: 1,
            },
        ])

        // Concurrently, in doc2, we add underscores inside of the asterisks
        // so that the text reads "The *_Peritext_* editor"
        const { change: change2 } = doc2.change([
            {
                path: ["text"],
                action: "insert",
                index: 5,
                values: ["_"],
            },
            {
                path: ["text"],
                action: "insert",
                index: 14,
                values: ["_"],
            },
        ])

        // Apply the concurrent changes to the respective other document
        doc2.applyChange(change1)
        doc1.applyChange(change2)

        // Both sides should end up with the same text
        assert.deepStrictEqual(
            doc1.root.text,
            "The _Peritext_ editor".split(""),
        )
        assert.deepStrictEqual(
            doc2.root.text,
            "The _Peritext_ editor".split(""),
        )

        // The underscores should be bold, because the bold span ran from asterisk
        // to asterisk, and the underscores were inside of the asterisks
        const expectedTextWithFormatting = [
            { marks: {}, text: "The " },
            { marks: { strong: { active: true } }, text: "_Peritext_" },
            { marks: {}, text: " editor" },
        ]

        assert.deepStrictEqual(
            doc1.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
        assert.deepStrictEqual(
            doc2.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
    })

    it("handles an insertion into a deleted span with mark", () => {
        const [doc1, doc2] = generateDocs()

        // Format "Peritext" as bold in both documents
        const { change: change1 } = doc1.change([
            {
                path: ["text"],
                action: "addMark",
                start: 4,
                end: 11,
                markType: "strong",
            },
        ])
        doc2.applyChange(change1)

        // In doc1, delete the word "Peritext"
        const { change: change2 } = doc1.change([
            {
                path: ["text"],
                action: "delete",
                index: 4,
                count: 8,
            },
        ])
        assert.deepStrictEqual(doc1.root.text, "The  editor".split(""))

        // Concurrently, in doc2, change "Peritext" to "Paratext"
        const { change: change3 } = doc2.change([
            {
                path: ["text"],
                action: "delete",
                index: 5,
                count: 3,
            },
            {
                path: ["text"],
                action: "insert",
                index: 5,
                values: "ara".split(""),
            },
        ])
        assert.deepStrictEqual(doc2.root.text, "The Paratext editor".split(""))

        // Apply the concurrent changes to the respective other document
        doc2.applyChange(change2)
        doc1.applyChange(change3)

        // Both sides should end up with the same text. The outcome doesn't
        // really make sense, but it's standard behaviour for CRDTs...
        // see also: https://github.com/automerge/automerge/issues/401
        assert.deepStrictEqual(doc1.root.text, "The ara editor".split(""))
        assert.deepStrictEqual(doc2.root.text, "The ara editor".split(""))

        // The "ara" should be bold because it was inserted into the middle of a
        // span that was bold at the time of insertion
        const expectedTextWithFormatting = [
            { marks: {}, text: "The " },
            { marks: { strong: { active: true } }, text: "ara" },
            { marks: {}, text: " editor" },
        ]

        assert.deepStrictEqual(
            doc1.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
        assert.deepStrictEqual(
            doc2.getTextWithFormatting(["text"]),
            expectedTextWithFormatting,
        )
    })

    describe("patches", () => {
        // In the simplest case, when a change is applied immediately to another peer,
        // it simply generates the original input operations as the patch
        it("produces the correct patch for applying a simple insertion", () => {
            const [doc1, doc2] = generateDocs()

            const inputOps: InputOperation[] = [
                {
                    path: ["text"],
                    action: "insert",
                    index: 7,
                    values: ["a"],
                },
            ]
            const { change: insertChange } = doc1.change(inputOps)
            const patch = doc2.applyChange(insertChange)
            assert.deepStrictEqual(
                patch,
                inputOps.map(op => ({ ...op, marks: {} })),
            )
        })

        // Sometimes the patch that gets returned isn't identical to the original input op.
        // A simple example is when two peers concurrently insert text.
        // We need to adjust one of the insertion indexes.
        it("produces a patch with adjusted insertion index on concurrent inserts", () => {
            const [doc1, doc2] = generateDocs()

            // Doc 1 and Doc 2 start out synchronized.

            // Insert "a" at index 1 on doc 1
            doc1.change([
                {
                    path: ["text"],
                    action: "insert",
                    index: 1,
                    values: ["a", "b", "c"],
                },
            ])

            // Insert "b" at index 2 on doc 2
            const { change: change2 } = doc2.change([
                {
                    path: ["text"],
                    action: "insert",
                    index: 2,
                    values: ["b"],
                },
            ])

            // Apply change from doc 2 to doc 1.
            // Was originally inserted at index 2 on doc 2,
            // but that's now index 5 on doc 1, because 3 characters were inserted before it.
            const patch = doc1.applyChange(change2)
            assert.deepStrictEqual(patch, [
                {
                    path: ["text"],
                    action: "insert",
                    index: 5,
                    values: ["b"],
                    marks: {},
                },
            ])
        })

        // In the simplest case, when a change is applied immediately to another peer,
        // it simply generates the original input operations as the patch
        it("produces the correct patch for applying a simple deletion", () => {
            const [doc1, doc2] = generateDocs()

            const inputOps: InputOperation[] = [
                {
                    path: ["text"],
                    action: "delete",
                    index: 5,
                    count: 1,
                },
            ]
            const { change: insertChange } = doc1.change(inputOps)
            const patch = doc2.applyChange(insertChange)
            assert.deepStrictEqual(patch, inputOps)
        })

        // Sometimes, because of how the CRDT logic works, there's not an exact 1:1
        // between input ops and patches. For example, a multi-char deletion
        // turns into a patch that contains two single-char deletion operations.
        it("turns a multi-char deletion into multiple single char deletions", () => {
            const [doc1, doc2] = generateDocs()

            const inputOps: InputOperation[] = [
                {
                    path: ["text"],
                    action: "delete",
                    index: 5,
                    count: 2,
                },
            ]
            const { change: insertChange } = doc1.change(inputOps)
            const patch = doc2.applyChange(insertChange)
            assert.deepStrictEqual(patch, [
                {
                    path: ["text"],
                    action: "delete",
                    index: 5,
                    count: 1,
                },
                {
                    path: ["text"],
                    action: "delete",
                    index: 5,
                    count: 1,
                },
            ])
        })
    })

    describe.skip("skipped", () => {
        describe("comments", () => {
            it("returns a single comment in the flattened spans", () => {
                const [doc1] = generateDocs()

                doc1.change([
                    // Comment on the word "Peritext"
                    {
                        path: ["text"],
                        action: "addMark",
                        start: 4,
                        end: 11,
                        markType: "comment",
                        attrs: { id: "abc-123" },
                    },
                ])

                assert.deepStrictEqual(doc1.root.text, textChars)

                assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
                    { marks: {}, text: "The " },
                    {
                        marks: { comment: [{ id: "abc-123" }] },
                        text: "Peritext",
                    },
                    { marks: {}, text: " editor" },
                ])
            })

            it("correctly flattens two comments from the same user", () => {
                const [doc1] = generateDocs()

                doc1.change([
                    // Comment on "The Peritext"
                    {
                        path: ["text"],
                        action: "addMark",
                        start: 0,
                        end: 11,
                        markType: "comment",
                        attrs: { id: "abc-123" },
                    },
                    // Comment on "Peritext editor"
                    {
                        path: ["text"],
                        action: "addMark",
                        start: 4,
                        end: 18,
                        markType: "comment",
                        attrs: { id: "def-789" },
                    },
                ])

                assert.deepStrictEqual(doc1.root.text, textChars)

                assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
                    { marks: { comment: [{ id: "abc-123" }] }, text: "The " },
                    {
                        marks: {
                            comment: [{ id: "abc-123" }, { id: "def-789" }],
                        },
                        text: "Peritext",
                    },
                    {
                        marks: { comment: [{ id: "def-789" }] },
                        text: " editor",
                    },
                ])
            })

            // This case shouldn't be any different from the previous test;
            // we don't really care which node comments are added on since
            // adding a comment is inherently a commutative operation.
            it("correctly overlaps two comments from different users", () => {
                const [doc1, doc2] = generateDocs()

                const { change: change2 } = doc1.change([
                    // Comment on the word "The Peritext"
                    {
                        path: ["text"],
                        action: "addMark",
                        start: 0,
                        end: 11,
                        markType: "comment",
                        attrs: { id: "abc-123" },
                    },
                ])

                const { change: change3 } = doc2.change([
                    // Comment on "Peritext Editor"
                    {
                        path: ["text"],
                        action: "addMark",
                        start: 4,
                        end: 18,
                        markType: "comment",
                        attrs: { id: "def-789" },
                    },
                ])

                // Exchange edits
                doc2.applyChange(change2)
                doc1.applyChange(change3)

                // Confirm that both peers converge to same result -- one link wins
                assert.deepStrictEqual(
                    doc1.getTextWithFormatting(["text"]),
                    doc2.getTextWithFormatting(["text"]),
                )

                assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
                    { marks: { comment: [{ id: "abc-123" }] }, text: "The " },
                    {
                        marks: {
                            comment: [{ id: "abc-123" }, { id: "def-789" }],
                        },
                        text: "Peritext",
                    },
                    {
                        marks: { comment: [{ id: "def-789" }] },
                        text: " editor",
                    },
                ])
            })
        })

        describe("links", () => {
            it("returns a single link in the flattened spans", () => {
                const [doc1] = generateDocs()

                doc1.change([
                    // Link on the word "Peritext"
                    {
                        path: ["text"],
                        action: "addMark",
                        start: 4,
                        end: 11,
                        markType: "link",
                        attrs: { url: "https://inkandswitch.com" },
                    },
                ])

                assert.deepStrictEqual(doc1.root.text, textChars)

                assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
                    { marks: {}, text: "The " },
                    {
                        marks: {
                            link: {
                                active: true,
                                url: "https://inkandswitch.com",
                            },
                        },
                        text: "Peritext",
                    },
                    { marks: {}, text: " editor" },
                ])
            })

            it("arbitrarily chooses one link as the winner when fully overlapping", () => {
                const [doc1, doc2] = generateDocs()
                const { change: change2 } = doc1.change([
                    {
                        path: ["text"],
                        action: "addMark",
                        start: 4,
                        end: 11,
                        markType: "link",
                        attrs: { url: "https://inkandswitch.com" },
                    },
                ])

                const { change: change3 } = doc2.change([
                    {
                        path: ["text"],
                        action: "addMark",
                        start: 4,
                        end: 11,
                        markType: "link",
                        attrs: { url: "https://google.com" },
                    },
                ])

                // Exchange edits
                doc2.applyChange(change2)
                doc1.applyChange(change3)

                // Confirm that both peers converge to same result -- one link wins
                assert.deepStrictEqual(
                    doc1.getTextWithFormatting(["text"]),
                    doc2.getTextWithFormatting(["text"]),
                )

                assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
                    { marks: {}, text: "The " },
                    {
                        marks: {
                            link: { active: true, url: "https://google.com" },
                        },
                        text: "Peritext",
                    },
                    { marks: {}, text: " editor" },
                ])
            })

            it("arbitrarily chooses one link as the winner when partially overlapping", () => {
                const [doc1, doc2] = generateDocs()
                const { change: change2 } = doc1.change([
                    {
                        path: ["text"],
                        action: "addMark",
                        start: 0,
                        end: 11,
                        markType: "link",
                        attrs: { url: "https://inkandswitch.com" },
                    },
                ])

                const { change: change3 } = doc2.change([
                    {
                        path: ["text"],
                        action: "addMark",
                        start: 4,
                        end: 18,
                        markType: "link",
                        attrs: { url: "https://google.com" },
                    },
                ])

                // Exchange edits
                doc2.applyChange(change2)
                doc1.applyChange(change3)

                // Confirm that both peers converge to same result
                assert.deepStrictEqual(
                    doc1.getTextWithFormatting(["text"]),
                    doc2.getTextWithFormatting(["text"]),
                )

                assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), [
                    {
                        marks: {
                            link: {
                                active: true,
                                url: "https://inkandswitch.com",
                            },
                        },
                        text: "The ",
                    },
                    {
                        marks: {
                            link: { active: true, url: "https://google.com" },
                        },
                        text: "Peritext editor",
                    },
                ])
            })
        })

        describe("cursors", () => {
            it("can resolve a cursor position", () => {
                const [doc1] = generateDocs()

                // get a cursor for a path + index
                const cursor = doc1.getCursor(["text"], 5)
                // return { objectId: "1@abcd", elemId: "5@abcd" }

                const currentIndex = doc1.resolveCursor(cursor)

                assert.deepStrictEqual(currentIndex, 5)
            })

            it("increments cursor position when insert happens before cursor", () => {
                const [doc1] = generateDocs()

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
                const [doc1] = generateDocs()

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
                const [doc1] = generateDocs()

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
                const [doc1] = generateDocs()

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
                const [doc1] = generateDocs()

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
})
