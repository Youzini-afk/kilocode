import { describe, expect, it } from "bun:test";
import {
    buildAllowOnlyPermission,
    DREAMER_ALLOWED_TOOLS,
    HISTORIAN_ALLOWED_TOOLS,
    SIDEKICK_ALLOWED_TOOLS,
} from "./permissions";

describe("hidden agent permissions", () => {
    it("starts from wildcard deny and allows named tools", () => {
        expect(buildAllowOnlyPermission(["read", "ctx_search"])).toEqual({
            "*": "deny",
            read: "allow",
            ctx_search: "allow",
        });
    });

    it("keeps hidden agent tool surfaces bounded", () => {
        expect(HISTORIAN_ALLOWED_TOOLS).not.toContain("task");
        expect(HISTORIAN_ALLOWED_TOOLS).not.toContain("bash");
        expect(DREAMER_ALLOWED_TOOLS).not.toContain("task");
        expect(DREAMER_ALLOWED_TOOLS).not.toContain("edit");
        expect(SIDEKICK_ALLOWED_TOOLS).not.toContain("bash");
        expect(SIDEKICK_ALLOWED_TOOLS).not.toContain("edit");
    });
});
