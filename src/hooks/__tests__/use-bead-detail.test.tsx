import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import type { Bead } from '@/types';

import { useBeadDetail } from '../use-bead-detail';

// --- Test data --------------------------------------------------------------
//
// `useBeadDetail` keeps only bead IDs and resolves them against `allBeads` on
// every render, so the beads below are the whole world the hook can see. A
// bead removed from `allBeads` is exactly what a refresh looks like from the
// hook's point of view.

function makeBead(id: string, overrides: Partial<Bead> = {}): Bead {
  return {
    id,
    title: `Task ${id}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    owner: 'tester',
    created_at: '2026-09-07T00:00:00Z',
    updated_at: '2026-09-07T00:00:00Z',
    comments: [],
    ...overrides,
  };
}

const epic = makeBead('bw-1', { issue_type: 'epic', children: ['bw-2', 'bw-3'] });
const child = makeBead('bw-2', { parent_id: 'bw-1' });
const grandChild = makeBead('bw-3', { parent_id: 'bw-1' });
const allBeads = [epic, child, grandChild];

describe('useBeadDetail — navigation history', () => {
  it('does not build history when opening from the board twice', () => {
    const { result } = renderHook(() => useBeadDetail(allBeads));

    act(() => result.current.openBead(epic));
    act(() => result.current.openBead(child));

    expect(result.current.detailBead?.id).toBe('bw-2');
    expect(result.current.isDetailOpen).toBe(true);
    // Board entries reset the stack — the epic is not behind the child.
    expect(result.current.canGoBack).toBe(false);
  });

  it('builds history when navigating deeper from inside the panel', () => {
    const { result } = renderHook(() => useBeadDetail(allBeads));

    act(() => result.current.openBead(epic));
    act(() => result.current.pushBead(child));

    expect(result.current.detailBead?.id).toBe('bw-2');
    expect(result.current.canGoBack).toBe(true);
  });

  it('returns to the parent bead on goBack and keeps the panel open', () => {
    const { result } = renderHook(() => useBeadDetail(allBeads));

    act(() => result.current.openBead(epic));
    act(() => result.current.pushBead(child));
    act(() => result.current.goBack());

    expect(result.current.detailBead?.id).toBe('bw-1');
    expect(result.current.isDetailOpen).toBe(true);
    expect(result.current.canGoBack).toBe(false);
  });

  it('closes the panel when goBack is called at the top level', () => {
    const { result } = renderHook(() => useBeadDetail(allBeads));

    act(() => result.current.openBead(epic));
    act(() => result.current.goBack());

    expect(result.current.isDetailOpen).toBe(false);
    expect(result.current.detailBead).toBeNull();
  });

  it('ignores pushBead when the bead is already on top', () => {
    const { result } = renderHook(() => useBeadDetail(allBeads));

    act(() => result.current.openBead(epic));
    act(() => result.current.pushBead(epic));

    expect(result.current.canGoBack).toBe(false);
    expect(result.current.detailBead?.id).toBe('bw-1');
  });

  it('clears the whole stack on close and does not resurrect it on reopen', () => {
    const { result } = renderHook(() => useBeadDetail(allBeads));

    act(() => result.current.openBead(epic));
    act(() => result.current.pushBead(child));
    // X button / Escape / overlay click — a full close from two levels deep.
    act(() => result.current.handleDetailOpenChange(false));

    expect(result.current.isDetailOpen).toBe(false);
    expect(result.current.detailBead).toBeNull();
    expect(result.current.canGoBack).toBe(false);

    act(() => result.current.openBead(child));

    expect(result.current.detailBead?.id).toBe('bw-2');
    expect(result.current.canGoBack).toBe(false);
  });

  it('resets the stack when navigating by ID', () => {
    const { result } = renderHook(() => useBeadDetail(allBeads));

    act(() => result.current.openBead(epic));
    act(() => result.current.pushBead(child));
    act(() => result.current.navigateToBead('bw-3'));

    expect(result.current.detailBead?.id).toBe('bw-3');
    expect(result.current.canGoBack).toBe(false);
  });

  it('ignores navigateToBead for an unknown ID', () => {
    const { result } = renderHook(() => useBeadDetail(allBeads));

    act(() => result.current.openBead(epic));
    act(() => result.current.navigateToBead('bw-missing'));

    expect(result.current.detailBead?.id).toBe('bw-1');
  });
});

describe('useBeadDetail — pruning after a data refresh', () => {
  it('falls back to the parent when the current bead disappears', () => {
    const { result, rerender } = renderHook(
      ({ beads }) => useBeadDetail(beads),
      { initialProps: { beads: allBeads } }
    );

    act(() => result.current.openBead(epic));
    act(() => result.current.pushBead(child));

    // Refresh drops the child (closed, filtered out, deleted…).
    rerender({ beads: [epic, grandChild] });

    expect(result.current.detailBead?.id).toBe('bw-1');
    expect(result.current.isDetailOpen).toBe(true);
    expect(result.current.canGoBack).toBe(false);
  });

  it('keeps the deepest surviving entry when a middle bead disappears', () => {
    const { result, rerender } = renderHook(
      ({ beads }) => useBeadDetail(beads),
      { initialProps: { beads: allBeads } }
    );

    act(() => result.current.openBead(epic));
    act(() => result.current.pushBead(child));
    act(() => result.current.pushBead(grandChild));

    rerender({ beads: [epic, grandChild] });

    expect(result.current.detailBead?.id).toBe('bw-3');
    expect(result.current.canGoBack).toBe(true);

    // Going back skips the pruned middle entry.
    act(() => result.current.goBack());

    expect(result.current.detailBead?.id).toBe('bw-1');
    expect(result.current.canGoBack).toBe(false);
  });

  it('closes the panel when nothing in the stack survives', () => {
    const { result, rerender } = renderHook(
      ({ beads }) => useBeadDetail(beads),
      { initialProps: { beads: allBeads } }
    );

    act(() => result.current.openBead(epic));
    act(() => result.current.pushBead(child));

    rerender({ beads: [grandChild] });

    expect(result.current.detailBead).toBeNull();
    expect(result.current.isDetailOpen).toBe(false);
    expect(result.current.canGoBack).toBe(false);
  });
});
