interface BadgeProps {
  variant?: "green" | "red" | "amber" | "blue" | "muted";
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = "muted", children, className = "" }: BadgeProps) {
  const variants = {
    green: "bg-[var(--green-dim)] border border-[var(--green-border)] text-[var(--green)]",
    red: "bg-red-500/10 border border-red-500/20 text-[var(--red)]",
    amber: "bg-amber-500/10 border border-amber-500/20 text-[var(--amber)]",
    blue: "bg-blue-500/10 border border-blue-500/20 text-[var(--blue)]",
    muted: "bg-[var(--surface-3)] border border-[var(--border)] text-[var(--text-3)]",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
