import type { DragEvent as ReactDragEvent } from "react";
import type { DragSpec } from "./object";

/**
 * An object picked up. The pointer carries a small label rather than a picture
 * of the whole row, which at thirty columns wide would cover the drop target.
 */
export function beginDrag(e: ReactDragEvent<HTMLElement>, spec: DragSpec | null): void {
  if (!spec) {
    e.preventDefault();
    return;
  }
  e.dataTransfer.setData(spec.type, spec.data);
  e.dataTransfer.setData("text/plain", spec.label);
  e.dataTransfer.effectAllowed = "copy";
  const ghost = document.createElement("div");
  ghost.textContent = spec.label;
  Object.assign(ghost.style, {
    position: "fixed",
    top: "-200px",
    left: "0",
    padding: "5px 10px",
    borderRadius: "7px",
    font: "500 12.5px \"Schibsted Grotesk Variable\", system-ui, sans-serif",
    background: "var(--card)",
    color: "var(--ink)",
    border: "1px solid var(--hairline)",
    whiteSpace: "nowrap",
  });
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 14, 14);
  requestAnimationFrame(() => ghost.remove());
}
