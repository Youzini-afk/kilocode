import { z } from "zod";

export const NpmPackageEnvelopeSchema = z.object({
    "dist-tags": z.record(z.string(), z.string()).optional().default({}),
});

export const KiloPluginTupleSchema = z.tuple([z.string(), z.record(z.string(), z.unknown())]);

export const KiloConfigSchema = z.object({
    plugin: z.array(z.union([z.string(), KiloPluginTupleSchema])).optional(),
});

export const PackageJsonSchema = z
    .object({
        name: z.string().optional(),
        version: z.string().optional(),
        dependencies: z.record(z.string(), z.string()).optional(),
    })
    .passthrough();

export interface AutoUpdateCheckerOptions {
    enabled?: boolean;
    showStartupToast?: boolean;
    autoUpdate?: boolean;
    npmRegistryUrl?: string;
    fetchTimeoutMs?: number;
    signal?: AbortSignal;
}

export interface PluginEntryInfo {
    entry: string;
    isPinned: boolean;
    pinnedVersion: string | null;
    configPath: string;
}

export type NpmPackageEnvelope = z.infer<typeof NpmPackageEnvelopeSchema>;
export type KiloConfig = z.infer<typeof KiloConfigSchema>;
export type PackageJson = z.infer<typeof PackageJsonSchema>;
