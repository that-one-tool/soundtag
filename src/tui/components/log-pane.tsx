import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { useStore } from "../hooks/use-store.js";
import type { LogBuffer, LogLine } from "../log-buffer.js";
import { getLogWindow } from "../log-scroll.js";
import { wrapLogLines } from "../log-wrap.js";
import { ERROR_COLOR, PANE_COLOR } from "../theme.js";

function LogLineText({ line }: { line: LogLine }) {
    return (
        <Text color={line.isError ? ERROR_COLOR : undefined} wrap="truncate">
            {line.text || " "}
        </Text>
    );
}

interface LogTitleProps {
    hiddenBelow: number;
    focused: boolean;
}

// Drawn over the top border, so it takes no log line.
function LogTitle({ hiddenBelow, focused }: LogTitleProps) {
    const position = hiddenBelow > 0 ? ` ↑${hiddenBelow}` : "";
    return (
        <Box position="absolute" top={-1}>
            <Text bold={focused} color={PANE_COLOR.log} wrap="truncate">
                {` Log${position} `}
            </Text>
        </Box>
    );
}

interface LogFrameProps extends LogTitleProps {
    height: number;
    children: ReactNode;
}

function LogFrame({ height, focused, hiddenBelow, children }: LogFrameProps) {
    return (
        <Box
            flexDirection="column"
            height={height + 2}
            flexShrink={0}
            borderStyle="round"
            borderColor={PANE_COLOR.log}
            borderDimColor={!focused}
            paddingX={1}
        >
            <LogTitle hiddenBelow={hiddenBelow} focused={focused} />
            {children}
        </Box>
    );
}

export interface LogPaneProps {
    logBuffer: LogBuffer;
    height: number;
    width: number;
    anchorId: number | null;
    focused: boolean;
}

export function LogPane({
    logBuffer,
    anchorId,
    width,
    ...frame
}: LogPaneProps) {
    const rows = wrapLogLines(useStore(logBuffer), width);
    const window = getLogWindow(rows, frame.height, anchorId);
    return (
        <LogFrame {...frame} hiddenBelow={window.hiddenBelow}>
            {window.lines.map((line) => (
                <LogLineText key={line.id} line={line} />
            ))}
        </LogFrame>
    );
}
