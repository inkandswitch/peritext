import { FormatSpanWithText, Patch } from "../src/micromerge"
import { addCharactersToSpans } from "../src/peritext"
import { isEqual, sortBy } from "lodash"
import { TextWithMetadata, range } from "./micromerge"

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
                        const commentsArray = metadata[index].marks[patch.markType]
                        if (commentsArray === undefined) {
                            metadata[index].marks[patch.markType] = [{ ...patch.attrs }]
                        } else if (!commentsArray.find(c => c.id === patch.attrs.id)) {
                            metadata[index].marks[patch.markType] = sortBy(
                                [...commentsArray, { ...patch.attrs }],
                                c => c.id,
                            )
                        }
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
