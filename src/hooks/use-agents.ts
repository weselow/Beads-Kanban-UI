"use client";

/**
 * Hook for loading and managing agent definitions (.claude/agents/*.md).
 *
 * Fetches from GET /api/agents and provides update capabilities.
 */

import { useState, useEffect, useCallback, useRef } from "react";

import * as api from "@/lib/api";
import { isDoltProject } from "@/lib/utils";
import type { Agent } from "@/types";

export interface UseAgentsResult {
  /** All agents for the project */
  agents: Agent[];
  /** Whether agents are currently being loaded */
  isLoading: boolean;
  /** Any error that occurred during loading */
  error: Error | null;
  /**
   * Update an agent's model and/or all-tools setting.
   *
   * `model` is a free string: the panel offers the three known names, but an
   * agent may already carry "inherit", "opusplan" or a full model id, and
   * toggling all-tools must keep that value untouched.
   */
  updateAgent: (
    filename: string,
    model: string,
    allTools: boolean
  ) => Promise<void>;
  /** Manually refresh agents list */
  refresh: () => Promise<void>;
}

/**
 * Hook to load and manage agent definitions from a project.
 *
 * @param projectPath - The absolute path to the project root
 * @returns Object containing agents, loading state, error, mutations, and refresh
 */
export function useAgents(projectPath: string): UseAgentsResult {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Track if initial load has completed
  const hasLoadedRef = useRef(false);

  /**
   * Load agents from the API
   */
  const loadAgents = useCallback(async () => {
    if (!projectPath || isDoltProject(projectPath)) {
      setAgents([]);
      setIsLoading(false);
      return;
    }

    // Only show loading on initial load
    if (!hasLoadedRef.current) {
      setIsLoading(true);
    }

    try {
      const result = await api.agents.list(projectPath);
      setAgents(result);
      setError(null);
      hasLoadedRef.current = true;
    } catch (err) {
      const loadError =
        err instanceof Error ? err : new Error(String(err));
      setError(loadError);
      console.error("Failed to load agents:", loadError);
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  /**
   * Public refresh function
   */
  const refresh = useCallback(async () => {
    await loadAgents();
  }, [loadAgents]);

  // Initial load when project path changes
  useEffect(() => {
    hasLoadedRef.current = false;
    loadAgents();
  }, [loadAgents]);

  /**
   * Update an agent's model and/or all-tools setting
   */
  const updateAgent = useCallback(
    async (filename: string, model: string, allTools: boolean) => {
      if (!projectPath) return;
      try {
        await api.agents.update(filename, projectPath, {
          model,
          all_tools: allTools,
        });
        await loadAgents();
      } catch (err) {
        const updateError =
          err instanceof Error ? err : new Error(String(err));
        console.error("Failed to update agent:", updateError);
        throw updateError;
      }
    },
    [projectPath, loadAgents]
  );

  return {
    agents,
    isLoading,
    error,
    updateAgent,
    refresh,
  };
}
