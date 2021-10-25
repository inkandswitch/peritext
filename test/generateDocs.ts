import Micromerge, { Patch } from "../src/micromerge"

/** Create and return two Micromerge documents with the same text content.
 *  Useful for creating a baseline upon which to play further changes
 */
const defaultText = "The Peritext editor"

/** Create and return two Micromerge documents with the same text content.
 *  Useful for creating a baseline upon which to play further changes
 */
export const generateDocs = (
    text: string = defaultText,
): {
    doc1: Micromerge
    doc2: Micromerge
    patches1: Patch[]
    patches2: Patch[]
} => {
    const doc1 = new Micromerge("doc1")
    const doc2 = new Micromerge("doc2")
    const textChars = text.split("")

    // Generate a change on doc1
    const { change: change1, patches: patches1 } = doc1.change([
        { path: [], action: "makeList", key: "text" },
        {
            path: ["text"],
            action: "insert",
            index: 0,
            values: textChars,
        },
    ])

    // Generate change2 on doc2, which depends on change1
    const patches2 = doc2.applyChange(change1)
    return { doc1, doc2, patches1, patches2 }
}
