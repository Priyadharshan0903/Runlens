import agentMark from "../assets/runlens.svg";

export function BrandMark({ size = 25 }: { size?: number }) {
  return (
    <img
      src={`data:image/svg+xml;base64,${agentMark}`}
      width={size}
      height={size}
      alt=""
      class="brand-mark"
    />
  );
}
