import { initializeTracePackets } from "./trace-motion";

export function initializeFooterTraces(reducedMotion: MediaQueryList) {
  const signature = document.querySelector<HTMLElement>(".footer-signature");
  if (signature) initializeTracePackets(signature, reducedMotion);
}
