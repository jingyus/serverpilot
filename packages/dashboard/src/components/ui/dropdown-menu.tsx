// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Alternative dropdown menu API compatible with shadcn/ui pattern
 * This is a wrapper around our simpler dropdown component to support
 * the DropdownMenuTrigger/DropdownMenuContent pattern
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(
  null,
);

function useDropdownMenuContext() {
  const context = useContext(DropdownMenuContext);
  if (!context) {
    throw new Error("DropdownMenu components must be used within DropdownMenu");
  }
  return context;
}

interface DropdownMenuProps {
  children: ReactNode;
}

export function DropdownMenu({ children }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div className="relative">{children}</div>
    </DropdownMenuContext.Provider>
  );
}

interface DropdownMenuTriggerProps {
  children: ReactNode;
  asChild?: boolean;
}

export function DropdownMenuTrigger({
  children,
  asChild,
}: DropdownMenuTriggerProps) {
  const { open, setOpen } = useDropdownMenuContext();

  if (
    asChild &&
    typeof children === "object" &&
    children &&
    "props" in children
  ) {
    const child = children as React.ReactElement;
    return <div onClick={() => setOpen(!open)}>{child}</div>;
  }

  return (
    <div onClick={() => setOpen(!open)} role="button" tabIndex={0}>
      {children}
    </div>
  );
}

interface DropdownMenuContentProps {
  children: ReactNode;
  align?: "left" | "right" | "end";
  className?: string;
}

export function DropdownMenuContent({
  children,
  align = "right",
  className,
}: DropdownMenuContentProps) {
  const { open, setOpen } = useDropdownMenuContext();

  if (!open) return null;

  const alignClass =
    align === "end" || align === "right" ? "right-0" : "left-0";

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      <div
        className={cn(
          "absolute z-50 mt-2 min-w-[12rem] rounded-md border border-border bg-card p-1 shadow-lg",
          alignClass,
          className,
        )}
        data-testid="dropdown-menu-content"
      >
        <div onClick={() => setOpen(false)}>{children}</div>
      </div>
    </>
  );
}

interface DropdownMenuItemProps {
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

export function DropdownMenuItem({
  onClick,
  children,
  className,
}: DropdownMenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm transition-colors text-foreground hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn("my-1 h-px bg-border", className)} />;
}
