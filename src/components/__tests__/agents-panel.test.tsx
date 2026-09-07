import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Agent } from '@/types';

import { AgentsPanel, formatToolsSummary } from '../agents-panel';

const mockList = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/api', () => ({
  agents: {
    list: (...args: unknown[]) => mockList(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('formatToolsSummary', () => {
  it('treats a missing tools field as "all tools"', () => {
    expect(formatToolsSummary(null)).toBe('All tools');
    expect(formatToolsSummary(undefined)).toBe('All tools');
  });

  it('treats the "*" marker as "all tools"', () => {
    expect(formatToolsSummary('*')).toBe('All tools');
  });

  it('splits a comma separated string', () => {
    expect(formatToolsSummary('Read, Grep, Glob, Bash')).toBe('Read, Grep +2');
    expect(formatToolsSummary('Read')).toBe('Read');
    expect(formatToolsSummary('Read, Grep')).toBe('Read, Grep');
  });

  it('reports an empty list', () => {
    expect(formatToolsSummary([])).toBe('No tools');
    expect(formatToolsSummary('')).toBe('No tools');
  });

  it('lists one or two tools in full', () => {
    expect(formatToolsSummary(['Read'])).toBe('Read');
    expect(formatToolsSummary(['Read', 'Grep'])).toBe('Read, Grep');
  });

  it('shows the first two tools and a counter beyond that', () => {
    expect(formatToolsSummary(['Read', 'Grep', 'Glob'])).toBe('Read, Grep +1');
    expect(formatToolsSummary(['Read', 'Grep', 'Glob', 'Bash'])).toBe(
      'Read, Grep +2'
    );
  });
});

/** Build an agent with the fields a test cares about. */
function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    filename: 'reviewer.md',
    name: 'reviewer',
    model: 'sonnet',
    description: 'Reviews code',
    tools: ['Read', 'Grep'],
    nickname: null,
    ...overrides,
  };
}

describe('AgentsPanel', () => {
  it('renders an agent whose model is outside the known set without throwing', async () => {
    mockList.mockResolvedValue([
      makeAgent({ name: 'inherit-agent', model: 'inherit', tools: null }),
    ]);

    render(
      <AgentsPanel open onOpenChange={() => {}} projectPath="M:/repos/demo" />
    );

    await waitFor(() => {
      expect(screen.getByText('inherit-agent')).toBeInTheDocument();
    });

    // The badge shows the raw value and the summary falls back to "All tools".
    expect(screen.getByText('inherit')).toBeInTheDocument();
    expect(screen.getByText('All tools')).toBeInTheDocument();
  });

  it('renders an agent with an empty model without throwing', async () => {
    mockList.mockResolvedValue([
      makeAgent({ name: 'no-model', model: '', tools: '*' }),
    ]);

    render(
      <AgentsPanel open onOpenChange={() => {}} projectPath="M:/repos/demo" />
    );

    await waitFor(() => {
      expect(screen.getByText('no-model')).toBeInTheDocument();
    });

    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('leaves the model radio group unselected for an unknown model', async () => {
    mockList.mockResolvedValue([
      makeAgent({ name: 'inherit-agent', model: 'inherit' }),
    ]);

    render(
      <AgentsPanel open onOpenChange={() => {}} projectPath="M:/repos/demo" />
    );

    await waitFor(() => {
      expect(screen.getByText('inherit-agent')).toBeInTheDocument();
    });

    // Expand the card to reveal the model radio group.
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    await waitFor(() => {
      expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    });

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    for (const radio of radios) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
  });
});
