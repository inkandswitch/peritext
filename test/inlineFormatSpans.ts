import assert from "assert"
import { replayOps } from '../src/format'

describe("hello", function () {
  it("tests run", function () {
    assert.deepStrictEqual(replayOps([]), [])
  })
})
