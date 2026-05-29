import { describe, expect, it } from "bun:test";
import {
    buildSyntheticTodoPart,
    computeSyntheticCallId,
    isSyntheticTodoPart,
    normalizeTodoStateJson,
} from "./todo-view";

describe("todo-view", () => {
    it("normalizes todowrite input into stable json", () => {
        const state = normalizeTodoStateJson([
            { id: "1", content: "Build", status: "in_progress", priority: "high" },
            { content: "Test", status: "pending" },
        ]);

        expect(state).toBe(
            '[{"content":"Build","status":"in_progress","priority":"high"},{"content":"Test","status":"pending","priority":"medium"}]',
        );
        expect(normalizeTodoStateJson({ todos: [] })).toBeNull();
        expect(normalizeTodoStateJson([{ content: "missing status" }])).toBeNull();
    });

    it("builds OpenCode todowrite wire shape", () => {
        const state = JSON.stringify([
            { content: "Active", status: "in_progress", priority: "high" },
            { content: "Done", status: "completed", priority: "medium" },
        ]);
        const part = buildSyntheticTodoPart(state);

        expect(part).not.toBeNull();
        if (!part) throw new Error("missing part");
        expect(part.id).toMatch(/^prt_[0-9a-f]{16}0{10}$/);
        expect(part.sessionID).toBe("");
        expect(part.messageID).toBe("");
        expect(part.type).toBe("tool");
        expect(part.tool).toBe("todowrite");
        expect(part.callID).toBe(computeSyntheticCallId(state));
        expect(part.callID).toMatch(/^mc_synthetic_todo_[0-9a-f]{16}$/);
        expect(part.state.status).toBe("completed");
        expect(part.state.input.todos).toEqual(JSON.parse(state));
        expect(part.state.output).toBe(JSON.stringify(JSON.parse(state), null, 2));
        expect(part.state.title).toBe("1 todos");
        expect(part.state.metadata.truncated).toBe(false);
        expect(part.state.time.start).toBe(part.state.time.end);
        expect(isSyntheticTodoPart(part)).toBe(true);
    });

    it("does not build reminders for terminal-only state", () => {
        expect(
            buildSyntheticTodoPart(
                JSON.stringify([{ content: "Done", status: "completed", priority: "high" }]),
            ),
        ).toBeNull();
    });
});
