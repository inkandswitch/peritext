import { addCharactersToSpans, FormatSpanWithText, Patch } from "../src/micromerge"
import { sortBy, isEqual } from "lodash"
import { TextWithMetadata, range } from "./micromerge"
import assert from "assert"
import { MarkType } from "../src/schema"

/** Accumulates effects of patches into the same structure returned by our batch codepath;
 *  this lets us test that the result of applying a bunch of patches is what we expect.
 */
export const accumulatePatches = (patches: Patch[]): FormatSpanWithText[] => {
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
                console.log("d", patch, metadata)
                metadata.splice(patch.index, patch.count)
                break
            }

            case "addMark": {
                console.log("p", patch, metadata)
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

            case "makeList": {
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

export const assertDocsEqual = (actualSpans: FormatSpanWithText[], expectedResult: FormatSpanWithText[]) => {
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
                assert.deepStrictEqual(markValue, actualSpan.marks[markType as MarkType])
            }
        }
    }
}
