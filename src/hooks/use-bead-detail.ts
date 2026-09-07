"use client";

import { useState, useCallback, useMemo } from "react";

import type { Bead } from "@/types";

export interface UseBeadDetailResult {
  /** The currently selected bead (resolved from allBeads) */
  detailBead: Bead | null;
  /** Whether the detail panel is open */
  isDetailOpen: boolean;
  /** Whether a previous bead is available to go back to */
  canGoBack: boolean;
  /** Open detail for a bead, starting a fresh history (entry from the board) */
  openBead: (bead: Bead) => void;
  /** Navigate deeper from inside the panel, keeping the current bead in history */
  pushBead: (bead: Bead) => void;
  /** Step back one level; closes the panel when already at the top level */
  goBack: () => void;
  /** Handle detail panel open/close */
  handleDetailOpenChange: (open: boolean) => void;
  /** Navigate to a bead by ID (for dependencies, memory panel, etc.) */
  navigateToBead: (beadId: string) => void;
}

/**
 * Manages bead detail panel state: which bead is selected, open/close logic
 * and the navigation history built up by clicking subtasks / related tasks.
 *
 * History is a stack of bead IDs; the top entry is the bead on screen.
 *
 * @param allBeads - All beads array (used to resolve bead by ID)
 */
export function useBeadDetail(allBeads: Bead[]): UseBeadDetailResult {
  const [beadStack, setBeadStack] = useState<string[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  /**
   * Stack entries whose bead still exists in `allBeads`. A refresh can drop a
   * bead (closed, filtered out, deleted); pruning here falls back to the
   * deepest entry that is still around instead of letting the panel silently
   * show nothing. Derived rather than stored so no state is set during render.
   */
  const liveStack = useMemo(() => {
    if (beadStack.length === 0) return beadStack;
    const knownIds = new Set(allBeads.map((b) => b.id));
    return beadStack.filter((id) => knownIds.has(id));
  }, [beadStack, allBeads]);

  const detailBead = useMemo(() => {
    const topId = liveStack[liveStack.length - 1];
    if (!topId) return null;
    return allBeads.find((b) => b.id === topId) || null;
  }, [liveStack, allBeads]);

  // Nothing left to show means the panel is closed, even if it was open before.
  const isDetailOpen = isPanelOpen && liveStack.length > 0;
  const canGoBack = liveStack.length > 1;

  const openBead = useCallback((bead: Bead) => {
    setBeadStack([bead.id]);
    setIsPanelOpen(true);
  }, []);

  const pushBead = useCallback((bead: Bead) => {
    setBeadStack((prev) => (
      prev[prev.length - 1] === bead.id ? prev : [...prev, bead.id]
    ));
    setIsPanelOpen(true);
  }, []);

  const goBack = useCallback(() => {
    if (liveStack.length > 1) {
      setBeadStack(liveStack.slice(0, -1));
      return;
    }
    setBeadStack([]);
    setIsPanelOpen(false);
  }, [liveStack]);

  const handleDetailOpenChange = useCallback((open: boolean) => {
    setIsPanelOpen(open);
    if (!open) {
      setBeadStack([]);
    }
  }, []);

  const navigateToBead = useCallback((beadId: string) => {
    const found = allBeads.find((b) => b.id === beadId);
    if (found) {
      setBeadStack([found.id]);
      setIsPanelOpen(true);
    }
  }, [allBeads]);

  return {
    detailBead,
    isDetailOpen,
    canGoBack,
    openBead,
    pushBead,
    goBack,
    handleDetailOpenChange,
    navigateToBead,
  };
}
