import { Text } from "ink";
import type { TrackStatus } from "../../processing/types.js";
import { STATUS_COLOR, STATUS_GLYPH } from "../theme.js";

export function StatusDot({ status }: { status: TrackStatus | undefined }) {
    if (!status) {
        return <Text> </Text>;
    }

    return <Text color={STATUS_COLOR[status]}>{STATUS_GLYPH}</Text>;
}
