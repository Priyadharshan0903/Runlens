import { initializeTracePackets } from "./trace-motion";

export function initializeHeroTraces(reducedMotion: MediaQueryList) {
  const hero = document.querySelector<HTMLElement>(".hero");
  const intro = hero?.querySelector<HTMLElement>(".hero-intro");
  const title = hero?.querySelector<HTMLElement>("h1");
  const copy = hero?.querySelector<HTMLElement>(".hero-copy");
  const workspace = hero?.querySelector<HTMLElement>(".hero-workspace");
  const stage = hero?.querySelector<HTMLElement>(".hero-traces");
  const svg = stage?.querySelector("svg");
  const paths = stage?.querySelectorAll<SVGPathElement>("[data-flow-path]");
  if (!hero || !intro || !title || !copy || !workspace || !stage || !svg || !paths) return;

  const elements = { hero, intro, title, copy, workspace, stage, svg, paths };
  let refreshPackets: (() => void) | undefined;
  function layout() {
    const { hero, intro, title, copy, workspace, stage, svg, paths } = elements;
    // Layout offsets exclude entrance/parallax transforms, keeping the routes still.
    const width = hero.clientWidth;
    const gutter = intro.offsetLeft;
    const previewTop = workspace.offsetTop;
    const bottom = intro.offsetTop + intro.offsetHeight + (width <= 700 ? 20 : 30);
    const rail = Math.min(28, intro.offsetTop - 20);
    const left = gutter / 2;
    const right = width - left;
    const height = previewTop + 48;
    const gap = (title.offsetLeft + title.offsetWidth + copy.offsetLeft) / 2;
    const destination = width * 0.68;

    stage.style.height = `${height}px`;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    paths[0].setAttribute(
      "d",
      width <= 700
        ? `M-20 ${rail}H${width + 20}`
        : `M-20 ${rail}H${gap - 18}Q${gap} ${rail} ${gap} ${rail + 18}V${bottom - 18}Q${gap} ${bottom} ${gap + 18} ${bottom}H${destination - 18}Q${destination} ${bottom} ${destination} ${bottom + 18}V${height}`,
    );
    paths[1].setAttribute(
      "d",
      `M${width + 20} ${rail + 12}H${right + 14}Q${right} ${rail + 12} ${right} ${rail + 26}V${previewTop + 10}Q${right} ${previewTop + 28} ${right - 18} ${previewTop + 28}H${width - gutter - 44}`,
    );
    paths[2].setAttribute(
      "d",
      `M-20 ${bottom}H${left - 14}Q${left} ${bottom} ${left} ${bottom + 14}V${previewTop + 14}Q${left} ${previewTop + 32} ${left + 18} ${previewTop + 32}H${gutter + 44}`,
    );
    stage.hidden = false;
    refreshPackets?.();
  }

  layout();
  refreshPackets = initializeTracePackets(stage, reducedMotion, {
    duration: 22000,
    stagger: 3600,
    phase: 4400,
    opacity: 0.45,
  });
  const observer = new ResizeObserver(layout);
  [hero, intro, title, copy].forEach((element) => observer.observe(element));
}
