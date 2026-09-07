import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Bead } from '@/types';

import { BeadDetail } from '../bead-detail';

// The panel never talks to the backend in these tests, but both modules are
// imported at module scope — stub them so nothing reaches fetch().
vi.mock('@/lib/api', () => ({
  beads: { update: vi.fn().mockResolvedValue(undefined) },
  git: { prStatus: vi.fn().mockResolvedValue({ pr: null }) },
}));

vi.mock('@/lib/cli', () => ({
  updateTitle: vi.fn().mockResolvedValue(undefined),
  updateDescription: vi.fn().mockResolvedValue(undefined),
  updateStatus: vi.fn().mockResolvedValue(undefined),
}));

const makeBead = (id: string): Bead => ({
  id,
  title: `Bead ${id}`,
  status: 'open',
  priority: 2,
  issue_type: 'task',
  owner: 'tester',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  comments: [],
});

const parent = makeBead('epic-1');
const child = makeBead('task-2');

const onOpenChange = vi.fn();

/** The slide-in panel is the single scroll container — no test id, so match its class. */
function getPanel(container: HTMLElement): HTMLDivElement {
  const panel = container.querySelector<HTMLDivElement>('.overflow-y-auto');
  if (!panel) throw new Error('scroll panel not found');
  return panel;
}

/** Scroll the panel the way a user would: move the offset, then let the event fire. */
function scrollTo(panel: HTMLDivElement, offset: number) {
  panel.scrollTop = offset;
  fireEvent.scroll(panel);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BeadDetail scroll restoration', () => {
  it('starts a never-visited bead at the top', () => {
    const { container, rerender } = render(
      <BeadDetail bead={parent} open onOpenChange={onOpenChange} />
    );
    const panel = getPanel(container);
    scrollTo(panel, 420);

    rerender(<BeadDetail bead={child} open onOpenChange={onOpenChange} />);

    expect(panel.scrollTop).toBe(0);
  });

  it('restores the recorded offset when going back to a previously viewed bead', () => {
    const { container, rerender } = render(
      <BeadDetail bead={parent} open onOpenChange={onOpenChange} />
    );
    const panel = getPanel(container);
    scrollTo(panel, 420);

    // Step into the child and scroll it somewhere else
    rerender(<BeadDetail bead={child} open onOpenChange={onOpenChange} />);
    scrollTo(panel, 120);

    // Step back to the parent
    rerender(<BeadDetail bead={parent} open onOpenChange={onOpenChange} />);

    expect(panel.scrollTop).toBe(420);
  });

  it('starts at the top after the panel is closed and reopened', () => {
    const { container, rerender } = render(
      <BeadDetail bead={parent} open onOpenChange={onOpenChange} />
    );
    const panel = getPanel(container);
    scrollTo(panel, 420);

    rerender(<BeadDetail bead={parent} open={false} onOpenChange={onOpenChange} />);
    rerender(<BeadDetail bead={parent} open onOpenChange={onOpenChange} />);

    expect(panel.scrollTop).toBe(0);
  });

  it('keeps the offset when a refresh re-creates the bead object with the same id', () => {
    const { container, rerender } = render(
      <BeadDetail bead={parent} open onOpenChange={onOpenChange} />
    );
    const panel = getPanel(container);
    scrollTo(panel, 300);

    // The user keeps scrolling. Browsers coalesce scroll events to an animation frame,
    // so the offset can be ahead of the last recorded value when a refresh lands.
    panel.scrollTop = 640;

    // Background refresh: same id, brand-new object. Nothing may be restored here —
    // an effect keyed on the bead object instead of bead.id would yank the user back.
    rerender(
      <BeadDetail bead={{ ...parent, updated_at: '2026-02-02T00:00:00Z' }} open onOpenChange={onOpenChange} />
    );

    expect(panel.scrollTop).toBe(640);
  });
});
