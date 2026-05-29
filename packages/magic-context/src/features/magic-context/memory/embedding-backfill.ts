import { log } from "../../../shared/logger";
import type { Database } from "../../../shared/sqlite";
import { embedBatch, getEmbeddingModelId, isEmbeddingEnabled } from "./embedding";
import { embedBatchForProject, getProjectEmbeddingSnapshot } from "../project-embedding-registry";
import { saveEmbedding } from "./storage-memory-embeddings";
import type { Memory } from "./types";

export async function ensureMemoryEmbeddings(args: {
    db: Database;
    projectPath?: string;
    memories: Memory[];
    existingEmbeddings: Map<number, Float32Array>;
}): Promise<Map<number, Float32Array>> {
    const snapshot = args.projectPath ? getProjectEmbeddingSnapshot(args.projectPath) : null;
    if (snapshot ? !snapshot.enabled : !isEmbeddingEnabled()) {
        return args.existingEmbeddings;
    }

    const missingMemories = args.memories.filter(
        (memory) => !args.existingEmbeddings.has(memory.id),
    );
    if (missingMemories.length === 0) {
        return args.existingEmbeddings;
    }

    try {
        const texts = missingMemories.map((memory) => memory.content);
        const result = args.projectPath ? await embedBatchForProject(args.projectPath, texts) : null;
        if (args.projectPath && snapshot) {
            if (!result) return args.existingEmbeddings;
        }
        const embeddings = result?.vectors ?? (await embedBatch(texts));
        const modelId = result?.modelId ?? getEmbeddingModelId();

        // Stage results before committing — only merge into the in-memory cache after
        // the transaction succeeds, so a rollback doesn't leave stale Map entries.
        const staged = new Map<number, Float32Array>();
        args.db.transaction(() => {
            for (const [index, memory] of missingMemories.entries()) {
                const embedding = embeddings[index];
                if (!embedding) {
                    continue;
                }

                saveEmbedding(args.db, memory.id, embedding, modelId);
                staged.set(memory.id, embedding);
            }
        })();

        // Transaction committed — safe to merge into caller's cache
        for (const [id, embedding] of staged) {
            args.existingEmbeddings.set(id, embedding);
        }
    } catch (error) {
        log("[magic-context] failed to backfill memory embeddings:", error);
    }

    return args.existingEmbeddings;
}
