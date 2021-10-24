import Micromerge from "../src/micromerge"

/** Create and return two Micromerge documents with the same text content.
 *  Useful for creating a baseline upon which to play further changes
 */
const defaultText = "The Peritext editor"

export const generateDocs = (text: string = defaultText): [Micromerge, Micromerge] => {
    const doc1 = new Micromerge("1234")
    const doc2 = new Micromerge("abcd")
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
