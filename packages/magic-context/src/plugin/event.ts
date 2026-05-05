export function createEventHandler(args: {
    magicContext: {
        event?: (input: { event: import("@kilocode/sdk").Event }) => Promise<void>;
    } | null;
    autoUpdateChecker?:
        | ((input: { event: import("@kilocode/sdk").Event }) => Promise<void>)
        | null;
}): (input: { event: import("@kilocode/sdk").Event }) => Promise<void> {
    return async (input): Promise<void> => {
        await args.autoUpdateChecker?.(input);
        await args.magicContext?.event?.(input);
    };
}
