import { EditorView } from "prosemirror-view"

declare global {
    type Assert<T1 extends T2, T2> = T1
    type Values<T extends object> = T[keyof T]

    interface Window {
        view: EditorView
    }
}

/**
 * Add cursor types to automerge.
 */
declare module "automerge" {
    interface Text {
        getCursorAt(index: number): Cursor
    }

    class Cursor {
        index: number
        constructor(object: Text, index: number)
        constructor(object: string, index: number, elemId: string)
    }
}
