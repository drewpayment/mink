"use client";

import { useState, useMemo } from "react";

export function useDebouncedSearch<T>(
  items: T[],
  searchFields: (item: T) => string[],
  delay: number = 200
) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const lower = query.toLowerCase();
    return items.filter((item) =>
      searchFields(item).some((field) => field.toLowerCase().includes(lower))
    );
  }, [items, query, searchFields, delay]);

  return { query, setQuery, filtered };
}
