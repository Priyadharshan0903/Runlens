export function BrandMark({ size = 25 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      class="brand-mark"
    >
      <path d="M5 5h7a8 8 0 1 1 0 16H5V5Z" stroke="currentColor" stroke-width="2.2" />
      <path
        d="M5 13h9m-4-4 4 4-4 4m10 3 5 5"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
