import { createHash } from "node:crypto";

export interface TodoItem {
    content: string;
    status: string;
    priority: string;
}

export interface SyntheticTodoPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "tool";
    callID: string;
    tool: "todowrite";
    state: {
        status: "completed";
        input: { todos: TodoItem[] };
        output: string;
        title: string;
        metadata: { todos: TodoItem[]; truncated: false };
        time: { start: number; end: number };
    };
    syntheticTodoMarker: true;
}

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
const TITLE_DONE_STATUSES = new Set(["completed"]);
const SYNTHETIC_CALL_ID_PREFIX = "mc_synthetic_todo_";

export function normalizeTodoStateJson(todos: unknown): string | null {
    if (!Array.isArray(todos)) return null;

    const normalized: TodoItem[] = [];
    for (const todo of todos) {
        if (!isTodoItem(todo)) return null;
        normalized.push({
            content: todo.content,
            status: todo.status,
            priority: todo.priority ?? "medium",
        });
    }

    return JSON.stringify(normalized);
}

export function buildSyntheticTodoPart(stateJson: string): SyntheticTodoPart | null {
    const todos = parseTodoState(stateJson);
    if (todos === null || todos.length === 0) return null;
    if (todos.every((todo) => TERMINAL_STATUSES.has(todo.status))) return null;

    const callID = computeSyntheticCallId(stateJson);
    const active = todos.filter((todo) => !TITLE_DONE_STATUSES.has(todo.status)).length;
    const time = 0;

    return {
        id: `prt_${callID.slice("mc_synthetic_todo_".length)}0000000000`,
        sessionID: "",
        messageID: "",
        type: "tool",
        callID,
        tool: "todowrite",
        state: {
            status: "completed",
            input: { todos },
            output: JSON.stringify(todos, null, 2),
            title: `${active} todos`,
            metadata: { todos, truncated: false },
            time: { start: time, end: time },
        },
        syntheticTodoMarker: true,
    };
}

export function computeSyntheticCallId(stateJson: string): string {
    const hash = createHash("sha256").update(stateJson).digest("hex").slice(0, 16);
    return `${SYNTHETIC_CALL_ID_PREFIX}${hash}`;
}

export function isSyntheticTodoPart(part: unknown): boolean {
    if (part === null || typeof part !== "object") return false;
    const p = part as {
        syntheticTodoMarker?: unknown;
        callID?: unknown;
        type?: unknown;
        tool?: unknown;
    };
    if (p.syntheticTodoMarker === true) return true;
    return (
        p.type === "tool" &&
        p.tool === "todowrite" &&
        typeof p.callID === "string" &&
        p.callID.startsWith(SYNTHETIC_CALL_ID_PREFIX)
    );
}

function parseTodoState(stateJson: string): TodoItem[] | null {
    if (stateJson.length === 0) return null;
    try {
        const parsed = JSON.parse(stateJson);
        if (!Array.isArray(parsed)) return null;
        const result: TodoItem[] = [];
        for (const item of parsed) {
            if (!isTodoItem(item)) continue;
            result.push({
                content: item.content,
                status: item.status,
                priority: item.priority ?? "medium",
            });
        }
        return result;
    } catch (_error) {
        return null;
    }
}

function isTodoItem(value: unknown): value is TodoItem {
    if (value === null || typeof value !== "object") return false;
    const todo = value as Record<string, unknown>;
    return (
        typeof todo.content === "string" &&
        typeof todo.status === "string" &&
        (todo.priority === undefined || typeof todo.priority === "string")
    );
}
