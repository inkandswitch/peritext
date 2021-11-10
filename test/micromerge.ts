import assert from "assert"
import { addCharactersToSpans, FormatSpanWithText, InputOperation, MarkMapWithoutOpIds, Patch } from "../src/micromerge"
import type { RootDoc } from "../src/bridge"
import { inspect } from "util"
import { generateDocs } from "./generateDocs"
import { isEqual, sortBy } from "lodash"

const defaultText = "The Peritext editor"
const textChars = defaultText.split("")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const debug = (obj: any) => {
    console.log(inspect(obj, false, 6))
}

/** Define a naive structure that accumulates patches and computes a document state.
 *  This isn't as optimizefd as the structure we use in the actual codebase,
 *  but it lets us straightforwardly test whether the incremental patches that we have
 *  generated have converged on the correct state.
 */
type TextWithMetadata = Array<{
    character: string
    marks: MarkMapWithoutOpIds
}>

const range = (start: number, end: number): number[] => {
    return Array(end - start + 1)
        .fill("_")
        .map((_, idx) => start + idx)
}

const assertDocsEqual = (actualSpans: FormatSpanWithText[], expectedResult: FormatSpanWithText[]): boolean => {
    for (const [index, expectedSpan] of expectedResult.entries()) {
        const actualSpan = actualSpans[index]
        assert.strictEqual(expectedSpan.text, actualSpan.text)

        for (const [markType, markValue] of Object.entries(expectedSpan.marks)) {
            if (markType === "comment") {
                assert.deepStrictEqual(
                    sortBy(markValue, (c: { id: string }) => c.id),
                    sortBy(actualSpan.marks[markType], (c: { id: string }) => c.id),
                )
            } else {
                assert.deepStrictEqual(markValue, actualSpan.marks[markType])
            }
        }
    }
}

/** Concurrently apply a change to two documents,
 *  then sync them and see if we converge to the expected result.
 *  This tests both the "batch" codepath as well as the result after
 *  incrementally applying the patches generated on both sides. */
const testConcurrentWrites = (args: {
    initialText?: string
    preOps?: DistributiveOmit<InputOperation, "path">[]
    inputOps1?: DistributiveOmit<InputOperation, "path">[]
    inputOps2?: DistributiveOmit<InputOperation, "path">[]
    expectedResult: FormatSpanWithText[]
}): void => {
    const { initialText = "The Peritext editor", preOps, inputOps1 = [], inputOps2 = [], expectedResult } = args

    const { docs, patches } = generateDocs(initialText)
    const [doc1, doc2] = docs
    let [patchesForDoc1, patchesForDoc2] = patches

    if (preOps) {
        const { change: change0, patches: patches0 } = doc1.change(preOps.map(op => ({ ...op, path: ["text"] })))
        patchesForDoc1 = patchesForDoc1.concat(patches0)
        patchesForDoc2 = patchesForDoc2.concat(doc2.applyChange(change0))
    }

    const { change: change1, patches: patches1 } = doc1.change(inputOps1.map(op => ({ ...op, path: ["text"] })))
    patchesForDoc1 = patchesForDoc1.concat(patches1)

    const { change: change2, patches: patches2 } = doc2.change(inputOps2.map(op => ({ ...op, path: ["text"] })))
    patchesForDoc2 = patchesForDoc2.concat(patches2)

    // doc1 and doc2 sync their changes
    const patches2b = doc2.applyChange(change1)
    patchesForDoc2 = patchesForDoc2.concat(patches2b)
    const patches1b = doc1.applyChange(change2)
    patchesForDoc1 = patchesForDoc1.concat(patches1b)

    // debug({
    //     doc1: doc1.getTextWithFormatting(["text"]),
    //     doc2: doc2.getTextWithFormatting(["text"]),
    // })

    // Test the "batch" codepath -- if we convert the internal metadata structure
    // into a formatted document all at once, do we end up with the expected result?
    assert.deepStrictEqual(doc1.getTextWithFormatting(["text"]), expectedResult)
    assert.deepStrictEqual(doc2.getTextWithFormatting(["text"]), expectedResult)

    // Test that applying patches converges to the same state
    // debug(patchesForDoc1)
    // debug(accumulatePatches(patchesForDoc1))
    assertDocsEqual(accumulatePatches(patchesForDoc1), expectedResult)
    assertDocsEqual(accumulatePatches(patchesForDoc2), expectedResult)
}

/** Define a naive structure that accumulates patches and computes a document state.
 *  This isn't as optimized as the structure we use in the actual codebase,
 *  but it lets us straightforwardly test whether the incremental patches that we have
 *  generated have converged on the correct state.
 */
type TextWithMetadata = Array<{
    character: string
    marks: MarkMapWithoutOpIds
}>

/** Accumulates effects of patches into the same structure returned by our batch codepath;
 *  this lets us test that the result of applying a bunch of patches is what we expect.
 */
const accumulatePatches = (patches: Patch[]): FormatSpanWithText[] => {
    const metadata: TextWithMetadata = []
    for (const patch of patches) {
        if (!isEqual(patch.path, ["text"])) {
            throw new Error("This implementation only supports a single path: 'text'")
        }

        switch (patch.action) {
            case "insert": {
                patch.values.forEach((character: string, valueIndex: number) => {
                    metadata.splice(patch.index + valueIndex, 0, {
                        character,
                        marks: { ...patch.marks },
                    })
                })

                break
            }

            case "delete": {
                metadata.splice(patch.index, patch.count)
                break
            }

            case "addMark": {
                for (const index of range(patch.startIndex, patch.endIndex - 1)) {
                    if (patch.markType !== "comment") {
                        metadata[index].marks[patch.markType] = {
                            active: true,
                            ...patch.attrs,
                        }
                    } else {
                        if (metadata[index].marks[patch.markType] === undefined) {
                            metadata[index].marks[patch.markType] = []
                        }

                        metadata[index].marks[patch.markType]!.push({
                            ...patch.attrs,
                        })
                    }
                }
                break
            }

            case "removeMark": {
                for (const index of range(patch.startIndex, patch.endIndex - 1)) {
                    delete metadata[index].marks[patch.markType]
                }
                break
            }

            default: {
                unreachable(patch)
            }
        }
    }

    // Accumulate the per-character metadata into a normal spans structure
    // as returned by our batch codepath
    const spans: FormatSpanWithText[] = []

    for (const meta of metadata) {
        addCharactersToSpans({ characters: [meta.character], marks: meta.marks, spans })
    }

    return spans
}

describe.only("Micromerge", () => {
    it("can insert and delete text", () => {
        const { docs } = generateDocs("abcde")
        const [doc1] = docs

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
        const { docs } = generateDocs("a")
        const [doc1, doc2] = docs

        const { change: change2 } = doc2.change([{ path: ["text"], action: "insert", index: 1, values: ["b"] }])

        // We should be able to successfully apply change2 on doc1 now;
        // its only dependency is change1, which should be recorded in doc1's clock
        // of changes that it's observed.
        assert.doesNotThrow(() => {
            doc1.applyChange(change2)
        })

        assert.deepStrictEqual(doc1.root.text, ["a", "b"])
        assert.deepStrictEqual(doc2.root.text, ["a", "b"])
    })

    it("handles concurrent deletion and insertion", () => {
        testConcurrentWrites({
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
    })

    it("flattens local formatting operations into flat spans", () => {
        testConcurrentWrites({
            inputOps1: [
                // Bold the word "Peritext"
                {
                    action: "addMark",
                    startIndex: 4,
                    endIndex: 12,
                    markType: "strong",
                },
            ],
            expectedResult: [
                { marks: {}, text: "The " },
                { marks: { strong: { active: true } }, text: "Peritext" },
                { marks: {}, text: " editor" },
            ],
        })
    })

    it("merges concurrent overlapping bold and italic", () => {
        testConcurrentWrites({
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
    })

    it("merges concurrent bold and unbold", () => {
        testConcurrentWrites({
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
                    action: "removeMark",
                    startIndex: 4,
                    endIndex: 19,
                    markType: "strong",
                },
            ],
            expectedResult: [
                { marks: { strong: { active: true } }, text: "The " },
                { marks: {}, text: "Peritext editor" },
            ],
        })
    })

    it("merges concurrent bold and unbold where unbold is inside the bold", () => {
        testConcurrentWrites({
            inputOps1: [
                {
                    action: "addMark",
                    startIndex: 0,
                    endIndex: 19,
                    markType: "strong",
                },
            ],
            inputOps2: [
                {
                    action: "removeMark",
                    startIndex: 4,
                    endIndex: 12,
                    markType: "strong",
                },
            ],
            expectedResult: [
                { marks: { strong: { active: true } }, text: "The " },
                { marks: {}, text: "Peritext" },
                { marks: { strong: { active: true } }, text: " editor" },
            ],
        })
    })

    it("merges concurrent bold and unbold where unbold is one character", () => {
        testConcurrentWrites({
            inputOps1: [
                {
                    action: "addMark",
                    startIndex: 0,
                    endIndex: 19,
                    markType: "strong",
                },
            ],
            inputOps2: [
                {
                    action: "removeMark",
                    startIndex: 4,
                    endIndex: 5,
                    markType: "strong",
                },
            ],
            expectedResult: [
                { marks: { strong: { active: true } }, text: "The " },
                { marks: {}, text: "P" },
                { marks: { strong: { active: true } }, text: "eritext editor" },
            ],
        })
    })

    it("handles spans that have been collapsed to zero width", () => {
        testConcurrentWrites({
            preOps: [
                // add strong mark to the word "Peritext" in "The Peritext editor"
                {
                    action: "addMark",
                    startIndex: 4,
                    endIndex: 12,
                    markType: "strong",
                },
                // delete all characters inside "Peritext"
                { action: "delete", index: 4, count: 8 },
            ],
            inputOps1: [
                // insert a new character where the word used to be
                { action: "insert", index: 4, values: ["x"] },
            ],
            // Should expect no formatting in the result
            expectedResult: [{ marks: {}, text: "The x editor" }],
        })
    })

    describe("span growing behavior on a single actor", () => {
        it("grows a bold span to the right", () => {
            // Bold the word Peritext, then add an exclamation point at the end.
            // The bold span should grow to include the new character.
            testConcurrentWrites({
                inputOps1: [],
                inputOps2: [
                    {
                        action: "addMark",
                        startIndex: 4,
                        endIndex: 12,
                        markType: "strong",
                    },
                    {
                        action: "insert",
                        index: 12,
                        values: ["!"],
                    },
                ],
                //
                expectedResult: [
                    { marks: {}, text: "The " },
                    { marks: { strong: { active: true } }, text: "Peritext!" },
                    { marks: {}, text: " editor" },
                ],
            })
        })

        it("doesn't grow a bold span to the left", () => {
            // Bold the word Peritext, then add an exclamation point at the beginning.
            // The bold span should _not_ grow to include the new character.
            testConcurrentWrites({
                inputOps1: [],
                inputOps2: [
                    {
                        action: "addMark",
                        startIndex: 4,
                        endIndex: 12,
                        markType: "strong",
                    },
                    {
                        action: "insert",
                        index: 4,
                        values: ["!"],
                    },
                ],
                //
                expectedResult: [
                    { marks: {}, text: "The !" },
                    { marks: { strong: { active: true } }, text: "Peritext" },
                    { marks: {}, text: " editor" },
                ],
            })
        })

        it("doesn't grow a link to the right", () => {
            // Mark a link on the word Peritext, then add an exclamation point at the end.
            // The link should not grow because links don't grow in either direction
            testConcurrentWrites({
                inputOps1: [],
                inputOps2: [
                    {
                        action: "addMark",
                        startIndex: 4,
                        endIndex: 12,
                        markType: "link",
                        attrs: {
                            url: "inkandswitch.com",
                        },
                    },
                    {
                        action: "insert",
                        index: 12,
                        values: ["!"],
                    },
                ],
                //
                expectedResult: [
                    { marks: {}, text: "The " },
                    { marks: { link: { active: true, url: "inkandswitch.com" } }, text: "Peritext" },
                    { marks: {}, text: "! editor" },
                ],
            })
        })

        it("doesn't grow a link to the left", () => {
            // Mark a link on the word Peritext, then add an exclamation point at the beginning.
            // The link should not grow because links don't grow in either direction.
            testConcurrentWrites({
                inputOps1: [],
                inputOps2: [
                    {
                        action: "addMark",
                        startIndex: 4,
                        endIndex: 12,
                        markType: "link",
                        attrs: {
                            url: "inkandswitch.com",
                        },
                    },
                    {
                        action: "insert",
                        index: 4,
                        values: ["!"],
                    },
                ],
                //
                expectedResult: [
                    { marks: {}, text: "The !" },
                    { marks: { link: { active: true, url: "inkandswitch.com" } }, text: "Peritext" },
                    { marks: {}, text: " editor" },
                ],
            })
        })

        it("grows only bold, when bold and link end at the same position", () => {
            // A bold and link mark end at the same place.
            // Then we insert a new character at the end of that span.
            // Only the bold link should grow at the end; the link shouldn't grow.
            testConcurrentWrites({
                inputOps1: [],
                inputOps2: [
                    {
                        action: "addMark",
                        startIndex: 4,
                        endIndex: 12,
                        markType: "link",
                        attrs: {
                            url: "inkandswitch.com",
                        },
                    },
                    {
                        action: "addMark",
                        startIndex: 4,
                        endIndex: 12,
                        markType: "strong",
                    },
                    {
                        action: "insert",
                        index: 12,
                        values: ["!"],
                    },
                ],
                //
                expectedResult: [
                    { marks: {}, text: "The " },
                    {
                        marks: { link: { active: true, url: "inkandswitch.com" }, strong: { active: true } },
                        text: "Peritext",
                    },
                    { marks: { strong: { active: true } }, text: "!" },
                    { marks: {}, text: " editor" },
                ],
            })
        })

        it("grows adjacent bold and unbold spans correctly", () => {
            // The user bolds ABCDE, and then unbolds BCD.
            // Then they insert F after A, and G after D.
            // The F should be bolded because the bolded A grows.
            // The G should be not bolded, because the bolded E doesn't grow to the left.
            testConcurrentWrites({
                initialText: "ABCDE",
                inputOps1: [
                    {
                        action: "addMark",
                        startIndex: 0,
                        endIndex: 5,
                        markType: "strong",
                    },
                    {
                        action: "removeMark",
                        startIndex: 1,
                        endIndex: 4,
                        markType: "strong",
                    },
                    {
                        action: "insert",
                        index: 1,
                        values: ["F"],
                    },
                    {
                        action: "insert",
                        index: 5,
                        values: ["G"],
                    },
                ],
                inputOps2: [],
                // The B should be bold, because the bold on A grows to the right
                expectedResult: [
                    { marks: { strong: { active: true } }, text: "AF" },
                    { marks: {}, text: "BCDG" },
                    { marks: { strong: { active: true } }, text: "E" },
                ],
            })
        })

        it("handles growth behavior for spans where the boundary is a tombstone", () => {
            // The user creates a link and then deletes the boundary characters.
            // When they insert at the end of the link, the new char shouldn't become
            // part of the link because links don't grow to the right.
            // However, this requires some special handling--if we just
            // inserted the new character to the left of tombstones at the position as
            // Automerge usually does, the new character would become part of the link.
            testConcurrentWrites({
                initialText: "ABCDE",
                inputOps1: [
                    {
                        action: "addMark",
                        startIndex: 1,
                        endIndex: 4,
                        markType: "link",
                        attrs: { url: "inkandswitch.com" },
                    },
                    {
                        action: "delete",
                        index: 1,
                        count: 1,
                    },
                    {
                        action: "delete",
                        index: 2,
                        count: 1,
                    },
                    {
                        action: "insert",
                        index: 2,
                        values: ["F"],
                    },
                ],
                inputOps2: [],
                // The B should be bold, because the bold on A grows to the right
                expectedResult: [
                    { marks: {}, text: "A" },
                    { marks: { link: { active: true, url: "inkandswitch.com" } }, text: "C" },
                    { marks: {}, text: "FE" },
                ],
            })
        })
    })

    describe("span growing behavior with concurrent edits", () => {
        it("merges concurrent bold and insertion at the mark boundary", () => {
            testConcurrentWrites({
                // In doc1, we format the word "Peritext" as bold
                inputOps1: [
                    {
                        action: "addMark",
                        startIndex: 4,
                        endIndex: 12,
                        markType: "strong",
                    },
                ],
                // Concurrently, in doc2, we add asterisks before and after the word "Peritext"
                inputOps2: [
                    { action: "insert", index: 4, values: ["*"] },
                    { action: "insert", index: 13, values: ["*"] },
                ],
                // The right asterisk should be bolded because bold grows at the end
                expectedResult: [
                    { marks: {}, text: "The *" },
                    { marks: { strong: { active: true } }, text: "Peritext*" },
                    { marks: {}, text: " editor" },
                ],
            })
        })

        it("handles insertion where one mark ends and another begins", () => {
            testConcurrentWrites({
                // In doc1, we format the word "Peritext" as bold, and " editor" as italic
                inputOps1: [
                    {
                        action: "addMark",
                        startIndex: 4,
                        endIndex: 12,
                        markType: "strong",
                    },
                    {
                        action: "addMark",
                        startIndex: 12,
                        endIndex: 19,
                        markType: "em",
                    },
                ],
                // Concurrently, in doc2, we add a footnote after "Peritext"
                inputOps2: [{ action: "insert", index: 12, values: "[1]".split("") }],
                // The footnote marker should be bold, because bold grows at the end
                // and italic doesn't grow at the beginning
                expectedResult: [
                    { marks: {}, text: "The " },
                    { marks: { strong: { active: true } }, text: "Peritext[1]" },
                    { marks: { em: { active: true } }, text: " editor" },
                ],
            })
        })

        it("handles an insertion at a boundary between bold and unbolded spans", () => {
            testConcurrentWrites({
                initialText: "AC",
                // In doc1, we format "AC" as bold, then unbold "C"
                inputOps1: [
                    {
                        action: "addMark",
                        startIndex: 0,
                        endIndex: 2,
                        markType: "strong",
                    },
                    {
                        action: "removeMark",
                        startIndex: 1,
                        endIndex: 2,
                        markType: "strong",
                    },
                ],
                // Concurrently, in doc2, we insert "B" in between
                inputOps2: [{ action: "insert", index: 1, values: ["B"] }],
                // The B should be bold, because the bold on A grows to the right
                expectedResult: [
                    { marks: { strong: { active: true } }, text: "AB" },
                    { marks: {}, text: "C" },
                ],
            })
        })

        it("handles an insertion at boundary between unbolded and bold spans", () => {
            testConcurrentWrites({
                initialText: "AC",
                // In doc1, we format "AC" as bold, then unbold "A"
                inputOps1: [
                    {
                        action: "addMark",
                        startIndex: 0,
                        endIndex: 2,
                        markType: "strong",
                    },
                    {
                        action: "removeMark",
                        startIndex: 0,
                        endIndex: 1,
                        markType: "strong",
                    },
                ],
                // Concurrently, in doc2, we insert "B" in between
                inputOps2: [{ action: "insert", index: 1, values: ["B"] }],
                // The B should not be bold, because bold does not grow to the left
                expectedResult: [
                    { marks: {}, text: "AB" },
                    { marks: { strong: { active: true } }, text: "C" },
                ],
            })
        })
    })

    it("handles an addMark boundary that is a tombstone", () => {
        testConcurrentWrites({
            initialText: "The *Peritext* editor",
            // In doc1, we format "*Peritext*" as bold and then delete the asterisks
            inputOps1: [
                {
                    action: "addMark",
                    startIndex: 4,
                    endIndex: 14,
                    markType: "strong",
                },
                { action: "delete", index: 4, count: 1 },
                { action: "delete", index: 12, count: 1 },
            ],
            // Concurrently, in doc2, we add underscores inside of the asterisks
            // so that the text reads "The *_Peritext_* editor"
            inputOps2: [
                { action: "insert", index: 5, values: ["_"] },
                { action: "insert", index: 14, values: ["_"] },
            ],
            // The underscores should be bold, because the bold span ran from asterisk
            // to asterisk, and the underscores were inside of the asterisks
            expectedResult: [
                { marks: {}, text: "The " },
                { marks: { strong: { active: true } }, text: "_Peritext_" },
                { marks: {}, text: " editor" },
            ],
        })
    })

    it("handles an insertion into a deleted span with mark", () => {
        testConcurrentWrites({
            // Format "Peritext" as bold in both documents
            preOps: [
                {
                    action: "addMark",
                    startIndex: 4,
                    endIndex: 12,
                    markType: "strong",
                },
            ],
            // In doc1, delete the word "Peritext"
            inputOps1: [{ action: "delete", index: 4, count: 8 }],
            // Concurrently, in doc2, change "Peritext" to "Paratext"
            inputOps2: [
                { action: "delete", index: 5, count: 3 },
                { action: "insert", index: 5, values: "ara".split("") },
            ],
            // Both sides should end up with the same text. The outcome doesn't
            // really make sense, but it's standard behaviour for CRDTs...
            // see also: https://github.com/automerge/automerge/issues/401
            // The "ara" should be bold because it was inserted into the middle of a
            // span that was bold at the time of insertion
            expectedResult: [
                { marks: {}, text: "The " },
                { marks: { strong: { active: true } }, text: "ara" },
                { marks: {}, text: " editor" },
            ],
        })
    })

    it("handles formatting on a deleted span", () => {
        testConcurrentWrites({
            // In doc1, delete the word "Peritext"
            inputOps1: [{ action: "delete", index: 4, count: 9 }],
            // Concurrently, in doc2, add a mark to part of the word Peritext
            inputOps2: [
                {
                    action: "addMark",
                    startIndex: 5,
                    endIndex: 11,
                    markType: "strong",
                },
            ],
            // Both sides should end up with the text deleted
            expectedResult: [{ marks: {}, text: "The editor" }],
        })
    })

    it("handles formatting on a single character", () => {
        // This is a very simple test. Only one editor edits;
        // it adds a mark to a single character.
        // The point of this test is to ensure we don't get too aggressive
        // with excluding patches that only apply to a single character,
        // as part of our attempts to avoid emitting patches that
        // only apply to deleted content.
        testConcurrentWrites({
            inputOps1: [],
            inputOps2: [
                {
                    action: "addMark",
                    startIndex: 4,
                    endIndex: 5,
                    markType: "strong",
                },
            ],
            //
            expectedResult: [
                { marks: {}, text: "The " },
                { marks: { strong: { active: true } }, text: "P" },
                { marks: {}, text: "eritext editor" },
            ],
        })
    })

    // Other test cases:
    // - a boundary character is both start and end of some op. it gets deleted. concurrently, someone formats it. make sure no patch gets emitted.

    describe.skip("patches", () => {
        // In the simplest case, when a change is applied immediately to another peer,
        // it simply generates the original input operations as the patch
        it("produces the correct patch for applying a simple insertion", () => {
            const { docs } = generateDocs()
            const [doc1, doc2] = docs

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
            const { docs } = generateDocs()
            const [doc1, doc2] = docs

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
            const { docs } = generateDocs()
            const [doc1, doc2] = docs

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
            const { docs } = generateDocs()
            const [doc1, doc2] = docs

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

    describe("comments", () => {
        it("returns a single comment in the flattened spans", () => {
            const { docs } = generateDocs()
            const [doc1] = docs

            doc1.change([
                // Comment on the word "Peritext"
                {
                    path: ["text"],
                    action: "addMark",
                    startIndex: 4,
                    endIndex: 12,
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
            const { docs } = generateDocs()
            const [doc1] = docs

            doc1.change([
                // Comment on "The Peritext"
                {
                    path: ["text"],
                    action: "addMark",
                    startIndex: 0,
                    endIndex: 12,
                    markType: "comment",
                    attrs: { id: "abc-123" },
                },
                // Comment on "Peritext editor"
                {
                    path: ["text"],
                    action: "addMark",
                    startIndex: 4,
                    endIndex: 19,
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
        it("overlaps two comments from different users", () => {
            testConcurrentWrites({
                inputOps1: [
                    // Comment on the word "The Peritext"
                    {
                        action: "addMark",
                        startIndex: 0,
                        endIndex: 12,
                        markType: "comment",
                        attrs: { id: "abc-123" },
                    },
                ],
                inputOps2: [
                    // Comment on "Peritext Editor"
                    {
                        action: "addMark",
                        startIndex: 4,
                        endIndex: 19,
                        markType: "comment",
                        attrs: { id: "def-789" },
                    },
                ],
                expectedResult: [
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
                ],
            })
        })
    })

    describe("links", () => {
        it("returns a single link in the flattened spans", () => {
            const { docs } = generateDocs()
            const [doc1] = docs

            doc1.change([
                // Link on the word "Peritext"
                {
                    path: ["text"],
                    action: "addMark",
                    startIndex: 4,
                    endIndex: 12,
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
            testConcurrentWrites({
                inputOps1: [
                    {
                        action: "addMark",
                        startIndex: 4,
                        endIndex: 12,
                        markType: "link",
                        attrs: { url: "https://inkandswitch.com" },
                    },
                ],
                inputOps2: [
                    {
                        action: "addMark",
                        startIndex: 4,
                        endIndex: 12,
                        markType: "link",
                        attrs: { url: "https://google.com" },
                    },
                ],
                expectedResult: [
                    { marks: {}, text: "The " },
                    {
                        marks: {
                            link: { active: true, url: "https://google.com" },
                        },
                        text: "Peritext",
                    },
                    { marks: {}, text: " editor" },
                ],
            })
        })

        it("arbitrarily chooses one link as the winner when partially overlapping", () => {
            testConcurrentWrites({
                inputOps1: [
                    {
                        action: "addMark",
                        startIndex: 0,
                        endIndex: 12,
                        markType: "link",
                        attrs: { url: "https://inkandswitch.com" },
                    },
                ],
                inputOps2: [
                    {
                        action: "addMark",
                        startIndex: 4,
                        endIndex: 19,
                        markType: "link",
                        attrs: { url: "https://google.com" },
                    },
                ],
                expectedResult: [
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
                ],
            })
        })
    })

    describe("cursors", () => {
        it("can resolve a cursor position", () => {
            const { docs } = generateDocs()
            const [doc1] = docs

            // get a cursor for a path + index
            const cursor = doc1.getCursor(["text"], 5)
            // return { objectId: "1@abcd", elemId: "5@abcd" }

            const currentIndex = doc1.resolveCursor(cursor)

            assert.deepStrictEqual(currentIndex, 5)
        })

        it("increments cursor position when insert happens before cursor", () => {
            const { docs } = generateDocs()
            const [doc1] = docs

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
            const { docs } = generateDocs()
            const [doc1] = docs

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
            const { docs } = generateDocs()
            const [doc1] = docs

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
            const { docs } = generateDocs()
            const [doc1] = docs

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
            const { docs } = generateDocs()
            const [doc1] = docs

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
