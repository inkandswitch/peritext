import assert from "assert"
import { FormatSpan, replayOps, getSpanAtPosition } from "../src/format"
import { ResolvedOp } from "../src/operations"

describe("applying format spans", function () {
    describe("with no ops", function () {
        const ops: ResolvedOp[] = []
        it("returns a single span starting at 0", function () {
            assert.deepStrictEqual(replayOps(ops), [{ marks: [], start: 0 }])
        })
    })

    describe("with adding one bold span", function () {
        // 01234567890123456789
        //   |------| b
        // _______________________
        // |-|
        //   |------| b
        //          |----------|
        const ops: ResolvedOp[] = [
            { type: "addMark", markType: "strong", start: 2, end: 9 },
        ]

        const expected: FormatSpan[] = [
            { marks: [], start: 0 },
            { marks: ["strong"], start: 2 },
            { marks: [], start: 10 },
        ]

        it("returns the expected result", function () {
            assert.deepStrictEqual(replayOps(ops), expected)
        })
    })

    describe("with bold, unbold, then bold, all overlapping", function () {
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
        const ops: ResolvedOp[] = [
            { type: "addMark", markType: "strong", start: 2, end: 9 },
            { type: "removeMark", markType: "strong", start: 5, end: 13 },
            { type: "addMark", markType: "strong", start: 11, end: 16 },
        ]

        const expected: FormatSpan[] = [
            { marks: [], start: 0 },
            { marks: ["strong"], start: 2 },
            { marks: [], start: 5 },
            { marks: ["strong"], start: 11 },
            { marks: [], start: 17 },
        ]

        it("returns the expected result", function () {
            assert.deepStrictEqual(replayOps(ops), expected)
        })
    })

    describe("with bold, unbold, then italic", function () {
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

        const ops: ResolvedOp[] = [
            { type: "addMark", markType: "strong", start: 4, end: 14 },
            { type: "removeMark", markType: "strong", start: 9, end: 19 },
            { type: "addMark", markType: "em", start: 1, end: 19 },
        ]

        const expected: FormatSpan[] = [
            { marks: [], start: 0 },
            { marks: ["em"], start: 1 },
            { marks: ["em", "strong"], start: 4 },
            { marks: ["em"], start: 9 },
        ]

        it("returns the expected result", function () {
            assert.deepStrictEqual(replayOps(ops), expected)
        })
    })
})

describe("getSpanAtPosition", () => {
    it("handles empty lists", () => {
        assert.deepStrictEqual(getSpanAtPosition([], 5), undefined)
    })

    it("handles single item lists", () => {
        assert.deepStrictEqual(
            getSpanAtPosition([{ marks: [], start: 0 }], 5),
            {
                span: { marks: [], start: 0 },
                index: 0,
            },
        )
        assert.deepStrictEqual(
            getSpanAtPosition([{ marks: [], start: 6 }], 1),
            undefined,
        )
    })

    it("returns undefined when the given position precedes all spans", () => {
        const spans = [
            { marks: [], start: 3 },
            { marks: [], start: 4 },
            { marks: [], start: 7 },
            { marks: [], start: 9 },
            { marks: [], start: 11 },
            { marks: [], start: 15 },
            { marks: [], start: 16 },
            { marks: [], start: 21 },
        ]
        assert.deepStrictEqual(getSpanAtPosition(spans, 2), undefined)
    })

    it("returns the rightmost span whose index is < the given position", () => {
        const spans = [
            { marks: [], start: 0 },
            { marks: [], start: 3 },
            { marks: [], start: 4 },
            { marks: [], start: 7 },
            { marks: [], start: 9 },
            { marks: [], start: 11 },
            { marks: [], start: 15 },
            { marks: [], start: 16 },
            { marks: [], start: 21 },
        ]
        assert.deepStrictEqual(getSpanAtPosition(spans, 5), {
            span: { marks: [], start: 4 },
            index: 2,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 20), {
            span: { marks: [], start: 16 },
            index: 7,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 10), {
            span: { marks: [], start: 9 },
            index: 4,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 10000), {
            span: { marks: [], start: 21 },
            index: 8,
        })
    })

    it("returns any span === the given position", () => {
        const spans = [
            { marks: [], start: 0 },
            { marks: [], start: 3 },
            { marks: [], start: 4 },
            { marks: [], start: 7 },
            { marks: [], start: 9 },
            { marks: [], start: 11 },
            { marks: [], start: 15 },
            { marks: [], start: 16 },
            { marks: [], start: 21 },
        ]
        assert.deepStrictEqual(getSpanAtPosition(spans, 15), {
            span: { marks: [], start: 15 },
            index: 6,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 4), {
            span: { marks: [], start: 4 },
            index: 2,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 9), {
            span: { marks: [], start: 9 },
            index: 4,
        })
    })
})
