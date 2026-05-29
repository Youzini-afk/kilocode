import { describe, expect, it } from "bun:test";
import { getOrCreateSessionMeta } from "../../features/magic-context/storage";
import { initializeDatabase } from "../../features/magic-context/storage-db";
import { Database } from "../../shared/sqlite";
import { createToolExecuteAfterHook } from "./hook-handlers";

function db(): Database {
    const storage = new Database(":memory:");
    initializeDatabase(storage);
    return storage;
}

describe("tool.execute.after todowrite", () => {
    it("updates lastTodoState from todowrite args", async () => {
        const storage = db();
        const hook = createToolExecuteAfterHook({
            db: storage,
            recentReduceBySession: new Map(),
            toolUsageSinceUserTurn: new Map(),
        });

        await hook({
            tool: "todowrite",
            sessionID: "s1",
            args: {
                todos: [{ id: "1", content: "Build", status: "pending", priority: "high" }],
            },
        });

        expect(getOrCreateSessionMeta(storage, "s1").lastTodoState).toBe(
            '[{"content":"Build","status":"pending","priority":"high"}]',
        );
    });
});
