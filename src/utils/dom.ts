/**
 * DOM helpers for the boot-time UI: the loading overlay, progress bar,
 * diagnostics HUD and error panel created in `index.html`.
 */

export interface LoadingUi {
  /** Sets the progress bar (0–100) and updates the percentage label. */
  readonly setProgress: (percent: number) => void;
  /** Sets the human-readable status line (e.g. the file being loaded). */
  readonly setStatus: (text: string) => void;
  /** Fades the overlay out and removes it from the interaction flow. */
  readonly hide: () => void;
  /** Re-shows the overlay (used when a fatal error occurs after boot). */
  readonly show: () => void;
  /** Surfaces a fatal error to the user without hiding the console detail. */
  readonly showError: (message: string) => void;
  /** Writes a one-line diagnostic string to the bottom-left HUD. */
  readonly setDiagnostics: (text: string) => void;
  /** Shows / hides the diagnostics HUD. */
  readonly setDiagnosticsVisible: (visible: boolean) => void;
}

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * Wires the loading UI. Every element is optional: if the markup is missing
 * (e.g. a headless test harness), all methods degrade to no-ops instead of
 * throwing, so the renderer can still boot.
 */
export function createLoadingUi(root: ParentNode = document): LoadingUi {
  const overlay = root.querySelector<HTMLElement>('#loading-overlay');
  const progressBar = root.querySelector<HTMLElement>('#loading-progress-bar');
  const statusEl = root.querySelector<HTMLElement>('#loading-status');
  const errorPanel = root.querySelector<HTMLElement>('#error-panel');
  const hud = root.querySelector<HTMLElement>('#hud');

  return {
    setProgress(percent: number): void {
      const value = clampPercent(percent);
      if (progressBar) progressBar.style.width = `${value.toFixed(1)}%`;
    },
    setStatus(text: string): void {
      if (statusEl) statusEl.textContent = text;
    },
    hide(): void {
      if (!overlay) return;
      overlay.dataset.hidden = 'true';
    },
    show(): void {
      if (!overlay) return;
      overlay.dataset.hidden = 'false';
    },
    showError(message: string): void {
      if (!errorPanel) return;
      errorPanel.textContent = message;
      errorPanel.dataset.visible = 'true';
    },
    setDiagnostics(text: string): void {
      if (!hud) return;
      hud.textContent = text;
    },
    setDiagnosticsVisible(visible: boolean): void {
      if (!hud) return;
      hud.hidden = !visible;
    },
  };
}

/** Traverses up from a node to the closest ancestor matching a selector. */
export function closestOrSelf<T extends Element>(
  node: EventTarget | null,
  selector: string,
): T | null {
  if (!(node instanceof Element)) return null;
  const match = node.closest(selector);
  return match instanceof Element ? (match as T) : null;
}