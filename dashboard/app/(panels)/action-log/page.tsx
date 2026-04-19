"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ActionLogPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/activity");
  }, [router]);
  return null;
}
