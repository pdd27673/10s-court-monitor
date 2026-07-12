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
