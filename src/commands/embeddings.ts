// `mink embeddings` — manage semantic retrieval (spec 25). Turn the feature on
// or off, check status, and backfill vectors for existing bugs. The neural
// model runtime is an optional, user-installed dependency; when it is absent or
// the feature is off, recall falls back to FTS5 with no change in behavior.

import { resolveConfigValue, setConfigValue } from "../core/global-config";
import {
  EmbeddingsUnavailableError,
  isEmbeddingLibraryInstalled,
  isEmbeddingsEnabled,
  resolveEmbeddingProvider,
} from "../core/embeddings/provider";
import { embedBugs } from "../core/embeddings/recall";
import { EmbeddingRepo } from "../repositories/embedding-repo";

const USAGE = `mink embeddings — manage semantic retrieval (spec 25)

Usage:
  mink embeddings status      Show whether semantic retrieval is enabled and available
  mink embeddings enable      Turn on semantic retrieval (embeddings.enabled=true)
  mink embeddings disable     Turn off semantic retrieval
  mink embeddings backfill    Embed this project's bugs that lack a current vector

Semantic retrieval augments the existing keyword (FTS5) search with local neural
embeddings so bugs are recalled by meaning. It is optional — install the model
runtime with:  bun add -g @huggingface/transformers  (or npm i -g). The model
downloads to ~/.mink/models on first use. When disabled or unavailable, recall
falls back to FTS5 unchanged.`;

export async function embeddings(cwd: string, args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "status": {
      const enabled = isEmbeddingsEnabled();
      const model = resolveConfigValue("embeddings.model").value;
      const crossProject = resolveConfigValue("embeddings.cross-project").value === "true";
      const libInstalled = await isEmbeddingLibraryInstalled();
      let indexed = 0;
      try {
        indexed = EmbeddingRepo.for(cwd).countForModel("bug", model);
      } catch {
        indexed = 0;
      }
      console.log("Semantic retrieval (spec 25)");
      console.log(`  enabled:        ${enabled}`);
      console.log(`  model:          ${model}`);
      console.log(`  cross-project:  ${crossProject}`);
      console.log(
        `  library:        ${libInstalled ? "installed" : "not installed  (bun add -g @huggingface/transformers)"}`
      );
      console.log(`  indexed bugs:   ${indexed}`);
      if (enabled && !libInstalled) {
        console.log(
          "\n  Note: enabled but the model runtime is not installed — recall is using FTS5."
        );
      }
      break;
    }

    case "enable": {
      setConfigValue("embeddings.enabled", "true");
      console.log("Semantic retrieval enabled. Run `mink embeddings backfill` to index existing bugs.");
      const libInstalled = await isEmbeddingLibraryInstalled();
      if (!libInstalled) {
        console.log("Install the model runtime: bun add -g @huggingface/transformers");
      }
      break;
    }

    case "disable": {
      setConfigValue("embeddings.enabled", "false");
      console.log("Semantic retrieval disabled. Recall falls back to FTS5.");
      break;
    }

    case "backfill": {
      const provider = resolveEmbeddingProvider();
      if (!provider) {
        console.error("[mink] semantic retrieval is disabled. Run: mink embeddings enable");
        process.exit(1);
      }
      try {
        const n = await embedBugs(cwd, provider);
        console.log(n > 0 ? `Embedded ${n} bug(s).` : "Nothing to embed — all bugs are current.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof EmbeddingsUnavailableError) {
          console.error(`[mink] embeddings unavailable: ${msg}`);
          console.error("Install the model runtime: bun add -g @huggingface/transformers");
        } else {
          console.error(`[mink] backfill failed: ${msg}`);
        }
        process.exit(1);
      }
      break;
    }

    default:
      process.stdout.write(USAGE + "\n");
  }
}
