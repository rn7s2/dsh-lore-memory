/**
 * Styles for the management page. Every colour comes from the theme tokens the
 * Host publishes; the class prefix keeps the sheet from colliding with host CSS.
 */
export const PAGE_CSS = `
.lm-page {
  width: 100%;
  height: 100%;
  overflow: auto;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 1.6;
  scrollbar-gutter: stable;
  --dsh-scrollbar-width: 9px;
  --dsh-scrollbar-thumb-border: 2px;
}
.lm-page *, .lm-page *::before, .lm-page *::after { box-sizing: border-box; }
.lm-page ::selection {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent);
}
.lm-content { max-width: 860px; margin: 0 auto; padding: 0 clamp(20px, 4vw, 40px) 72px; }

/* ---- header ---- */
.lm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 28px 0 18px; }
.lm-heading { min-width: 0; }
.lm-head h1 { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; letter-spacing: -0.01em; }
.lm-sub { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.lm-headActions { display: flex; flex: none; align-items: center; gap: 8px; }
[data-platform='darwin'] .lm-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }

/* ---- buttons ---- */
.lm-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 14px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 15px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease;
}
.lm-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.lm-button:disabled { opacity: 0.45; cursor: default; }
.lm-primary {
  border-color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base);
}
.lm-primary:hover:not(:disabled) { background: var(--dsw-alias-label-primary); opacity: 0.88; }
.lm-danger { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.lm-link {
  appearance: none;
  border: 0;
  padding: 2px 6px;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}
.lm-link:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.lm-link:disabled { opacity: 0.45; cursor: default; }
.lm-linkDanger { color: var(--dsw-alias-state-error-primary); }
.lm-linkDanger:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); }

/* ---- banners ---- */
.lm-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 18px;
  padding: 11px 14px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.lm-bannerTitle { color: var(--dsw-alias-state-warn-primary); font-weight: 500; }

/* ---- breadcrumb ---- */
.lm-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 1px; margin: 0 0 8px; font-size: 13px; line-height: 20px; }
.lm-crumb {
  appearance: none;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 3px 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}
.lm-crumb:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.lm-crumb[aria-current='page'] { color: var(--dsw-alias-label-primary); font-weight: 500; }
.lm-sep { color: var(--dsw-alias-label-secondary); opacity: 0.5; }

/* ---- folder chips ---- */
.lm-folders { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 18px; }
.lm-folder {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 320px;
  height: 30px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.lm-folder:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }
.lm-folder svg { flex: none; color: var(--dsw-alias-label-secondary); }
.lm-folderName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lm-folderCount { flex: none; color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }

/* ---- tabs ---- */
.lm-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-top: 4px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}
.lm-tabs { display: flex; flex: 1; align-items: center; gap: 28px; min-width: 0; }
.lm-search {
  display: flex;
  flex: 0 0 240px;
  align-items: center;
  gap: 6px;
  height: 30px;
  margin-bottom: 9px;
  padding: 0 9px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  color: var(--dsw-alias-label-secondary);
  transition: border-color 120ms ease;
}
.lm-search:focus-within { border-color: var(--dsw-alias-brand-primary); }
.lm-searchInput {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: none;
  background: none;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
}
.lm-searchInput::placeholder { color: var(--dsw-alias-label-secondary); opacity: 1; }
.lm-searchInput::-webkit-search-cancel-button { display: none; }
.lm-searchClear {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-right: -4px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.lm-searchClear:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.lm-tab {
  appearance: none;
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 1px 12px;
  border: 0;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
  transition: color 120ms ease;
}
.lm-tab:hover { color: var(--dsw-alias-label-primary); }
.lm-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); font-weight: 500; }
.lm-tab[aria-selected='true']::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--dsw-alias-brand-primary);
}
.lm-count {
  padding: 0 6px;
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 18px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

/* ---- panel ---- */
.lm-panel { padding: 18px 0 0; }
.lm-tabHint { margin: 12px 0 0; }
.lm-note { margin: 12px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.lm-searchMeta { margin: 10px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.lm-error { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.lm-pageError { margin: 0 0 12px; }
.lm-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }

/* ---- compose and inline editor ---- */
.lm-compose {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 0 20px;
  padding: 16px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
}
.lm-formRow { display: flex; align-items: flex-start; gap: 12px; }
.lm-formRow .lm-field:first-child { flex: 1; min-width: 0; }
.lm-formRow .lm-field + .lm-field { flex: 0 0 160px; }
.lm-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.lm-fieldLabel { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.lm-input, .lm-select, .lm-textarea {
  width: 100%;
  padding: 7px 10px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  caret-color: var(--dsw-alias-brand-primary);
  transition: border-color 120ms ease;
}
.lm-input, .lm-select { height: 34px; padding: 0 10px; }
.lm-textarea { min-height: 92px; resize: vertical; field-sizing: content; }
.lm-input:hover, .lm-select:hover, .lm-textarea:hover { border-color: var(--dsw-alias-border-l2); }
.lm-input:focus-visible, .lm-select:focus-visible, .lm-textarea:focus-visible {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary);
}
.lm-editor { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.lm-formActions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }

/* ---- entries ---- */
.lm-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  overflow: hidden;
}
.lm-entry { padding: 14px 16px; border-top: 0.5px solid var(--dsw-alias-border-l1); transition: background-color 120ms ease; }
.lm-entry:first-child { border-top: 0; }
.lm-entry:hover { background: var(--dsw-alias-bg-layer-1); }
.lm-entryHead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.lm-scope {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
  margin-left: -6px;
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}
.lm-scope:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.lm-scope svg { flex: none; opacity: 0.8; }
.lm-scopePath { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lm-badge {
  flex: none;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}
.lm-entryMeta { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.lm-updated { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.lm-entryActions { display: flex; flex: none; align-items: center; gap: 2px; }
.lm-text { margin: 8px 0 0; max-width: 72ch; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 22px; }
.lm-textClamped { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
.lm-textToggle {
  appearance: none;
  margin: 2px 0 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}
.lm-textToggle:hover { color: var(--dsw-alias-label-primary); }
.lm-inlineConfirm { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.lm-inlineConfirm > span { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.lm-buttonSm { height: 24px; padding: 0 9px; border-radius: 12px; font-size: 12px; line-height: 16px; }

/* ---- empty and loading ---- */
.lm-empty { padding: 56px 20px; text-align: center; color: var(--dsw-alias-label-secondary); }
.lm-emptyTitle { margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
.lm-empty p { margin: 0 auto; max-width: 52ch; font-size: 13px; line-height: 21px; }
.lm-empty .lm-emptyTitle + p { margin-top: 6px; }
.lm-emptyActions { display: flex; justify-content: center; margin-top: 16px; }

/* ---- focus and small screens ---- */
.lm-page :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.lm-page .lm-input:focus-visible, .lm-page .lm-select:focus-visible, .lm-page .lm-textarea:focus-visible { outline: none; }
@media (prefers-reduced-motion: reduce) {
  .lm-page * { transition: none !important; }
}
@media (max-width: 720px) {
  .lm-content { padding: 0 20px 56px; }
  .lm-head { gap: 16px; }
  .lm-updated { display: none; }
  .lm-toolbar { flex-wrap: wrap; align-items: stretch; gap: 10px; }
  .lm-tabs { flex: 1 1 100%; gap: 20px; }
  .lm-search { flex: 1 1 100%; margin-bottom: 10px; }
}
@media (max-width: 540px) {
  .lm-head { flex-direction: column; align-items: stretch; gap: 14px; }
  .lm-headActions { justify-content: flex-end; }
  .lm-formRow { flex-direction: column; }
  .lm-formRow .lm-field + .lm-field { flex: 1 1 auto; width: 100%; }
  .lm-entry { padding: 12px 14px; }
  .lm-entryMeta { justify-content: flex-end; }
}
`
