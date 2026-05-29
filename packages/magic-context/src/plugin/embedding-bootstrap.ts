import { loadPluginConfigDetailed } from "../config";
import {
    type EmbeddingFeatures,
    registerProjectInObservationMode,
    registerProjectEmbeddingAndMaybeWipe,
} from "../features/magic-context/memory/embedding";
import { resolveProjectIdentity } from "../features/magic-context/memory/project-identity";
import type { Database } from "../shared/sqlite";

function hasEmbeddingRecoveryWarning(warnings: string[] | undefined): boolean {
    return (warnings ?? []).some((warning) => {
        const lower = warning.toLowerCase();
        return (
            lower.includes("embedding") ||
            lower.includes("api_key") ||
            lower.includes("endpoint") ||
            lower.includes("provider") ||
            lower.includes("model")
        );
    });
}

function hasLoadFailure(outcome: { userConfig: string; projectConfig: string }): boolean {
    return outcome.userConfig === "load-error" || outcome.projectConfig === "load-error";
}

export async function ensureProjectRegisteredFromOpenCodeDirectory(
    directory: string,
    db: Database,
): Promise<void> {
    const projectIdentity = resolveProjectIdentity(directory);

    const detailed = loadPluginConfigDetailed(directory);
    const config = detailed.config;
    if (
        hasLoadFailure(detailed.sources) ||
        detailed.embeddingSubstitutionFailure ||
        hasEmbeddingRecoveryWarning(config.configWarnings)
    ) {
        registerProjectInObservationMode(
            db,
            projectIdentity,
            directory,
            config.embedding,
            config.configWarnings?.join("; ") || detailed.warnings.join("; ") || "config load recovery",
        );
        return;
    }

    const features: EmbeddingFeatures = {
        memoryEnabled: config.memory.enabled,
        gitCommitEnabled: config.experimental.git_commit_indexing.enabled,
    };
    registerProjectEmbeddingAndMaybeWipe(
        db,
        projectIdentity,
        config.embedding,
        features,
        directory,
    );
}
