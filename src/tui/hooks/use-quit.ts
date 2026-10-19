import { useApp } from "ink";
import { useEffect, useState } from "react";
import type { TaggingQueue } from "../tagging-queue.js";
import type { QueueState, TuiOutcome } from "../types.js";

export interface QuitControl {
    quitting: boolean;
    requestQuit(): void;
}

function getOutcome({ failed }: QueueState): TuiOutcome {
    return failed ? "failure" : "success";
}

export function useQuit(
    queue: TaggingQueue,
    queueState: QueueState
): QuitControl {
    const { exit } = useApp();
    const [quitting, setQuitting] = useState(false);

    useEffect(() => {
        if (quitting && !queueState.running) {
            exit(getOutcome(queueState));
        }
    }, [quitting, queueState, exit]);

    const startQuitting = () => {
        queue.stop();
        setQuitting(true);
    };
    const requestQuit = () => (quitting ? exit("forced") : startQuitting());
    return { quitting, requestQuit };
}
