import { EditorView } from "prosemirror-view"

declare global {
    type Assert<T1 extends T2, T2> = T1

    interface Window {
        view: EditorView
    }
}
