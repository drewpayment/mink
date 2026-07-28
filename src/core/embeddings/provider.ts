// Embedding provider abstraction for semantic retrieval (spec 25).
//
// A provider turns text into vectors. The default production provider is neural
// (@huggingface/transformers, an OPTIONAL dependency) loaded lazily on first
// use, with the model cached under ~/.mink/models. It is optional in every
// sense: the feature is off by default, and if the dependency is absent or the
// model cannot load, embed() throws EmbeddingsUnavailableError and every caller
// falls back to the existing FTS5 path — no regression.
//
// resolveEmbeddingProvider() is the single entry point. Tests inject a
// deterministic provider via _setTestEmbeddingProvider so the vector store,
// hybrid ranking, and cross-project logic are all verifiable without the model
// or a network.

import { join } from "node:path";
import { minkRoot } from "../paths";
import { resolveConfigValue } from "../global-config";

export interface EmbeddingProvider {
  /** Stable identifier (the model name), stored alongside each vector. */
  readonly id: string;
  /** Embed a batch of texts into L2-normalized vectors, one per input. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** The provider could not produce embeddings; callers must fall back to FTS5. */
export class EmbeddingsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingsUnavailableError";
  }
}

/**
 * Neural provider backed by @huggingface/transformers. The dependency is
 * imported through a non-literal specifier so the build does not bundle it and
 * the type-checker does not require it to be installed; a missing dependency
 * surfaces as EmbeddingsUnavailableError at call time.
 */
export class NeuralEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;

  constructor(model: string) {
    this.id = model;
  }

  private async ensurePipeline(): Promise<void> {
    if (this.pipe) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let transformers: any;
    try {
      const spec = "@huggingface/transformers";
      transformers = await import(/* @vite-ignore */ spec);
    } catch {
      throw new EmbeddingsUnavailableError(
        "@huggingface/transformers is not installed; install it to enable semantic retrieval"
      );
    }
    try {
      // Cache downloaded models under the Mink root so they sync/back up with
      // the rest of Mink's state and never touch the project repo.
      transformers.env.cacheDir = join(minkRoot(), "models");
      transformers.env.allowLocalModels = true;
      this.pipe = await transformers.pipeline("feature-extraction", this.id);
    } catch (err) {
      throw new EmbeddingsUnavailableError(
        `failed to load embedding model "${this.id}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    await this.ensurePipeline();
    const out: Float32Array[] = [];
    // Mean-pooled, normalized sentence embeddings — the standard recipe for
    // all-MiniLM-style models.
    const tensor = await this.pipe(texts, { pooling: "mean", normalize: true });
    const dims = tensor.dims as number[];
    const rows = dims[0];
    const cols = dims[dims.length - 1];
    const data = tensor.data as Float32Array;
    for (let r = 0; r < rows; r++) {
      out.push(new Float32Array(data.subarray(r * cols, r * cols + cols)));
    }
    return out;
  }
}

// Test seam: `undefined` means "resolve normally"; `null` means "explicitly no
// provider"; a provider instance overrides resolution.
let testProvider: EmbeddingProvider | null | undefined = undefined;

export function _setTestEmbeddingProvider(p: EmbeddingProvider | null | undefined): void {
  testProvider = p;
}

/** Is the semantic-retrieval feature turned on? (Independent of availability.) */
export function isEmbeddingsEnabled(): boolean {
  return resolveConfigValue("embeddings.enabled").value === "true";
}

/** Whether the optional model runtime is importable (does not load a model). */
export async function isEmbeddingLibraryInstalled(): Promise<boolean> {
  try {
    const spec = "@huggingface/transformers";
    await import(/* @vite-ignore */ spec);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the active provider, or null when the feature is disabled. A non-null
 * provider is not a guarantee the model will load — embed() may still throw
 * EmbeddingsUnavailableError, which callers treat as "fall back to FTS5".
 */
export function resolveEmbeddingProvider(): EmbeddingProvider | null {
  if (testProvider !== undefined) return testProvider;
  if (!isEmbeddingsEnabled()) return null;
  const model = resolveConfigValue("embeddings.model").value;
  return new NeuralEmbeddingProvider(model);
}
