import { Text } from "ink";
import { DOT_COLOR, STATUS_GLYPH } from "../theme.js";
import type { EntryDot } from "../types.js";

export function StatusDot({ dot }: { dot: EntryDot | undefined }) {
    if (!dot) {
        return <Text> </Text>;
    }

    return <Text color={DOT_COLOR[dot]}>{STATUS_GLYPH}</Text>;
}
