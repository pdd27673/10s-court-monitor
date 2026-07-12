import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", children, ...props }, ref) => {
    const base =
      "inline-flex items-center justify-center font-medium rounded-lg cursor-pointer transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none";

    const variants = {
      primary:
        "bg-[var(--green)] text-black hover:bg-green-400 shadow-[0_0_0_1px_var(--green-border)] hover:shadow-[0_0_8px_rgba(34,197,94,0.35)]",
      ghost:
        "bg-transparent border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--text-3)] hover:text-[var(--text)]",
      danger:
        "bg-transparent border border-[var(--red)]/30 text-[var(--red)] hover:bg-[var(--red)]/10",
    };

    const sizes = {
      sm: "px-3 py-1.5 text-xs gap-1.5",
      md: "px-4 py-2 text-sm gap-2",
      lg: "px-6 py-3 text-base gap-2",
    };

    return (
      <button
        ref={ref}
        className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
