import { Listeners } from "./listeners.js";

export class SubfolderSetting {
    private readonly listeners = new Listeners();

    constructor(private included: boolean) {}

    subscribe = (listener: () => void): (() => void) =>
        this.listeners.add(listener);

    getSnapshot = (): boolean => this.included;

    toggle(): void {
        this.included = !this.included;
        this.listeners.notify();
    }
}
