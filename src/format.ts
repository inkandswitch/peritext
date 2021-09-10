import type { OperationId } from "./micromerge"
import type { Marks, MarkType } from "./schema"

type BooleanMarkValue =
    | {
          active: true
          /** A MarkValue should always have the ID of the operation that last modified it. */
          opId: OperationId
      }
    | {
          active: false
          opId: OperationId
      }

type IdMarkValue = {
    id: string
    /** A MarkValue should always have the ID of the operation that last modified it. */
    opId: OperationId
}

type LinkMarkValue =
    | {
          url: string
          /** A MarkValue should always have the ID of the operation that last modified it. */
          opId: OperationId
          active: true
      }
    | {
          url?: undefined
          opId: OperationId
          active: false
      }

export type MarkValue = Assert<
    {
        strong: BooleanMarkValue
        em: BooleanMarkValue
        comment: IdMarkValue
        link: LinkMarkValue
    },
    { [K in MarkType]: Record<string, unknown> }
>

export type MarkMap = {
    [K in MarkType]?: Marks[K]["allowMultiple"] extends true
        ? Array<MarkValue[K]>
        : MarkValue[K]
}

export type FormatSpan = {
    marks: MarkMap
    start: number
}
