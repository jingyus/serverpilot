// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

describe("Tabs", () => {
  it("renders all tabs", () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          <TabsTrigger value="tab3">Tab 3</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
        <TabsContent value="tab3">Content 3</TabsContent>
      </Tabs>,
    );

    expect(screen.getByTestId("tab-trigger-tab1")).toBeInTheDocument();
    expect(screen.getByTestId("tab-trigger-tab2")).toBeInTheDocument();
    expect(screen.getByTestId("tab-trigger-tab3")).toBeInTheDocument();
  });

  it("shows default tab content", () => {
    render(
      <Tabs defaultValue="tab2">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("Content 2")).toBeInTheDocument();
    expect(screen.queryByText("Content 1")).not.toBeInTheDocument();
  });

  it("switches tab on click", () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("Content 1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tab-trigger-tab2"));

    expect(screen.getByText("Content 2")).toBeInTheDocument();
    expect(screen.queryByText("Content 1")).not.toBeInTheDocument();
  });

  it("shows only active content", () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          <TabsTrigger value="tab3">Tab 3</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
        <TabsContent value="tab3">Content 3</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("Content 1")).toBeInTheDocument();
    expect(screen.queryByText("Content 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Content 3")).not.toBeInTheDocument();
  });

  it("supports controlled mode", () => {
    const handleChange = vi.fn();
    const { rerender } = render(
      <Tabs value="tab1" onValueChange={handleChange}>
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("Content 1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tab-trigger-tab2"));
    expect(handleChange).toHaveBeenCalledWith("tab2");

    rerender(
      <Tabs value="tab2" onValueChange={handleChange}>
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("Content 2")).toBeInTheDocument();
    expect(screen.queryByText("Content 1")).not.toBeInTheDocument();
  });

  it("sets active state on trigger", () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>,
    );

    const tab1 = screen.getByTestId("tab-trigger-tab1");
    const tab2 = screen.getByTestId("tab-trigger-tab2");

    expect(tab1).toHaveAttribute("data-state", "active");
    expect(tab2).toHaveAttribute("data-state", "inactive");

    fireEvent.click(tab2);

    expect(tab1).toHaveAttribute("data-state", "inactive");
    expect(tab2).toHaveAttribute("data-state", "active");
  });

  it("supports disabled state", () => {
    const handleChange = vi.fn();

    render(
      <Tabs defaultValue="tab1" onValueChange={handleChange}>
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2" disabled>
            Tab 2
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>,
    );

    const tab2 = screen.getByTestId("tab-trigger-tab2");
    expect(tab2).toBeDisabled();

    fireEvent.click(tab2);
    expect(handleChange).not.toHaveBeenCalled();
  });

  it("throws error when tab components used outside Tabs", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => {
      render(<TabsTrigger value="test">Test</TabsTrigger>);
    }).toThrow("Tabs components must be used within <Tabs>");

    consoleError.mockRestore();
  });

  it("applies custom className", () => {
    render(
      <Tabs defaultValue="tab1" className="custom-tabs">
        <TabsList className="custom-list">
          <TabsTrigger value="tab1" className="custom-trigger">
            Tab 1
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tab1" className="custom-content">
          Content 1
        </TabsContent>
      </Tabs>,
    );

    expect(screen.getByTestId("tabs-root")).toHaveClass("custom-tabs");
    expect(screen.getByTestId("tabs-list")).toHaveClass("custom-list");
    expect(screen.getByTestId("tab-trigger-tab1")).toHaveClass(
      "custom-trigger",
    );
    expect(screen.getByTestId("tab-content-tab1")).toHaveClass(
      "custom-content",
    );
  });
});
