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
}
.lm-page *, .lm-page *::before, .lm-page *::after { box-sizing: border-box; }
.lm-content { max-width: 960px; margin: 0 auto; padding: 0 clamp(24px, 4vw, 48px) 64px; }
.lm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 28px 0 16px; }
.lm-head h1 { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
.lm-sub { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
[data-platform='darwin'] .lm-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
.lm-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.lm-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 15px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  white-space: nowrap;
  cursor: pointer;
}
.lm-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.lm-button:disabled { opacity: 0.5; cursor: default; }
.lm-accent { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); background: transparent; }
.lm-accent:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); }
.lm-danger { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); background: transparent; }
.lm-link {
  appearance: none;
  border: 0;
  padding: 2px 6px;
  margin: -2px -6px;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
}
.lm-link:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.lm-link:disabled { opacity: 0.5; cursor: default; }
.lm-linkDanger { color: var(--dsw-alias-state-error-primary); }
.lm-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 16px;
  padding: 12px 14px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.lm-bannerTitle { color: var(--dsw-alias-state-warn-primary); font-weight: 500; }
.lm-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 1px; margin: 0 0 6px; font-size: 13px; line-height: 20px; }
.lm-crumb {
  appearance: none;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 5px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  cursor: pointer;
}
.lm-crumb:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.lm-crumb[aria-current='page'] { color: var(--dsw-alias-label-primary); font-weight: 500; }
.lm-sep { color: var(--dsw-alias-label-secondary); opacity: 0.6; }
.lm-summary { margin: 0 0 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 20px; }
.lm-folders { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
.lm-folder {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 320px;
  padding: 6px 10px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.lm-folder:hover { background: var(--dsw-alias-bg-layer-2); }
.lm-folderName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lm-folderCount { flex: none; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.lm-tabs { display: flex; align-items: center; gap: 24px; border-bottom: 0.5px solid var(--dsw-alias-border-l1); }
.lm-tab {
  appearance: none;
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 0 12px;
  border: 0;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
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
.lm-count { padding: 0 6px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 400; }
.lm-tabSpacer { flex: 1; }
.lm-panel { padding: 16px 0 0; }
.lm-compose { display: flex; flex-direction: column; gap: 10px; margin: 0 0 18px; padding: 14px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); }
.lm-field { display: flex; flex-direction: column; gap: 5px; }
.lm-fieldLabel { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.lm-select, .lm-input, .lm-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}
.lm-select, .lm-input { height: 34px; padding: 0 8px; }
.lm-textarea { min-height: 84px; resize: vertical; field-sizing: content; }
.lm-select:hover, .lm-input:hover, .lm-textarea:hover { border-color: var(--dsw-alias-border-l2); }
.lm-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.lm-error { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.lm-pageError { margin: 0 0 12px; }
.lm-tabHint { margin: 14px 0 0; }
.lm-note { margin: 12px 0; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.lm-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.lm-entry { padding: 12px 10px; border-radius: 12px; }
.lm-entry:hover { background: var(--dsw-alias-bg-layer-1); }
.lm-entryTop { display: flex; align-items: center; gap: 10px; min-width: 0; }
.lm-scope {
  appearance: none;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.lm-scope:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.lm-meta { flex: none; margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.lm-text { margin: 6px 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 22px; }
.lm-editor { display: flex; flex-direction: column; gap: 10px; margin: 8px 0 4px; }
.lm-editor .lm-actions { justify-content: flex-start; }
.lm-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0 2px; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-state-error-primary); border-radius: 12px; }
.lm-confirm p { margin: 0; font-size: 13px; line-height: 20px; }
.lm-confirm span { color: var(--dsw-alias-label-secondary); }
.lm-empty { padding: 40px 20px; text-align: center; color: var(--dsw-alias-label-secondary); }
.lm-emptyTitle { margin: 0 0 8px; color: var(--dsw-alias-label-primary); font-size: 14px; }
.lm-empty p { margin: 0 auto; max-width: 520px; font-size: 13px; line-height: 21px; }
.lm-page :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
@media (max-width: 720px) {
  .lm-head { flex-direction: column; align-items: stretch; }
  .lm-tabs { gap: 16px; }
  .lm-meta { display: none; }
}
`
