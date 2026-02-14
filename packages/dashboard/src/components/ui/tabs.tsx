// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  selectedTab: string;
  setTab: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within <Tabs>");
  }
  return context;
}

interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  children,
  className,
}: TabsProps) {
  const [selectedTab, setSelectedTab] = useState(value ?? defaultValue ?? "");

  useEffect(() => {
    if (value !== undefined) {
      setSelectedTab(value);
    }
  }, [value]);

  const handleChange = (val: string) => {
    if (value === undefined) {
      setSelectedTab(val);
    }
    onValueChange?.(val);
  };

  return (
    <TabsContext.Provider value={{ selectedTab, setTab: handleChange }}>
      <div className={className} data-testid="tabs-root">
        {children}
      </div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  children: ReactNode;
  className?: string;
}

export function TabsList({ children, className }: TabsListProps) {
  return (
    <div
      className={cn(
        "flex items-center border-b gap-4 overflow-x-auto",
        className,
      )}
      role="tablist"
      data-testid="tabs-list"
    >
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function TabsTrigger({
  value,
  children,
  className,
  disabled = false,
}: TabsTriggerProps) {
  const { selectedTab, setTab } = useTabsContext();
  const isActive = selectedTab === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-controls={`tabpanel-${value}`}
      disabled={disabled}
      data-state={isActive ? "active" : "inactive"}
      data-testid={`tab-trigger-${value}`}
      onClick={() => setTab(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap px-4 py-2",
        "text-sm font-medium transition-colors",
        "border-b-2 border-transparent",
        "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        "data-[state=active]:border-primary data-[state=active]:text-foreground",
        "data-[state=inactive]:text-muted-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const { selectedTab } = useTabsContext();
  const isActive = selectedTab === value;

  if (!isActive) return null;

  return (
    <div
      role="tabpanel"
      id={`tabpanel-${value}`}
      aria-labelledby={`tab-${value}`}
      data-state={isActive ? "active" : "inactive"}
      data-testid={`tab-content-${value}`}
      className={cn("pt-6 pb-4", className)}
    >
      {children}
    </div>
  );
}
