export function buildAllowOnlyPermission(allowed: readonly string[]): Record<string, "deny" | "allow"> {
    const permission: Record<string, "deny" | "allow"> = { "*": "deny" };
    for (const tool of allowed) {
        permission[tool] = "allow";
    }
    return permission;
}

export const HISTORIAN_ALLOWED_TOOLS = ["read", "aft_outline", "aft_zoom"] as const;

export const DREAMER_ALLOWED_TOOLS = [
    "read",
    "grep",
    "glob",
    "bash",
    "aft_outline",
    "aft_zoom",
    "ctx_memory",
    "ctx_search",
    "ctx_note",
] as const;

export const SIDEKICK_ALLOWED_TOOLS = ["ctx_search", "ctx_memory", "aft_outline", "aft_zoom"] as const;
