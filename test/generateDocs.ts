import Micromerge, { Change, Patch } from "../src/micromerge"

/** Create and return two Micromerge documents with the same text content.
 *  Useful for creating a baseline upon which to play further changes
 */
const defaultText = "The Peritext editor"

/** Create and return two Micromerge documents with the same text content.
 *  Useful for creating a baseline upon which to play further changes
 */
export const generateDocs = (
    text: string = defaultText, count: number = 2
): {
    docs: Micromerge[]
    patches: Patch[][]
    initialChange: Change
} => {
    /*                           js sucks */
    const docs = new Array(count).fill(null).map((n, i) => { console.log(i); return new Micromerge("doc" + i) })
    const patches: Patch[][] = new Array(count).fill(null).map(() => [])
    const textChars = text.split("")

    // Generate a change on doc1
    const { change: initialChange, patches: initialPatches } = docs[0].change([
        { path: [], action: "makeList", key: "text" },
        {
            path: ["text"],
            action: "insert",
            index: 0,
            values: textChars,
        },
    ])
    patches[0] = initialPatches

    for (const doc of docs.slice(1)) {
        doc.applyChange(initialChange)
    }
    return { docs, patches, initialChange }
}
