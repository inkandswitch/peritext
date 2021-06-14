export class Publisher<T> {
    private subscribers: Record<string, (update: T) => void> = {}

    public subscribe(key: string, callback: (update: T) => void): void {
        if (this.subscribers[key]) {
            throw new Error(`Subscriber already exists: ${key}`)
        }
        this.subscribers[key] = callback
    }

    public unsubscribe(key: string): void {
        if (!this.subscribers[key]) {
            throw new Error(`Subscriber not found: ${key}`)
        }
        delete this.subscribers[key]
    }

    public publish(sender: string, update: T): void {
        for (const [id, callback] of Object.entries(this.subscribers)) {
            if (id === sender) {
                continue
            }
            callback(update)
        }
    }
}
