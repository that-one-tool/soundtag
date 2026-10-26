import { Box, Text } from "ink";
import {
    describeOverwriteChoice,
    describeQueue,
    describeSubfolderChoice,
} from "../queue-summary.js";
import { ACCENT } from "../theme.js";
import type { QueueState } from "../types.js";

type Hint = readonly [key: string, label: string];

const KEY_HINTS: Hint[] = [
    ["↑↓", "move"],
    ["⏎/→", "open"],
    ["←", "up"],
    ["t", "tag"],
    ["a", "all"],
    ["e", "name"],
    ["D", "clear"],
    ["r", "subs"],
    ["w", "overwrite"],
    ["s", "stop"],
    ["q", "quit"],
    ["⇥", "log"],
];

function KeyHints() {
    return (
        <Text wrap="truncate">
            {KEY_HINTS.map(([key, label], index) => (
                <Text key={key}>
                    {index > 0 ? "  " : ""}
                    <Text bold color={ACCENT}>
                        {key}
                    </Text>
                    <Text dimColor>{` ${label}`}</Text>
                </Text>
            ))}
        </Text>
    );
}

export interface StatusBarProps {
    queueState: QueueState;
    quitting: boolean;
    subfoldersIncluded: boolean;
    overwriteEnabled: boolean;
}

function describeStatus(props: StatusBarProps): string {
    return [
        describeQueue(props.queueState, props.quitting),
        describeSubfolderChoice(props.subfoldersIncluded),
        describeOverwriteChoice(props.overwriteEnabled),
    ].join(" · ");
}

export function StatusBar(props: StatusBarProps) {
    return (
        <Box justifyContent="space-between" gap={2} paddingX={1}>
            <Box flexShrink={0}>
                <Text color={ACCENT}>{describeStatus(props)}</Text>
            </Box>
            <KeyHints />
        </Box>
    );
}
