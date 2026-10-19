import { Box, Text } from "ink";
import { describeQueue } from "../queue-summary.js";
import type { QueueState } from "../types.js";

const KEY_HELP = "↑↓ move  ⏎/→ open  ← up  t tag  a tag folder  s stop  q quit";

export interface StatusBarProps {
    queueState: QueueState;
    quitting: boolean;
}

export function StatusBar({ queueState, quitting }: StatusBarProps) {
    return (
        <Box justifyContent="space-between" gap={2} paddingX={1}>
            <Box flexShrink={0}>
                <Text color="cyan">{describeQueue(queueState, quitting)}</Text>
            </Box>
            <Text dimColor wrap="truncate">
                {KEY_HELP}
            </Text>
        </Box>
    );
}
