/**
 * App mark: loads `/icon.svg` (same file as the favicon).
 * Colors and shapes are defined in `src/app/icon.svg`, not here.
 */
export function BrandMark({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    // Static SVG mark — next/image doesn't optimize SVGs, so a plain <img> is intentional.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icon.svg"
      alt=""
      width={size}
      height={size}
      className={`object-contain shrink-0 rounded-lg ${className}`}
      decoding="async"
    />
  );
}
