import { Text } from "ink";
import { ACCENT, STATUS_COLOR, STATUS_GLYPH } from "../theme.js";
import { countStatuses, STATUS_ORDER } from "../track-statuses.js";
import type { TrackStatuses } from "../types.js";

export function Header({ statuses }: { statuses: TrackStatuses }) {
    const counts = countStatuses(statuses);
    return (
        <Text wrap="truncate">
            <Text bold color={ACCENT}>
                {" ♫ soundtag"}
            </Text>
            {STATUS_ORDER.map((status) => (
                <Text key={status} color={STATUS_COLOR[status]}>
                    {`  ${STATUS_GLYPH} ${counts[status]} ${status.toLowerCase()}`}
                </Text>
            ))}
        </Text>
    );
}
