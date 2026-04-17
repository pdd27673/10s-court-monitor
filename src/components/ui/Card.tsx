interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  as?: "div" | "section" | "article";
}

export function Card({ children, className = "", hover = false, as: Tag = "div" }: CardProps) {
  return (
    <Tag
      className={`bg-[var(--surface)] border border-[var(--border)] rounded-xl ${hover ? "hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)] transition-all duration-150 cursor-pointer" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}
