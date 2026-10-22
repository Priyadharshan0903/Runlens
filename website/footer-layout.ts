// Align the footer controls to the existing SVG rather than changing its paths.
export function initializeFooterLayout() {
  const footer = document.querySelector<HTMLElement>(".footer");
  const signature = footer?.querySelector<HTMLElement>(".footer-signature");
  const svg = signature?.querySelector("svg");
  const closing = footer?.querySelector<HTMLElement>(".footer-close");
  const arrow = footer?.querySelector<HTMLElement>(".footer-arrow");
  const links = footer?.querySelector<HTMLElement>(".footer-bottom");
  if (!footer || !signature || !svg || !closing || !arrow || !links) return;

  const alignContent = () => {
    if (window.innerWidth <= 1000) {
      footer.style.removeProperty("--footer-arrow-shift");
      footer.style.removeProperty("--footer-links-shift");
      return;
    }
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    // Existing SVG lanes: upper-right y=56; lower-right y=536 and y=588.
    const firstLine = new DOMPoint(1440, 56).matrixTransform(matrix);
    const lowerGap = new DOMPoint(1440, (536 + 588) / 2).matrixTransform(matrix);
    const arrowBase =
      closing.getBoundingClientRect().top + (closing.offsetHeight + arrow.offsetHeight) / 2;
    const linksBase =
      signature.getBoundingClientRect().bottom +
      parseFloat(getComputedStyle(signature).marginBottom) +
      links.offsetHeight / 2;
    footer.style.setProperty("--footer-arrow-shift", `${firstLine.y - arrowBase}px`);
    footer.style.setProperty("--footer-links-shift", `${lowerGap.y - linksBase}px`);
  };

  alignContent();
  const observer = new ResizeObserver(alignContent);
  [signature, closing, links].forEach((element) => observer.observe(element));
}
