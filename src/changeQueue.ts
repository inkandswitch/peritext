/**
 * Queue for storing editor changes, flushed at a given interval.
 */
import type { Change } from "./micromerge"

export class ChangeQueue {
    private changes: Array<Change> = []
    private timer: number | undefined = undefined

    /** Milliseconds between flushes. */
    private interval: number

    /** Flush action. */
    private handleFlush: (changes: Array<Change>) => void

    constructor({
        // Can tune this sync interval to simulate network latency,
        // make it easier to observe sync behavior, etc.
        interval = 10,
        handleFlush,
    }: {
        interval?: number
        /** Flush action. */
        handleFlush: (changes: Array<Change>) => void
    }) {
        this.interval = interval
        this.handleFlush = handleFlush
    }

    public enqueue(...changes: Array<Change>): void {
        this.changes.push(...changes)
    }

    /**
     * Flush all changes to the publisher. Runs on a timer.
     */
    flush = (): void => {
        // TODO: Add retry logic to capture failures.
        this.handleFlush(this.changes)
        this.changes = []
    }

    public start(): void {
        this.timer = window.setInterval(this.flush, this.interval)
    }

    public drop(): void {
        if (this.timer !== undefined) {
            window.clearInterval(this.timer)
        }
    }
}
