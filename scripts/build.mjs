#!/usr/bin/env node
// Build both runtime bundles. Each invocation feeds `bun build` a
// `--define MINK_RUNTIME=...` value that the storage driver dispatcher in
// `src/storage/driver.ts` constant-folds, so the unused branch's
// `require("bun:sqlite")` / `require("node:sqlite")` is never executed at
// runtime — even though both strings are present in the bundle source.
//
// Outputs:
//   dist/cli.bun.js   — #!/usr/bin/env bun  (faster startup, recommended)
//   dist/cli.node.js  — #!/usr/bin/env node (works wherever Node ≥22.5 is)
//
// `package.json:bin` maps the user-visible `mink` command to the Node
// bundle (broadest compat) and `mink-bun` to the Bun bundle.

import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SRC = "src/cli.ts";

const TARGETS = [
  { runtime: "bun",  outfile: "dist/cli.bun.js",  target: "bun",  shebang: "#!/usr/bin/env bun" },
  { runtime: "node", outfile: "dist/cli.node.js", target: "node", shebang: "#!/usr/bin/env node" },
];

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit" });
}

for (const t of TARGETS) {
  mkdirSync(dirname(t.outfile), { recursive: true });
  run("bun", [
    "build", SRC,
    "--outfile", t.outfile,
    "--target", t.target,
    "--format", "esm",
    "--define", `MINK_RUNTIME="${t.runtime}"`,
  ]);

  // `bun build` may emit its own shebang depending on the target. Strip any
  // existing line beginning with `#!` and prepend the canonical one.
  let body = readFileSync(t.outfile, "utf-8");
  body = body.replace(/^#!.*\n/, "");
  writeFileSync(t.outfile, `${t.shebang}\n${body}`);
  chmodSync(t.outfile, 0o755);
  console.log(`built ${t.outfile} (${t.runtime})`);
}
