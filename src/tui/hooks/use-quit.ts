import { useApp } from "ink";
import { useCallback, useEffect, useState } from "react";
import type { CoverPlacer } from "../cover-overlay.js";
import type { TaggingQueue } from "../tagging-queue.js";
import type { QueueState, TuiOutcome } from "../types.js";

export interface QuitControl {
    quitting: boolean;
    requestQuit(): void;
}

function getOutcome({ failed }: QueueState): TuiOutcome {
    return failed ? "failure" : "success";
}

// Covers are freed before Ink leaves the alternate screen, where they live;
// unmount cleanups would only run after that.
function useExitFreeingCovers(covers: CoverPlacer) {
    const { exit } = useApp();
    return useCallback(
        (outcome: TuiOutcome) => {
            covers.clear();
            exit(outcome);
        },
        [covers, exit]
    );
}

export function useQuit(
    queue: TaggingQueue,
    queueState: QueueState,
    covers: CoverPlacer
): QuitControl {
    const exit = useExitFreeingCovers(covers);
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
