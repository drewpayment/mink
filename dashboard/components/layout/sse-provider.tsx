"use client";

import { useSSE } from "@/hooks/use-sse";

export function SSEProvider() {
  useSSE();
  return null;
}
