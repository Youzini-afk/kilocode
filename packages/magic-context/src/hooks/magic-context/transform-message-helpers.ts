import { hasMeaningfulUserText } from "./read-session-formatting";
import { isSentinel } from "./sentinel";
import { isTextPart } from "./tag-part-guards";
import type { MessageLike } from "./transform-operations";

/**
 * Check if a user message contains real user content (not just ignored
 * notifications, system reminders, or command output). Uses the same
 * logic the historian uses for protected-tail counting.
 */
function isMeaningfulUserMessage(msg: MessageLike): boolean {
    return msg.info.role === "user" && hasMeaningfulUserText(msg.parts as unknown[]);
}

export function findSessionId(messages: MessageLike[]): string | null {
    // Session ID is valid on any user message, including ignored ones
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.info.role === "user" && typeof message.info.sessionID === "string") {
            return message.info.sessionID;
        }
    }

    return null;
}

export function findLastUserMessageId(messages: MessageLike[]): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (isMeaningfulUserMessage(message) && typeof message.info.id === "string") {
            return message.info.id;
        }
    }

    return null;
}

export function appendReminderToLatestUserMessage(
    messages: MessageLike[],
    reminder: string,
): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!isMeaningfulUserMessage(message)) {
            continue;
        }

        appendReminderToUserMessage(message, reminder);
        return typeof message.info.id === "string" ? message.info.id : null;
    }

    return null;
}

export function appendReminderToUserMessageById(
    messages: MessageLike[],
    messageId: string,
    reminder: string,
): boolean {
    for (const message of messages) {
        if (message.info.id !== messageId || !isMeaningfulUserMessage(message)) {
            continue;
        }

        appendReminderToUserMessage(message, reminder);
        return true;
    }

    return false;
}

export function countMessagesSinceLastUser(messages: MessageLike[]): number {
    let messagesSinceLastUser = 0;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (isMeaningfulUserMessage(messages[i])) break;
        messagesSinceLastUser += 1;
    }
    return messagesSinceLastUser;
}

export function injectToolPartIntoLatestAssistant(
    messages: MessageLike[],
    part: { callID: string; id?: string; sessionID?: string; messageID?: string },
): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.info.role !== "assistant") continue;
        if (typeof message.info.id !== "string") continue;
        if (hasToolPartWithCallId(message, part.callID)) return message.info.id;
        if (!isAppendableAssistantMessage(message)) continue;
        stampToolPart(message, part);
        message.parts.push(part);
        return message.info.id;
    }
    return null;
}

export function injectToolPartIntoAssistantById(
    messages: MessageLike[],
    messageId: string,
    part: { callID: string; id?: string; sessionID?: string; messageID?: string },
): boolean {
    for (const message of messages) {
        if (message.info.id !== messageId) continue;
        if (message.info.role !== "assistant") continue;
        if (hasToolPartWithCallId(message, part.callID)) return true;
        if (!isAppendableAssistantMessage(message)) return false;
        stampToolPart(message, part);
        message.parts.push(part);
        return true;
    }
    return false;
}

function hasToolPartWithCallId(message: MessageLike, callId: string): boolean {
    for (const part of message.parts) {
        if (part === null || typeof part !== "object") continue;
        const p = part as { type?: unknown; callID?: unknown };
        if (p.type === "tool" && p.callID === callId) return true;
    }
    return false;
}

function isToolProtocolPart(part: unknown): boolean {
    if (part === null || typeof part !== "object") return false;
    const p = part as Record<string, unknown>;
    return (
        p.type === "tool" ||
        p.type === "tool-invocation" ||
        p.type === "tool_use" ||
        p.type === "tool_result"
    );
}

function hasThinkingBearingParts(message: MessageLike): boolean {
    return message.parts.some((part) => {
        if (part === null || typeof part !== "object") return false;
        const p = part as Record<string, unknown>;
        return p.type === "thinking" || p.type === "reasoning" || p.type === "redacted_thinking";
    });
}

function isMessageDropped(message: MessageLike): boolean {
    const textParts = message.parts.filter(isTextPart);
    if (textParts.length === 0) return true;
    if (message.parts.every(isSentinel)) return true;
    return textParts.every(
        (part) =>
            part.text.length === 0 ||
            part.text.startsWith("[dropped ") ||
            part.text.startsWith("[cleared]"),
    );
}

function isAppendableAssistantMessage(message: MessageLike): boolean {
    return (
        message.info.role === "assistant" &&
        !message.parts.some(isToolProtocolPart) &&
        !isMessageDropped(message) &&
        !hasThinkingBearingParts(message)
    );
}

function stampToolPart(
    message: MessageLike,
    part: { callID: string; id?: string; sessionID?: string; messageID?: string },
): void {
    const id = typeof message.info.id === "string" ? message.info.id : "";
    const sessionID = typeof message.info.sessionID === "string" ? message.info.sessionID : "";
    part.messageID = id;
    part.sessionID = sessionID;
    part.id = part.id || `${part.callID}_part`;
}

function appendReminderToUserMessage(message: MessageLike, reminder: string): void {
    for (const part of message.parts) {
        if (!isTextPart(part)) {
            continue;
        }

        if (!part.text.includes(reminder)) {
            part.text += reminder;
        }
        return;
    }

    message.parts.unshift({ type: "text", text: reminder.trimStart() });
}
