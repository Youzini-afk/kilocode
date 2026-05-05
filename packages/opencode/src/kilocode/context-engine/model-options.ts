export namespace ContextEngineModelOptions {
  export type Model = { id?: string; name?: string }
  export type Provider = { id: string; name: string; models: Record<string, Model> }
  export type Option = { value: string; label: string; provider: string; model: string }

  export function fromProviders(providers: Record<string, Provider>): Option[] {
    return Object.values(providers)
      .flatMap((provider) =>
        Object.entries(provider.models).map(([key, model]) => {
          const id = model.id || key
          return {
            value: `${provider.id}/${id}`,
            label: `${provider.name} · ${model.name || id}`,
            provider: provider.id,
            model: id,
          }
        }),
      )
      .sort((a, b) => a.label.localeCompare(b.label))
  }
}
