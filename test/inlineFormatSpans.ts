/**
 * TODO: Many of these tests have equivalents in test/micromerge.ts
 * and some of those equivalents have already been ported.
 * Port all of the remaining tests and delete this file.
 */
import assert from "assert"
import {
    FormatSpan,
    replayOps,
    getSpanAtPosition,
    normalize,
} from "../src/format"
import shuffleSeed from "shuffle-seed"
import { ALL_MARKS } from "../src/schema"

import type { MarkType } from "../src/schema"
import type { MarkMap, ResolvedOp } from "../src/format"

function toMarkSet(map: MarkMap): Set<MarkType> {
    return new Set(
        ALL_MARKS.filter(mark => {
            const value = map[mark]
            if (value === undefined) {
                return false
            } else if ("active" in value) {
                return true
            } else {
                return value.length > 0
            }
        }),
    )
}

function assertOpsPlayedInAnyOrder(
    ops: readonly DistributiveOmit<ResolvedOp, "id">[],
    docLength: number,
    expected: { start: number; marks: Set<MarkType> }[],
) {
    const shuffleSeeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    for (const seed of shuffleSeeds) {
        const opsWithIds = ops.map((op, index) => ({ ...op, id: `${index}@A` }))
        const shuffledOps = shuffleSeed.shuffle(opsWithIds, seed)
        const actual = replayOps(shuffledOps, docLength).map(span => ({
            start: span.start,
            marks: toMarkSet(span.marks),
        }))

        assert.deepStrictEqual(actual, expected)
    }
}

describe("applying format spans", function () {
    it("with no ops, returns a single span", function () {
        const ops: ResolvedOp[] = []
        assert.deepStrictEqual(replayOps(ops, 20), [{ marks: {}, start: 0 }])
    })

    it("correctly handles one add bold span", function () {
        // 01234567890123456789
        //   |------| b
        // _______________________
        // |-|
        //   |------| b
        //          |----------|
        const ops = [
            { action: "addMark", markType: "strong", start: 2, end: 9 },
        ] as const

        const expected = [
            { marks: new Set([]), start: 0 },
            { marks: new Set(["strong" as const]), start: 2 },
            { marks: new Set([]), start: 10 },
        ]

        assertOpsPlayedInAnyOrder(ops, 20, expected)
    })

    describe("temporal ordering effects", () => {
        // These two tests show that we respect the order of non-commutative operations.
        // Bold then unbold is different from unbold then bold.

        it("correctly handles bold, unbold, then bold, all overlapping", function () {
            // 01234567890123456789
            //   |------| b
            //     |-------| !b
            //           |----| b
            // _______________________
            // |-|
            //   |--| b
            //     |-----|
            //           |----| b
            //                 |--|
            const ops = [
                { action: "addMark", markType: "strong", start: 2, end: 9 },
                { action: "removeMark", markType: "strong", start: 5, end: 13 },
                { action: "addMark", markType: "strong", start: 11, end: 16 },
            ] as const

            const expected = [
                { marks: new Set([]), start: 0 },
                { marks: new Set(["strong" as const]), start: 2 },
                { marks: new Set([]), start: 5 },
                { marks: new Set(["strong" as const]), start: 11 }, // start where the last bold op started
                { marks: new Set([]), start: 17 },
            ]

            assertOpsPlayedInAnyOrder(ops, 20, expected)
        })

        it("correctly handles bold, bold, then unbold, all overlapping", function () {
            // 01234567890123456789
            //   |------| b
            //           |----| b
            //     |-------| !b
            // _______________________
            // |-|
            //   |-| b
            //     |-------|
            //             |--| b
            //                |---|
            const ops = [
                { action: "addMark", markType: "strong", start: 2, end: 9 },
                { action: "addMark", markType: "strong", start: 11, end: 16 },
                { action: "removeMark", markType: "strong", start: 5, end: 13 },
            ] as const

            const expected = [
                { marks: new Set([]), start: 0 },
                { marks: new Set(["strong"] as const), start: 2 },
                { marks: new Set([]), start: 5 },
                { marks: new Set(["strong"] as const), start: 14 }, // start after the last unbold op ended
                { marks: new Set([]), start: 17 },
            ]

            assertOpsPlayedInAnyOrder(ops, 20, expected)
        })
    })

    it("correctly handles bold, unbold, then italic", function () {
        // 01234567890123456789
        //     |---------| b
        //          |---------| !b
        //  |-----------------| i
        // _______________________
        // ||
        //  |--| i
        //     |----| bi
        //          |---------| i

        const ops = [
            { action: "addMark", markType: "strong", start: 4, end: 14 },
            { action: "removeMark", markType: "strong", start: 9, end: 19 },
            { action: "addMark", markType: "em", start: 1, end: 19 },
        ] as const

        const expected = [
            { marks: new Set([]), start: 0 },
            { marks: new Set(["em"] as const), start: 1 },
            { marks: new Set(["em", "strong"] as const), start: 4 },
            { marks: new Set(["em"] as const), start: 9 },
        ]

        assertOpsPlayedInAnyOrder(ops, 20, expected)
    })

    it("correctly handles bold and unbold which share a start point", function () {
        // 01234567890123456789
        //     |---------| b
        //     |----| !b
        // _______________________
        // |--------|
        //           |----| b

        const ops = [
            { action: "addMark", markType: "strong", start: 4, end: 14 },
            { action: "removeMark", markType: "strong", start: 4, end: 9 },
        ] as const

        const expected = [
            { marks: new Set([]), start: 0 },
            { marks: new Set(["strong"] as const), start: 10 },
            { marks: new Set([]), start: 15 },
        ]

        assertOpsPlayedInAnyOrder(ops, 20, expected)
    })

    it("correctly handles bold and unbold which share an end point", function () {
        // 01234567890123456789
        //     |---------| b
        //          |----| !b
        // _______________________
        // |---|
        //      |--| b
        //          |---------|

        const ops = [
            { action: "addMark", markType: "strong", start: 4, end: 14 },
            { action: "removeMark", markType: "strong", start: 9, end: 14 },
        ] as const

        const expected = [
            { marks: new Set([]), start: 0 },
            { marks: new Set(["strong"] as const), start: 4 },
            { marks: new Set([]), start: 9 },
        ]

        assertOpsPlayedInAnyOrder(ops, 20, expected)
    })

    it("correctly handles bold and unbold which share an end point", function () {
        // 01234567890123456789
        //     |---------| b
        //          |----| !b
        // _______________________
        // |---|
        //      |--| b
        //          |---------|

        const ops = [
            { action: "addMark", markType: "strong", start: 4, end: 14 },
            { action: "removeMark", markType: "strong", start: 9, end: 14 },
        ] as const

        const expected = [
            { marks: new Set([]), start: 0 },
            { marks: new Set(["strong"] as const), start: 4 },
            { marks: new Set([]), start: 9 },
        ]

        assertOpsPlayedInAnyOrder(ops, 20, expected)
    })

    it("correctly handles unbolding after an unbold", function () {
        // 01234567890123456789
        //     |---------| b
        //          |----| !b
        //          |--| !b
        // _______________________
        // |---|
        //      |--| b
        //          |---------|

        const ops = [
            { action: "addMark", markType: "strong", start: 4, end: 14 },
            { action: "removeMark", markType: "strong", start: 9, end: 14 },
            { action: "removeMark", markType: "strong", start: 9, end: 12 },
        ] as const

        const expected = [
            { marks: new Set([]), start: 0 },
            { marks: new Set(["strong"] as const), start: 4 },
            { marks: new Set([]), start: 9 },
        ]

        assertOpsPlayedInAnyOrder(ops, 20, expected)
    })
})

describe("getSpanAtPosition", () => {
    it("handles empty lists", () => {
        assert.deepStrictEqual(getSpanAtPosition([], 5), undefined)
    })

    it("handles single item lists", () => {
        assert.deepStrictEqual(
            getSpanAtPosition([{ marks: {}, start: 0 }], 5),
            {
                span: { marks: {}, start: 0 },
                index: 0,
            },
        )
        assert.deepStrictEqual(
            getSpanAtPosition([{ marks: {}, start: 6 }], 1),
            undefined,
        )
    })

    it("returns undefined when the given position precedes all spans", () => {
        const spans = [
            { marks: {}, start: 3 },
            { marks: {}, start: 4 },
            { marks: {}, start: 7 },
            { marks: {}, start: 9 },
            { marks: {}, start: 11 },
            { marks: {}, start: 15 },
            { marks: {}, start: 16 },
            { marks: {}, start: 21 },
        ]
        assert.deepStrictEqual(getSpanAtPosition(spans, 2), undefined)
    })

    it("returns the rightmost span whose index is < the given position", () => {
        const spans = [
            { marks: {}, start: 0 },
            { marks: {}, start: 3 },
            { marks: {}, start: 4 },
            { marks: {}, start: 7 },
            { marks: {}, start: 9 },
            { marks: {}, start: 11 },
            { marks: {}, start: 15 },
            { marks: {}, start: 16 },
            { marks: {}, start: 21 },
        ]
        assert.deepStrictEqual(getSpanAtPosition(spans, 5), {
            span: { marks: {}, start: 4 },
            index: 2,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 20), {
            span: { marks: {}, start: 16 },
            index: 7,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 10), {
            span: { marks: {}, start: 9 },
            index: 4,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 10000), {
            span: { marks: {}, start: 21 },
            index: 8,
        })
    })

    it("returns any span === the given position", () => {
        const spans = [
            { marks: {}, start: 0 },
            { marks: {}, start: 3 },
            { marks: {}, start: 4 },
            { marks: {}, start: 7 },
            { marks: {}, start: 9 },
            { marks: {}, start: 11 },
            { marks: {}, start: 15 },
            { marks: {}, start: 16 },
            { marks: {}, start: 21 },
        ]
        assert.deepStrictEqual(getSpanAtPosition(spans, 15), {
            span: { marks: {}, start: 15 },
            index: 6,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 4), {
            span: { marks: {}, start: 4 },
            index: 2,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 9), {
            span: { marks: {}, start: 9 },
            index: 4,
        })
    })
})

describe("normalize", () => {
    it("compacts a few unstyled spans into one", () => {
        const spans = [
            { marks: {}, start: 0 },
            { marks: {}, start: 3 },
            { marks: {}, start: 4 },
        ]

        assert.deepStrictEqual(normalize(spans, 1000), [
            { marks: {}, start: 0 },
        ])
    })

    it(
        "handles cases where one span has a mark undefined and the other span has a mark deactivated",
    )

    it("handles a more complex compaction case", () => {
        const spans: FormatSpan[] = [
            { marks: {}, start: 0 },
            { marks: {}, start: 3 },
            { marks: { strong: { active: true, opId: "1@A" } }, start: 4 },
            { marks: { strong: { active: true, opId: "1@A" } }, start: 7 },
            { marks: { strong: { active: true, opId: "1@A" } }, start: 12 },
            {
                marks: {
                    strong: { active: true, opId: "1@A" },
                    em: { active: true, opId: "1@A" },
                },
                start: 14,
            },
            { marks: { em: { active: true, opId: "1@A" } }, start: 16 },
            { marks: { em: { active: true, opId: "1@A" } }, start: 18 },
        ]

        assert.deepStrictEqual(normalize(spans, 1000), [
            { marks: {}, start: 0 },
            { marks: { strong: { active: true, opId: "1@A" } }, start: 4 },
            {
                marks: {
                    strong: { active: true, opId: "1@A" },
                    em: { active: true, opId: "1@A" },
                },
                start: 14,
            },
            { marks: { em: { active: true, opId: "1@A" } }, start: 16 },
        ])
    })

    it("removes spans past the end of the document", () => {
        const spans: FormatSpan[] = [
            { marks: {}, start: 0 },
            { marks: {}, start: 3 },
            { marks: { strong: { active: true, opId: "1@A" } }, start: 4 },
            { marks: { strong: { active: true, opId: "1@A" } }, start: 7 },
            { marks: {}, start: 10 },
        ]

        assert.deepStrictEqual(normalize(spans, 10), [
            { marks: {}, start: 0 },
            { marks: { strong: { active: true, opId: "1@A" } }, start: 4 },
        ])
    })
})
