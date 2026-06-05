import { createInterface } from "readline";

/**
 * Whether the current process can safely prompt the user. We require a real
 * interactive TTY on both stdin and stdout and honor the usual escape hatches
 * (CI, an explicit opt-out) so `mink init` never blocks a script or pipeline.
 */
export function stdinIsInteractive(): boolean {
  const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
  const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean };
  return (
    Boolean(stdin.isTTY) &&
    Boolean(stdout.isTTY) &&
    process.env.MINK_NO_PROMPT !== "1" &&
    !process.env.CI
  );
}

export function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
