/**
 * Virtual scrolling engine for large lists.
 * Renders only visible rows plus a buffer for performance.
 */
export function jsVirtualScroll(): string {
  return `
// ── Virtual Scroll ──────────────────────────────────────────
function createVirtualScroller(viewportId, spacerId, contentId, rowHeight, renderRow) {
  const viewport = document.getElementById(viewportId);
  const spacer = document.getElementById(spacerId);
  const content = document.getElementById(contentId);

  if (!viewport || !spacer || !content) {
    console.warn('[mink] Virtual scroller: missing DOM elements', viewportId);
    return { setData() {}, refresh() {}, getFilteredCount() { return 0; } };
  }

  let allItems = [];
  let filteredItems = [];
  const buffer = 10; // Extra rows above/below viewport

  function setData(items) {
    allItems = items;
    filteredItems = items;
    render();
  }

  function setFiltered(items) {
    filteredItems = items;
    render();
  }

  function render() {
    const totalHeight = filteredItems.length * rowHeight;
    spacer.style.height = totalHeight + 'px';

    const scrollTop = viewport.scrollTop;
    const viewportHeight = viewport.clientHeight;

    const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
    const endIdx = Math.min(
      filteredItems.length,
      Math.ceil((scrollTop + viewportHeight) / rowHeight) + buffer
    );

    content.style.transform = \`translateY(\${startIdx * rowHeight}px)\`;

    let html = '';
    for (let i = startIdx; i < endIdx; i++) {
      html += renderRow(filteredItems[i], i);
    }
    content.innerHTML = html || '<div class="empty-state">No matching entries</div>';
  }

  function refresh() {
    render();
  }

  function getFilteredCount() {
    return filteredItems.length;
  }

  function getAllItems() {
    return allItems;
  }

  // Throttled scroll handler
  let scrollRaf = null;
  viewport.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      render();
      scrollRaf = null;
    });
  });

  return { setData, setFiltered, refresh, getFilteredCount, getAllItems };
}
`;
}
