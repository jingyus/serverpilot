// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './card';

describe('Card', () => {
  it('renders card with all sections', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Content here</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    );

    expect(screen.getByTestId('card')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Content here')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('applies card styles', () => {
    render(<Card data-testid="card">Content</Card>);
    const card = screen.getByTestId('card');
    expect(card).toHaveClass('rounded-lg', 'border', 'shadow-sm');
  });

  it('applies custom className to card', () => {
    render(<Card data-testid="card" className="custom">Content</Card>);
    expect(screen.getByTestId('card')).toHaveClass('custom');
  });

  it('renders title with heading styles', () => {
    render(<CardTitle>My Title</CardTitle>);
    const title = screen.getByText('My Title');
    expect(title.tagName).toBe('H3');
    expect(title).toHaveClass('text-2xl', 'font-semibold');
  });

  it('renders description with muted styles', () => {
    render(<CardDescription>Some description</CardDescription>);
    const desc = screen.getByText('Some description');
    expect(desc).toHaveClass('text-sm', 'text-muted-foreground');
  });
});
