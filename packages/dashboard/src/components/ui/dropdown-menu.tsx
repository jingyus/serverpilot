// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type ReactElement,
  cloneElement,
  isValidElement,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface DropdownContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement>;
}

const DropdownContext = createContext<DropdownContextValue | undefined>(
  undefined,
);

function useDropdownContext() {
  const context = useContext(DropdownContext);
  if (!context) {
    throw new Error("Dropdown components must be used within <DropdownMenu>");
  }
  return context;
}

interface DropdownMenuProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DropdownMenu({
  children,
  open: controlledOpen,
  onOpenChange,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(controlledOpen ?? false);
  const triggerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (controlledOpen !== undefined) {
      setOpen(controlledOpen);
    }
  }, [controlledOpen]);

  const handleSetOpen = (newOpen: boolean) => {
    if (controlledOpen === undefined) {
      setOpen(newOpen);
    }
    onOpenChange?.(newOpen);
  };

  return (
    <DropdownContext.Provider
      value={{ open, setOpen: handleSetOpen, triggerRef }}
    >
      <div className="relative inline-block" data-testid="dropdown-menu">
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

interface DropdownMenuTriggerProps {
  children: ReactElement;
  asChild?: boolean;
}

export function DropdownMenuTrigger({
  children,
  asChild = false,
}: DropdownMenuTriggerProps) {
  const { setOpen, triggerRef } = useDropdownContext();

  const handleClick = () => {
    setOpen(true);
  };

  if (asChild && isValidElement<Record<string, unknown>>(children)) {
    const childProps = children.props as Record<string, unknown>;
    return cloneElement(children, {
      ...childProps,
      ref: triggerRef,
      onClick: (e: React.MouseEvent) => {
        (childProps.onClick as ((e: React.MouseEvent) => void) | undefined)?.(
          e,
        );
        handleClick();
      },
    } as Record<string, unknown>);
  }

  return (
    <button
      ref={triggerRef as React.RefObject<HTMLButtonElement>}
      type="button"
      onClick={handleClick}
      data-testid="dropdown-trigger"
    >
      {children}
    </button>
  );
}

interface DropdownMenuContentProps {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}

export function DropdownMenuContent({
  children,
  align = "end",
  className,
}: DropdownMenuContentProps) {
  const { open, setOpen, triggerRef } = useDropdownContext();
  const contentRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    right?: number;
  }>({ top: 0, left: 0 });

  useEffect(() => {
    if (open && triggerRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const newPosition: { top: number; left: number; right?: number } = {
        top: triggerRect.bottom + 4,
        left: align === "start" ? triggerRect.left : 0,
      };

      if (align === "end") {
        newPosition.right = window.innerWidth - triggerRect.right;
      } else if (align === "center") {
        newPosition.left = triggerRect.left + triggerRect.width / 2;
      }

      setPosition(newPosition);
    }
  }, [open, align, triggerRef]);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, setOpen]);

  if (!open) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={() => setOpen(false)}
        data-testid="dropdown-backdrop"
      />
      <div
        ref={contentRef}
        className={cn(
          "fixed z-50 min-w-[200px] rounded-md border bg-popover p-1 shadow-md",
          align === "center" && "-translate-x-1/2",
          className,
        )}
        style={{
          top: `${position.top}px`,
          ...(position.right !== undefined
            ? { right: `${position.right}px` }
            : { left: `${position.left}px` }),
        }}
        data-testid="dropdown-content"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

interface DropdownMenuItemProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}

export function DropdownMenuItem({
  children,
  onClick,
  className,
  disabled = false,
}: DropdownMenuItemProps) {
  const { setOpen } = useDropdownContext();

  const handleClick = () => {
    if (disabled) return;
    onClick?.();
    setOpen(false);
  };

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm",
        "hover:bg-accent hover:text-accent-foreground",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        "text-left",
        className,
      )}
      onClick={handleClick}
      disabled={disabled}
      data-testid="dropdown-item"
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator() {
  return (
    <div className="my-1 h-px bg-border" data-testid="dropdown-separator" />
  );
}
