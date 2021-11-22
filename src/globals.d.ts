import type { EditorView } from "prosemirror-view"
import type { Schema, Slice, Mark } from "prosemirror-model"

declare global {
    type Assert<T1 extends T2, T2> = T1
    type Values<T extends Record<string, unknown>> = T[keyof T]
    type Inner<T> = T extends Array<infer U> ? U : never
    type DistributiveOmit<O, K extends keyof O> = O extends unknown ? Omit<O, K> : never

    function unreachable(x: never): never

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

declare module "prosemirror-transform" {
    /** https://prosemirror.net/docs/ref/#transform.ReplaceStep */
    interface ReplaceStep<S extends Schema> extends Step<S> {
        from: number
        to: number
        slice: Slice
    }

    /** https://prosemirror.net/docs/ref/#transform.AddMarkStep */
    interface AddMarkStep<S extends Schema> {
        from: number
        to: number
        mark: Mark<S>
    }

    /** https://prosemirror.net/docs/ref/#transform.RemoveMarkStep */
    interface RemoveMarkStep<S extends Schema> extends Step<S> {
        from: number
        to: number
        mark: Mark<S>
    }
}

declare module "prosemirror-model" {
    // Need to disable these rules to extend the module definition.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
    interface Fragment<S extends Schema = any> {
        /** https://prosemirror.net/docs/ref/#model.Fragment.textBetween */
        textBetween(from: number, to: number, blockSeparator?: string, leafText?: string): string
    }
}
