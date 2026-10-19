import { Text } from "ink";
import type { TrackStatus } from "../../processing/types.js";

const STATUS_COLORS: Record<TrackStatus, string> = {
    TAGGED: "green",
    SKIPPED: "yellow",
    FAILED: "red",
};

export function StatusDot({ status }: { status: TrackStatus | undefined }) {
    if (!status) {
        return <Text> </Text>;
    }

    return <Text color={STATUS_COLORS[status]}>●</Text>;
}
