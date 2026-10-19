import { Box, Text } from "ink";
import { useStore } from "../hooks/use-store.js";
import type { LogBuffer, LogLine } from "../log-buffer.js";
import { ERROR_COLOR, PANE_COLOR } from "../theme.js";

function LogLineText({ line }: { line: LogLine }) {
    return (
        <Text color={line.isError ? ERROR_COLOR : undefined} wrap="truncate">
            {line.text}
        </Text>
    );
}

export interface LogPaneProps {
    logBuffer: LogBuffer;
    height: number;
}

export function LogPane({ logBuffer, height }: LogPaneProps) {
    const lines = useStore(logBuffer).slice(-height);
    return (
        <Box
            flexDirection="column"
            height={height + 2}
            flexShrink={0}
            borderStyle="round"
            borderColor={PANE_COLOR.log}
            paddingX={1}
        >
            {lines.map((line, index) => (
                <LogLineText key={index} line={line} />
            ))}
        </Box>
    );
}
