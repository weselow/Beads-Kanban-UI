"use client";

import { useState, useCallback } from "react";

import { Bot, ChevronDown, Loader2, Wrench } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAgents } from "@/hooks/use-agents";
import { cn } from "@/lib/utils";
import type { Agent, AgentModel, AgentToolsValue } from "@/types";

export interface AgentsPanelProps {
  /** Whether the panel is open */
  open: boolean;
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
  /** Absolute path to the project root */
  projectPath: string;
}

/**
 * Model badge color configuration.
 * Each model gets a distinct color for quick visual identification.
 */
interface ModelColors {
  bg: string;
  text: string;
  border: string;
}

const MODEL_COLORS: Record<AgentModel, ModelColors> = {
  opus: {
    bg: "bg-blocked-accent/15",
    text: "text-blocked-accent",
    border: "border-blocked-accent/25",
  },
  sonnet: {
    bg: "bg-status-review/15",
    text: "text-status-review",
    border: "border-status-review/25",
  },
  haiku: {
    bg: "bg-success/15",
    text: "text-success",
    border: "border-success/25",
  },
};

/**
 * Neutral colours for a model the panel does not know: "inherit", "opusplan",
 * a full model id, or an empty field.
 */
const UNKNOWN_MODEL_COLORS: ModelColors = {
  bg: "bg-surface-overlay",
  text: "text-t-muted",
  border: "border-b-strong/50",
};

/**
 * Look up the badge colours for a model name, falling back to a neutral style
 * so an unknown value renders instead of crashing.
 */
function getModelColors(model: string): ModelColors {
  return Object.prototype.hasOwnProperty.call(MODEL_COLORS, model)
    ? MODEL_COLORS[model as AgentModel]
    : UNKNOWN_MODEL_COLORS;
}

/** Label shown when the agent file has no model field. */
const DEFAULT_MODEL_LABEL = "default";

/** All available model options */
const MODEL_OPTIONS: AgentModel[] = ["haiku", "sonnet", "opus"];

/** Marker meaning "every tool". */
const ALL_TOOLS_MARKER = "*";

/** Split a comma separated `tools:` value into trimmed, non-empty names. */
function splitToolNames(raw: string): string[] {
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * Format the tools display for collapsed view.
 *
 * The server normalises `tools` to "*", a list, or null, but a comma separated
 * string can still arrive from an older server build, so that shape is handled
 * too. A missing field means the agent inherits every tool.
 */
export function formatToolsSummary(tools: AgentToolsValue | undefined): string {
  if (tools === null || tools === undefined) return "All tools";
  if (tools === ALL_TOOLS_MARKER) return "All tools";

  const names = typeof tools === "string" ? splitToolNames(tools) : tools;

  if (names.length === 0) return "No tools";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/**
 * Model badge component for displaying the current model.
 */
function ModelBadge({ model }: { model: string }) {
  const colors = getModelColors(model);
  const label = model.trim() || DEFAULT_MODEL_LABEL;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[0.625rem] leading-none font-medium border",
        colors.bg,
        colors.text,
        colors.border
      )}
    >
      {label}
    </span>
  );
}

/**
 * Single agent card with collapsible details.
 */
function AgentCard({
  agent,
  isExpanded,
  onToggle,
  onUpdateModel,
  onToggleAllTools,
  isUpdating,
}: {
  agent: Agent;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateModel: (model: AgentModel) => void;
  onToggleAllTools: () => void;
  isUpdating: boolean;
}) {
  const hasAllTools = agent.tools === ALL_TOOLS_MARKER;

  return (
    <div className="rounded-lg border border-b-default bg-surface-raised/50 overflow-hidden">
      {/* Collapsed header - always visible, clickable */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="w-full text-left p-3 flex items-start gap-2.5 hover:bg-surface-overlay/30 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="flex-1 min-w-0 space-y-1">
          {/* Name row */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-t-primary truncate">
              {agent.name}
            </span>
            <ModelBadge model={agent.model} />
          </div>

          {/* Description */}
          <p className="text-xs text-t-muted line-clamp-1 text-pretty">
            {agent.description || "No description"}
          </p>

          {/* Tools summary */}
          <div className="flex items-center gap-1 text-xs text-t-muted">
            <Wrench className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{formatToolsSummary(agent.tools)}</span>
          </div>
        </div>

        {/* Expand chevron */}
        <ChevronDown
          className={cn(
            "size-4 text-t-muted shrink-0 mt-0.5 transition-transform",
            isExpanded && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="border-t border-b-default p-3 space-y-3">
          {/* Model selector */}
          <div className="space-y-1.5">
            <span id={`model-label-${agent.filename}`} className="text-xs font-medium text-t-tertiary">Model</span>
            <div
              className="flex gap-1"
              role="radiogroup"
              aria-labelledby={`model-label-${agent.filename}`}
            >
              {MODEL_OPTIONS.map((model) => {
                const isSelected = agent.model === model;
                const colors = getModelColors(model);
                return (
                  <button
                    key={model}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={isUpdating}
                    onClick={() => onUpdateModel(model)}
                    className={cn(
                      "flex-1 h-7 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      isSelected
                        ? cn(colors.bg, colors.text, "border", colors.border)
                        : "bg-surface-overlay/50 text-t-muted hover:text-t-secondary hover:bg-surface-overlay border border-transparent"
                    )}
                  >
                    {model}
                  </button>
                );
              })}
            </div>
          </div>

          {/* All-tools toggle */}
          <div className="flex items-center justify-between">
            <label
              htmlFor={`all-tools-${agent.filename}`}
              className="text-xs font-medium text-t-tertiary"
            >
              All tools
            </label>
            <button
              id={`all-tools-${agent.filename}`}
              type="button"
              role="switch"
              aria-checked={hasAllTools}
              disabled={isUpdating}
              onClick={onToggleAllTools}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                hasAllTools
                  ? "bg-blocked-accent/30 border-blocked-accent/40"
                  : "bg-surface-overlay border-b-strong"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none block size-3.5 rounded-full transition-transform",
                  hasAllTools
                    ? "translate-x-[18px] bg-blocked-accent"
                    : "translate-x-[3px] bg-t-muted"
                )}
              />
            </button>
          </div>

          {/* Tools list (when not all tools) */}
          {!hasAllTools && Array.isArray(agent.tools) && agent.tools.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-t-tertiary">
                Tools ({agent.tools.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {agent.tools.map((tool) => (
                  <span
                    key={tool}
                    className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-[0.625rem] leading-none font-mono bg-surface-overlay text-t-muted border border-b-strong/50"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Updating indicator */}
          {isUpdating && (
            <div role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs text-t-muted">
              <Loader2
                className="size-3 animate-spin"
                aria-hidden="true"
              />
              Saving...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Agents Panel - slide-out Sheet for browsing and configuring project agents
 */
export function AgentsPanel({
  open,
  onOpenChange,
  projectPath,
}: AgentsPanelProps) {
  const { agents, isLoading, error, updateAgent } = useAgents(projectPath);

  // Track which card is expanded
  const [expandedFilename, setExpandedFilename] = useState<string | null>(null);

  // Track which agent is being updated
  const [updatingFilename, setUpdatingFilename] = useState<string | null>(null);

  /**
   * Toggle expanded state for a card
   */
  const handleToggle = useCallback((filename: string) => {
    setExpandedFilename((prev) => (prev === filename ? null : filename));
  }, []);

  /**
   * Handle model change for an agent
   */
  const handleUpdateModel = useCallback(
    async (agent: Agent, model: AgentModel) => {
      if (model === agent.model) return;
      setUpdatingFilename(agent.filename);
      try {
        await updateAgent(
          agent.filename,
          model,
          agent.tools === ALL_TOOLS_MARKER
        );
      } catch {
        // Error is logged in hook
      } finally {
        setUpdatingFilename(null);
      }
    },
    [updateAgent]
  );

  /**
   * Handle all-tools toggle for an agent
   */
  const handleToggleAllTools = useCallback(
    async (agent: Agent) => {
      const currentlyAllTools = agent.tools === ALL_TOOLS_MARKER;
      setUpdatingFilename(agent.filename);
      try {
        await updateAgent(agent.filename, agent.model, !currentlyAllTools);
      } catch {
        // Error is logged in hook
      } finally {
        setUpdatingFilename(null);
      }
    },
    [updateAgent]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg md:max-w-xl bg-surface-base border-b-default flex flex-col"
      >
        <SheetHeader className="space-y-1">
          <SheetTitle className="flex items-center gap-2 text-t-primary">
            <Bot className="size-5" aria-hidden="true" />
            Agents
          </SheetTitle>
          <SheetDescription className="text-t-muted">
            {isLoading
              ? "Loading..."
              : `${agents.length} ${agents.length === 1 ? "agent" : "agents"}`}
          </SheetDescription>
        </SheetHeader>

        {/* Agents list */}
        <ScrollArea className="flex-1 mt-4 -mx-6 px-6">
          <div className="space-y-2 pb-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2
                  className="size-5 text-t-muted animate-spin"
                  aria-hidden="true"
                />
                <span className="sr-only">Loading agents</span>
              </div>
            ) : error ? (
              <div
                role="alert"
                className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-center"
              >
                <p className="text-sm text-danger">
                  Failed to load agents
                </p>
                <p className="text-xs text-danger/60 mt-1">
                  {error.message}
                </p>
              </div>
            ) : agents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Bot
                  className="size-8 text-t-faint mb-3"
                  aria-hidden="true"
                />
                <p className="text-sm text-t-muted">No agents configured</p>
                <p className="text-xs text-t-faint mt-1">
                  Add agent files to .claude/agents/ to get started
                </p>
              </div>
            ) : (
              agents.map((agent) => (
                <AgentCard
                  key={agent.filename}
                  agent={agent}
                  isExpanded={expandedFilename === agent.filename}
                  onToggle={() => handleToggle(agent.filename)}
                  onUpdateModel={(model) => handleUpdateModel(agent, model)}
                  onToggleAllTools={() => handleToggleAllTools(agent)}
                  isUpdating={updatingFilename === agent.filename}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
