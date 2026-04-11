/**
 * Panel 10: Design Evaluation — screenshot gallery with metadata.
 */
export function panelDesign(): string {
  return `
    <section class="panel" id="panel-design">
      <h2 class="panel-title">Design Evaluation</h2>

      <div class="stat-grid" id="design-summary">
        <div class="stat-card">
          <div class="stat-value" id="design-count">—</div>
          <div class="stat-label">Screenshots</div>
        </div>
      </div>

      <div id="design-gallery" style="
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 12px;
      ">
        <div class="empty-state" style="grid-column: 1 / -1;">
          No design screenshots available. Run <code>mink designqc</code> to capture screenshots.
        </div>
      </div>

      <div id="design-lightbox" style="
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.85);
        z-index: 1000;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      ">
        <img id="lightbox-img" style="max-width:90vw; max-height:90vh; border-radius:8px;" />
        <div id="lightbox-meta" style="
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          color: #fff;
          font-size: 0.8rem;
          background: rgba(0,0,0,0.6);
          padding: 6px 14px;
          border-radius: 6px;
        "></div>
      </div>
    </section>`;
}
