// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./dropdown-menu";

describe("DropdownMenu", () => {
  it("opens on trigger click", async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>
          <button>Open Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.queryByTestId("dropdown-content")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Open Menu"));

    await waitFor(() => {
      expect(screen.getByTestId("dropdown-content")).toBeInTheDocument();
    });
  });

  it("closes on backdrop click", async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>
          <button>Open Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    fireEvent.click(screen.getByText("Open Menu"));

    await waitFor(() => {
      expect(screen.getByTestId("dropdown-backdrop")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("dropdown-backdrop"));

    await waitFor(() => {
      expect(screen.queryByTestId("dropdown-content")).not.toBeInTheDocument();
    });
  });

  it("closes on item click", async () => {
    const handleClick = vi.fn();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>
          <button>Open Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleClick}>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    fireEvent.click(screen.getByText("Open Menu"));

    await waitFor(() => {
      expect(screen.getByText("Item 1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Item 1"));

    expect(handleClick).toHaveBeenCalledOnce();

    await waitFor(() => {
      expect(screen.queryByTestId("dropdown-content")).not.toBeInTheDocument();
    });
  });

  it("closes on Escape key", async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>
          <button>Open Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    fireEvent.click(screen.getByText("Open Menu"));

    await waitFor(() => {
      expect(screen.getByTestId("dropdown-content")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("dropdown-content")).not.toBeInTheDocument();
    });
  });

  it("supports controlled mode", async () => {
    const handleOpenChange = vi.fn();

    const { rerender } = render(
      <DropdownMenu open={false} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger>
          <button>Open Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.queryByTestId("dropdown-content")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Open Menu"));
    expect(handleOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <DropdownMenu open={true} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger>
          <button>Open Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("dropdown-content")).toBeInTheDocument();
    });
  });

  it("renders separator", async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>
          <button>Open Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Item 2</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    fireEvent.click(screen.getByText("Open Menu"));

    await waitFor(() => {
      expect(screen.getByTestId("dropdown-separator")).toBeInTheDocument();
    });
  });

  it("supports asChild on trigger", async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button data-testid="custom-trigger">Custom Trigger</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    fireEvent.click(screen.getByTestId("custom-trigger"));

    await waitFor(() => {
      expect(screen.getByTestId("dropdown-content")).toBeInTheDocument();
    });
  });

  it("supports disabled menu items", async () => {
    const handleClick = vi.fn();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>
          <button>Open Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleClick} disabled>
            Disabled Item
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    fireEvent.click(screen.getByText("Open Menu"));

    await waitFor(() => {
      expect(screen.getByText("Disabled Item")).toBeInTheDocument();
    });

    const disabledItem = screen.getByText("Disabled Item");
    expect(disabledItem).toBeDisabled();

    fireEvent.click(disabledItem);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("applies custom className", async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>
          <button>Open Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="custom-content">
          <DropdownMenuItem className="custom-item">Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    fireEvent.click(screen.getByText("Open Menu"));

    await waitFor(() => {
      expect(screen.getByTestId("dropdown-content")).toHaveClass(
        "custom-content",
      );
      expect(screen.getByText("Item 1")).toHaveClass("custom-item");
    });
  });

  it("throws error when dropdown components used outside DropdownMenu", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => {
      render(
        <DropdownMenuTrigger>
          <button>Test</button>
        </DropdownMenuTrigger>,
      );
    }).toThrow("Dropdown components must be used within <DropdownMenu>");

    consoleError.mockRestore();
  });
});
