import { Box, Text } from "ink";
import {
    describeQueue,
    describeRenamingChoice,
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
    ["n", "names"],
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
    renamingEnabled: boolean;
}

export function StatusBar({
    queueState,
    quitting,
    subfoldersIncluded,
    renamingEnabled,
}: StatusBarProps) {
    return (
        <Box justifyContent="space-between" gap={2} paddingX={1}>
            <Box flexShrink={0}>
                <Text color={ACCENT}>
                    {describeQueue(queueState, quitting)}
                    {` · ${describeSubfolderChoice(subfoldersIncluded)}`}
                    {` · ${describeRenamingChoice(renamingEnabled)}`}
                </Text>
            </Box>
            <KeyHints />
        </Box>
    );
}
