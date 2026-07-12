import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, className = "", ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label className="text-sm font-medium text-[var(--text-2)]">{label}</label>
        )}
        <input
          ref={ref}
          className={`bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2 focus:outline-none focus:border-[var(--green)] focus:ring-1 focus:ring-[var(--green-border)] placeholder:text-[var(--text-3)] transition-all duration-150 ${className}`}
          {...props}
        />
      </div>
    );
  }
);

Input.displayName = "Input";
