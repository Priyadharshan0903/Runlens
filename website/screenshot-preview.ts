export function initializeScreenshotPreview() {
  const dialog = document.querySelector<HTMLDialogElement>("#screenshot-preview");
  const image = dialog?.querySelector<HTMLImageElement>("img");
  const title = dialog?.querySelector<HTMLElement>("#screenshot-title");
  const zoom = dialog?.querySelector<HTMLButtonElement>("[data-screenshot-zoom]");
  if (!dialog || !image || !title || !zoom || typeof dialog.showModal !== "function") return;

  const resetZoom = () => {
    dialog.removeAttribute("data-zoomed");
    zoom.setAttribute("aria-pressed", "false");
    zoom.textContent = "Zoom in";
  };

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>("[data-screenshot]");
    const thumbnail = link?.querySelector("img");
    if (!link || !thumbnail) return;
    // Keep modified clicks and the plain image link useful without the dialog.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    image.src = link.href;
    image.alt = thumbnail.alt;
    title.textContent =
      "Runlens · " + (thumbnail.id === "hero-screenshot" ? "Session timeline" : "Product preview");
    resetZoom();
    dialog.showModal();
    event.preventDefault();
  });

  zoom.addEventListener("click", () => {
    const zoomed = dialog.toggleAttribute("data-zoomed");
    zoom.setAttribute("aria-pressed", String(zoomed));
    zoom.textContent = zoomed ? "Fit to window" : "Zoom in";
  });
  dialog.querySelector("[data-screenshot-close]")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dialog.close();
  });
  dialog.addEventListener("close", resetZoom);
}
