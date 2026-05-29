import { describe, expect, it } from "bun:test";
import { initializeDatabase } from "../../features/magic-context/storage-db";
import {
    getOrCreateSessionMeta,
    getPersistedTodoSyntheticAnchor,
    setPersistedTodoSyntheticAnchor,
    updateSessionMeta,
} from "../../features/magic-context/storage";
import { createTagger } from "../../features/magic-context/tagger";
import { Database } from "../../shared/sqlite";
import { buildSyntheticTodoPart, computeSyntheticCallId, isSyntheticTodoPart } from "./todo-view";
import { createNudgePlacementStore } from "./nudge-placement-store";
import { runPostTransformPhase } from "./transform-postprocess-phase";
import { tagMessages, type MessageLike } from "./transform-operations";

const ACTIVE = JSON.stringify([
    { content: "Build feature", status: "in_progress", priority: "high" },
]);
const NEXT = JSON.stringify([{ content: "Next", status: "pending", priority: "medium" }]);

function db(): Database {
    const storage = new Database(":memory:");
    initializeDatabase(storage);
    return storage;
}

function messages(): MessageLike[] {
    return [
        { info: { id: "u1", role: "user", sessionID: "s1" }, parts: [{ type: "text", text: "hi" }] },
        { info: { id: "a1", role: "assistant", sessionID: "s1" }, parts: [{ type: "text", text: "ok" }] },
    ];
}

async function synth(args: {
    storage: Database;
    sessionId: string;
    messages: MessageLike[];
    bust: boolean;
}): Promise<void> {
    await runPostTransformPhase({
        sessionId: args.sessionId,
        db: args.storage,
        messages: args.messages,
        tags: [],
        targets: new Map(),
        reasoningByMessage: new Map(),
        messageTagNumbers: new Map(),
        batch: null,
        contextUsage: { percentage: 0, inputTokens: 0 },
        schedulerDecision: args.bust ? "execute" : "defer",
        fullFeatureMode: true,
        canRunCompartments: false,
        awaitedCompartmentRun: false,
        compartmentInProgress: false,
        sessionMeta: getOrCreateSessionMeta(args.storage, args.sessionId),
        currentTurnId: "u1",
        pendingMaterializationSessions: new Set(),
        lastHeuristicsTurnId: new Map(),
        autoDropToolAge: 100,
        dropToolStructure: true,
        clearReasoningAge: 50,
        protectedTags: 20,
        nudgePlacements: createNudgePlacementStore(args.storage),
        nudger: () => null,
        pendingCompartmentInjection: null,
        didMutateFromFlushedStatuses: false,
        watermark: 0,
        forceMaterializationPercentage: 85,
        hasRecentReduceCall: false,
        skipTypedReasoningCleanup: false,
    });
}

function synthetic(list: MessageLike[]): unknown {
    return list.flatMap((msg) => msg.parts).find(isSyntheticTodoPart);
}

describe("todo state postprocess", () => {
    it("injects on cache-bust and persists anchor", async () => {
        const storage = db();
        updateSessionMeta(storage, "s1", { lastTodoState: ACTIVE });
        const list = messages();

        await synth({ storage, sessionId: "s1", messages: list, bust: true });

        const part = synthetic(list) as { callID?: string; messageID?: string; sessionID?: string } | undefined;
        expect(part?.callID).toBe(computeSyntheticCallId(ACTIVE));
        expect(part?.messageID).toBe("a1");
        expect(part?.sessionID).toBe("s1");
        expect(getPersistedTodoSyntheticAnchor(storage, "s1")).toEqual({
            callId: computeSyntheticCallId(ACTIVE),
            messageId: "a1",
            stateJson: ACTIVE,
        });
    });

    it("replays defer from persisted stateJson, not current lastTodoState", async () => {
        const storage = db();
        const callId = computeSyntheticCallId(ACTIVE);
        setPersistedTodoSyntheticAnchor(storage, "s1", callId, "a1", ACTIVE);
        updateSessionMeta(storage, "s1", { lastTodoState: NEXT });

        const one = messages();
        const two = messages();
        await synth({ storage, sessionId: "s1", messages: one, bust: false });
        await synth({ storage, sessionId: "s1", messages: two, bust: false });

        expect(JSON.stringify(one)).toBe(JSON.stringify(two));
        const part = synthetic(one) as { callID?: string; state?: { input?: { todos?: unknown } } };
        expect(part.callID).toBe(callId);
        expect(part.state?.input?.todos).toEqual(JSON.parse(ACTIVE));
    });

    it("does not tag synthetic todo parts", () => {
        const storage = db();
        const list = messages();
        const part = buildSyntheticTodoPart(ACTIVE);
        if (!part) throw new Error("missing part");
        list[1].parts.push(part);

        tagMessages("s1", list, createTagger(), storage);

        expect(part.state.output.startsWith("§")).toBe(false);
    });

    it("does not mutate reasoning-bearing assistant messages", async () => {
        const storage = db();
        updateSessionMeta(storage, "s1", { lastTodoState: ACTIVE });
        const list = messages();
        list[1].parts.push({ type: "reasoning", text: "signed" });

        await synth({ storage, sessionId: "s1", messages: list, bust: true });

        expect(synthetic(list)).toBeUndefined();
        expect(getPersistedTodoSyntheticAnchor(storage, "s1")).toBeNull();
    });

    it("does not mutate empty sentinel assistant messages", async () => {
        const storage = db();
        updateSessionMeta(storage, "s1", { lastTodoState: ACTIVE });
        const list = messages();
        list[1].parts = [{ type: "text", text: "" }];

        await synth({ storage, sessionId: "s1", messages: list, bust: true });

        expect(synthetic(list)).toBeUndefined();
        expect(getPersistedTodoSyntheticAnchor(storage, "s1")).toBeNull();
    });
});
