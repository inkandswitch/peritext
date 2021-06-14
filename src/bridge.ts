/**
 * Logic for interfacing between ProseMirror and CRDT.
 */
import { ReplaceStep, AddMarkStep, RemoveMarkStep } from "prosemirror-transform"

import type { DocSchema } from "./schema"
import type { FormatOp, ResolvedOp } from "./operations"
import type { Transaction } from "prosemirror-state"

type RichTextDoc = {
    /** Array of single characters. */
    content: Array<string>
}

/**
 * Converts a position in the Prosemirror doc to an offset in the CRDT content string.
 * For now we only have a single node so this is relatively trivial.
 * When things get more complicated with multiple nodes, we can probably take advantage
 * of the additional metadata that Prosemirror can provide by "resolving" the position.
 * @param position : an unresolved Prosemirror position in the doc;
 * @returns
 */
function contentPosFromProsemirrorPos(position: number) {
    return position - 1
}

// Given a micromerge doc representation, produce a prosemirror doc.
export function prosemirrorDocFromCRDT(args: {
    schema: DocSchema
    doc: RichTextDoc
}) {
    const { schema, doc } = args
    const textContent = doc.content.join("")

    const result = schema.node("doc", undefined, [
        schema.node("paragraph", undefined, [schema.text(textContent)]),
    ])

    return result
}

// Given a CRDT Doc and a Prosemirror Transaction, update the micromerge doc.
// Note: need to derive a PM doc from the new CRDT doc later!
// TODO: why don't we need to update the selection when we do insertions?
export function applyTransaction(args: {
    doc: Micromerge
    txn: Transaction<DocSchema>
}) {
    const { doc, txn } = args
    for (const step of txn.steps) {
        console.log("step", step)

        if (step instanceof ReplaceStep) {
            if (step.slice) {
                // handle insertion
                if (step.from !== step.to) {
                    doc.change([
                        {
                            path: ["content"],
                            action: "delete",
                            index: contentPosFromProsemirrorPos(step.from),
                            count: step.to - step.from,
                        },
                    ])
                }

                const insertedContent = step.slice.content.textBetween(
                    0,
                    step.slice.content.size,
                )

                doc.change([
                    {
                        path: ["content"],
                        action: "insert",
                        index: contentPosFromProsemirrorPos(step.from),
                        values: insertedContent.split(""),
                    },
                ])
            } else {
                // handle deletion
                doc.change([
                    {
                        path: ["content"],
                        action: "delete",
                        index: contentPosFromProsemirrorPos(step.from),
                        count: step.to - step.from,
                    },
                ])
            }
        } else if (step instanceof AddMarkStep) {
            console.error("formatting not implemented currently")
        } else if (step instanceof RemoveMarkStep) {
            console.error("formatting not implemented currently")
        }
    }
}
