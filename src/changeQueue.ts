/**
 * Queue for storing editor changes, flushed at a given interval.
 */
import * as crdt from "./crdt"

export class ChangeQueue {
    private changes: Array<crdt.Change> = []
    private timer: number | undefined = undefined

    /** Milliseconds between flushes. */
    private interval: number

    /** Flush action. */
    private handleFlush: (changes: Array<crdt.Change>) => void

    constructor({
        interval = 5000,
        handleFlush,
    }: {
        interval?: number
        /** Flush action. */
        handleFlush: (changes: Array<crdt.Change>) => void
    }) {
        this.interval = interval
        this.handleFlush = handleFlush
        this.timer = window.setInterval(this.flush, interval)
    }

    public enqueue(...changes: Array<crdt.Change>): void {
        this.changes.push(...changes)
    }

    /**
     * Flush all changes to the publisher. Runs on a timer.
     */
    private flush = (): void => {
        // TODO: Add retry logic to capture failures.
        if (this.changes.length > 0) {
            console.log("flushing", this.changes)
        }
        this.handleFlush(this.changes)
        this.changes = []
    }

    public drop(): void {
        if (this.timer !== undefined) {
            window.clearInterval(this.timer)
        }
    }
}
