import Micromerge, { Change, Patch } from "../src/micromerge"
import { queues } from "./fuzz"

export function applyChanges(document: Micromerge, changes: Change[]): Patch[] {
    let iterations = 0
    const patches = []
    while (changes.length > 0) {
        const change = changes.shift()
        if (!change) {
            return patches
        }
        try {
            const newPatches = document.applyChange(change)
            patches.push(...newPatches)
        } catch {
            changes.push(change)
        }
        if (iterations++ > 10000) {
            console.log(patches)
            throw "applyChanges did not converge"
        }
    }
    return patches
}

export function getMissingChanges(source: Micromerge, target: Micromerge): Change[] {
    const sourceClock = source.clock
    const targetClock = target.clock
    const changes = []
    for (const [actor, number] of Object.entries(sourceClock)) {
        if (targetClock[actor] === undefined) {
            changes.push(...queues[actor].slice(0, number))
        }
        if (targetClock[actor] < number) {
            changes.push(...queues[actor].slice(targetClock[actor], number))
        }
    }
    return changes
}
