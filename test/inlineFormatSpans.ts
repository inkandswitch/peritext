import assert from "assert"
import {
    FormatSpan,
    replayOps,
    getSpanAtPosition,
    normalize,
} from "../src/format"
import { ResolvedOp } from "../src/operations"

describe("applying format spans", function () {
    describe("with no ops", function () {
        const ops: ResolvedOp[] = []
        it("returns a single span starting at 0", function () {
            assert.deepStrictEqual(replayOps(ops, 20), [
                { marks: new Set([]), start: 0 },
            ])
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
            { marks: new Set(), start: 0 },
            { marks: new Set(["strong"]), start: 2 },
            { marks: new Set([]), start: 10 },
        ]

        it("returns the expected result", function () {
            assert.deepStrictEqual(replayOps(ops, 20), expected)
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
            { marks: new Set([]), start: 0 },
            { marks: new Set(["strong"]), start: 2 },
            { marks: new Set([]), start: 5 },
            { marks: new Set(["strong"]), start: 11 },
            { marks: new Set([]), start: 17 },
        ]

        it("returns the expected result", function () {
            assert.deepStrictEqual(replayOps(ops, 20), expected)
        })
    })

    describe("with bold, unbold, then italic", function () {
        // TODO: This test fails because we don't consider doc length;
        // we need to avoid returning extra spans at the end which go past
        // the end of the document.

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
            { marks: new Set([]), start: 0 },
            { marks: new Set(["em"]), start: 1 },
            { marks: new Set(["em", "strong"]), start: 4 },
            { marks: new Set(["em"]), start: 9 },
        ]

        it("returns the expected result", function () {
            assert.deepStrictEqual(replayOps(ops, 20), expected)
        })
    })
})

describe("getSpanAtPosition", () => {
    it("handles empty lists", () => {
        assert.deepStrictEqual(getSpanAtPosition([], 5), undefined)
    })

    it("handles single item lists", () => {
        assert.deepStrictEqual(
            getSpanAtPosition([{ marks: new Set([]), start: 0 }], 5),
            {
                span: { marks: new Set([]), start: 0 },
                index: 0,
            }
        )
        assert.deepStrictEqual(
            getSpanAtPosition([{ marks: new Set([]), start: 6 }], 1),
            undefined
        )
    })

    it("returns undefined when the given position precedes all spans", () => {
        const spans = [
            { marks: new Set([]), start: 3 },
            { marks: new Set([]), start: 4 },
            { marks: new Set([]), start: 7 },
            { marks: new Set([]), start: 9 },
            { marks: new Set([]), start: 11 },
            { marks: new Set([]), start: 15 },
            { marks: new Set([]), start: 16 },
            { marks: new Set([]), start: 21 },
        ]
        assert.deepStrictEqual(getSpanAtPosition(spans, 2), undefined)
    })

    it("returns the rightmost span whose index is < the given position", () => {
        const spans = [
            { marks: new Set([]), start: 0 },
            { marks: new Set([]), start: 3 },
            { marks: new Set([]), start: 4 },
            { marks: new Set([]), start: 7 },
            { marks: new Set([]), start: 9 },
            { marks: new Set([]), start: 11 },
            { marks: new Set([]), start: 15 },
            { marks: new Set([]), start: 16 },
            { marks: new Set([]), start: 21 },
        ]
        assert.deepStrictEqual(getSpanAtPosition(spans, 5), {
            span: { marks: new Set([]), start: 4 },
            index: 2,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 20), {
            span: { marks: new Set([]), start: 16 },
            index: 7,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 10), {
            span: { marks: new Set([]), start: 9 },
            index: 4,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 10000), {
            span: { marks: new Set([]), start: 21 },
            index: 8,
        })
    })

    it("returns any span === the given position", () => {
        const spans = [
            { marks: new Set([]), start: 0 },
            { marks: new Set([]), start: 3 },
            { marks: new Set([]), start: 4 },
            { marks: new Set([]), start: 7 },
            { marks: new Set([]), start: 9 },
            { marks: new Set([]), start: 11 },
            { marks: new Set([]), start: 15 },
            { marks: new Set([]), start: 16 },
            { marks: new Set([]), start: 21 },
        ]
        assert.deepStrictEqual(getSpanAtPosition(spans, 15), {
            span: { marks: new Set([]), start: 15 },
            index: 6,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 4), {
            span: { marks: new Set([]), start: 4 },
            index: 2,
        })
        assert.deepStrictEqual(getSpanAtPosition(spans, 9), {
            span: { marks: new Set([]), start: 9 },
            index: 4,
        })
    })
})

describe("normalize", () => {
    it("compacts a few unstyled spans into one", () => {
        const spans = [
            { marks: new Set([]), start: 0 },
            { marks: new Set([]), start: 3 },
            { marks: new Set([]), start: 4 },
        ]

        assert.deepStrictEqual(normalize(spans, 1000), [
            { marks: new Set([]), start: 0 },
        ])
    })

    it("handles a more complex compaction case", () => {
        const spans: FormatSpan[] = [
            { marks: new Set([]), start: 0 },
            { marks: new Set([]), start: 3 },
            { marks: new Set(["strong"]), start: 4 },
            { marks: new Set(["strong"]), start: 7 },
            { marks: new Set(["strong"]), start: 12 },
            { marks: new Set(["strong", "em"]), start: 14 },
            { marks: new Set(["em"]), start: 16 },
            { marks: new Set(["em"]), start: 18 },
        ]

        assert.deepStrictEqual(normalize(spans, 1000), [
            { marks: new Set([]), start: 0 },
            { marks: new Set(["strong"]), start: 4 },
            { marks: new Set(["strong", "em"]), start: 14 },
            { marks: new Set(["em"]), start: 16 },
        ])
    })

    it("removes spans past the end of the document", () => {
        const spans: FormatSpan[] = [
            { marks: new Set([]), start: 0 },
            { marks: new Set([]), start: 3 },
            { marks: new Set(["strong"]), start: 4 },
            { marks: new Set(["strong"]), start: 7 },
            { marks: new Set([]), start: 10 },
        ]

        assert.deepStrictEqual(normalize(spans, 10), [
            { marks: new Set([]), start: 0 },
            { marks: new Set(["strong"]), start: 4 },
        ])
    })
})
