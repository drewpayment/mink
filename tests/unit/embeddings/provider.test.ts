import { describe, expect, test, afterEach } from "bun:test";
import {
  NeuralEmbeddingProvider,
  _setTestEmbeddingProvider,
  isEmbeddingsEnabled,
  resolveEmbeddingProvider,
  type EmbeddingProvider,
} from "../../../src/core/embeddings/provider";

afterEach(() => {
  _setTestEmbeddingProvider(undefined);
  delete process.env.MINK_EMBEDDINGS_ENABLED;
  delete process.env.MINK_EMBEDDINGS_MODEL;
});

describe("resolveEmbeddingProvider", () => {
  test("returns null when the feature is disabled (default)", () => {
    expect(isEmbeddingsEnabled()).toBe(false);
    expect(resolveEmbeddingProvider()).toBeNull();
  });

  test("returns a neural provider carrying the configured model when enabled", () => {
    process.env.MINK_EMBEDDINGS_ENABLED = "true";
    process.env.MINK_EMBEDDINGS_MODEL = "Xenova/all-MiniLM-L6-v2";
    const p = resolveEmbeddingProvider();
    expect(p).toBeInstanceOf(NeuralEmbeddingProvider);
    expect(p!.id).toBe("Xenova/all-MiniLM-L6-v2");
  });

  test("an injected test provider overrides resolution", () => {
    const fake: EmbeddingProvider = {
      id: "fake",
      async embed(texts) {
        return texts.map(() => Float32Array.from([1, 0]));
      },
    };
    _setTestEmbeddingProvider(fake);
    expect(resolveEmbeddingProvider()).toBe(fake);
  });

  test("an injected null forces 'no provider' even if enabled", () => {
    process.env.MINK_EMBEDDINGS_ENABLED = "true";
    _setTestEmbeddingProvider(null);
    expect(resolveEmbeddingProvider()).toBeNull();
  });
});

describe("NeuralEmbeddingProvider", () => {
  test("embed([]) short-circuits to [] without loading the model", async () => {
    const p = new NeuralEmbeddingProvider("whatever");
    expect(await p.embed([])).toEqual([]);
  });
});
