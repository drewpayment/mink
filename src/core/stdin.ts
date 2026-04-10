export async function readStdinJson(): Promise<unknown | null> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}
