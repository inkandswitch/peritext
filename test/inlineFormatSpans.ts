import assert from "assert"
import { FormatSpan, replayOps } from "../src/format"
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
            { marks: [], start: 16 },
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
