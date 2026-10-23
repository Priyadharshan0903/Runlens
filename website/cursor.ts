import agentMark from "../ui/assets/runlens.svg";

type CursorMode = "default" | "action" | "preview";

export function initializeCursor() {
  const enabled = window.matchMedia(
    "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) and (forced-colors: none)",
  );
  const cursor = document.createElement("div");
  cursor.className = "site-cursor";
  cursor.setAttribute("aria-hidden", "true");
  cursor.hidden = true;

  // Reuse the real logo; remove its document-wide styles before placing it inline.
  const logo = new DOMParser().parseFromString(atob(agentMark), "image/svg+xml").documentElement;
  logo.querySelector("style")?.remove();
  logo.setAttribute("class", "site-cursor-agent");
  logo.setAttribute("focusable", "false");
  const eyes = logo.querySelectorAll("rect");

  // The antenna's center is the exact click point, independent of the head below it.
  const hotspot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  hotspot.setAttribute("class", "site-cursor-hotspot");
  hotspot.setAttribute("cx", "16");
  hotspot.setAttribute("cy", "5");
  hotspot.setAttribute("r", "1");
  logo.append(hotspot);
  cursor.append(logo);
  document.body.append(cursor);

  let pointer: { x: number; y: number } | null = null;
  let pendingFrame = 0;

  function hideCursor() {
    window.cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
    cursor.hidden = true;
    cursor.removeAttribute("data-pressed");
    document.documentElement.classList.remove("has-custom-cursor");
  }

  function getMode(target: Element): CursorMode | null {
    // Leave form controls, selection, and the modal top layer to the browser.
    if (
      document.querySelector("dialog[open]") ||
      target.closest(
        "input, textarea, select, :disabled, [contenteditable]:not([contenteditable='false'])",
      )
    )
      return null;

    const control = target.closest("a[href], button:enabled, summary");
    if (control) return control.matches("[data-screenshot]") ? "preview" : "action";
    if (target.closest("h1, h2, h3, p, li, dt, dd, figcaption, pre, code, blockquote")) return null;
    return "default";
  }

  function renderCursor() {
    pendingFrame = 0;
    if (!enabled.matches || !pointer || document.hidden) {
      hideCursor();
      return;
    }

    const { x, y } = pointer;
    const viewport = document.documentElement;
    // Preserve scrollbar controls instead of hiding the pointer at the viewport edge.
    const target =
      x >= 0 && y >= 0 && x < viewport.clientWidth && y < viewport.clientHeight
        ? document.elementFromPoint(x, y)
        : null;
    const mode = target ? getMode(target) : null;
    if (!mode) {
      hideCursor();
      return;
    }

    cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (cursor.dataset.mode !== mode) {
      cursor.dataset.mode = mode;
      eyes.forEach((eye) => eye.setAttribute("rx", mode === "preview" ? "2.5" : "1.4"));
    }
    cursor.hidden = false;
    viewport.classList.add("has-custom-cursor");
  }

  function scheduleRender() {
    if (!pendingFrame && pointer && enabled.matches)
      pendingFrame = window.requestAnimationFrame(renderCursor);
  }

  function resetPointer() {
    pointer = null;
    hideCursor();
  }

  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType !== "mouse" || !enabled.matches) {
        resetPointer();
        return;
      }
      pointer = { x: event.clientX, y: event.clientY };
      scheduleRender();
    },
    { passive: true },
  );
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse") {
      resetPointer();
      return;
    }
    if (event.button === 0 && !cursor.hidden) cursor.setAttribute("data-pressed", "");
  });
  document.addEventListener("pointerup", () => cursor.removeAttribute("data-pressed"));
  document.addEventListener("pointercancel", resetPointer);
  document.documentElement.addEventListener("pointerleave", resetPointer);
  document.addEventListener("dragstart", resetPointer);
  document.addEventListener("keydown", resetPointer);
  window.addEventListener("blur", resetPointer);
  document.addEventListener("visibilitychange", resetPointer);

  // Scroll and disclosure/dialog changes can move a new target under a stationary mouse.
  document.addEventListener("scroll", scheduleRender, { capture: true, passive: true });
  document.addEventListener("click", scheduleRender);
  document.addEventListener("toggle", scheduleRender, true);
  document.addEventListener("close", scheduleRender, true);
  window.addEventListener("resize", scheduleRender, { passive: true });
  enabled.addEventListener("change", resetPointer);
}
