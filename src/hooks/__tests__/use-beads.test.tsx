import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bead } from '@/types';

const loadProjectBeadsMock = vi.fn();
let watchedChange: (() => void) | undefined;

vi.mock('@/lib/beads-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/beads-parser')>();
  return {
    ...actual,
    loadProjectBeads: (...args: unknown[]) => loadProjectBeadsMock(...args),
  };
});

vi.mock('@/hooks/use-file-watcher', () => ({
  useFileWatcher: (
    _projectPath: string,
    onFileChange: () => void,
  ) => {
    watchedChange = onFileChange;
    return { isWatching: true, error: null };
  },
}));

// Import after mocks so useBeads receives the test implementations.
// eslint-disable-next-line import/first, import/order
import { useBeads } from '../use-beads';

const baseBead: Bead = {
  id: 'test-1',
  title: 'Test',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  owner: 'user',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  comments: [],
};

beforeEach(() => {
  loadProjectBeadsMock.mockReset();
  watchedChange = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useBeads full refreshes', () => {
  it('bypasses updatedAfter when a full refresh is requested', async () => {
    loadProjectBeadsMock
      .mockResolvedValueOnce({ beads: [baseBead], source: 'jsonl' })
      .mockResolvedValueOnce({ beads: [], source: 'jsonl' })
      .mockResolvedValueOnce({
        beads: [{
          ...baseBead,
          comments: [{
            id: 'comment-1',
            issue_id: baseBead.id,
            author: 'user',
            text: 'Visible',
            created_at: '2026-01-02T00:00:00Z',
          }],
        }],
        source: 'jsonl',
      });

    const { result } = renderHook(() => useBeads('/tmp/project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });
    expect(loadProjectBeadsMock.mock.calls[1][1]).toMatchObject({
      withSource: true,
      updatedAfter: baseBead.updated_at,
    });

    await act(async () => {
      await result.current.refresh({ full: true });
    });
    expect(loadProjectBeadsMock.mock.calls[2][1]).toEqual({
      withSource: true,
      updatedAfter: undefined,
    });
    expect(result.current.beads[0].comments[0].text).toBe('Visible');
  });

  it('uses a full refresh for JSONL watcher notifications', async () => {
    loadProjectBeadsMock
      .mockResolvedValueOnce({ beads: [baseBead], source: 'jsonl' })
      .mockResolvedValueOnce({
        beads: [{
          ...baseBead,
          comments: [{
            id: 'comment-1',
            issue_id: baseBead.id,
            author: 'user',
            text: 'External comment',
            created_at: '2026-01-02T00:00:00Z',
          }],
        }],
        source: 'jsonl',
      });

    const { result } = renderHook(() => useBeads('/tmp/project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      watchedChange?.();
    });

    await waitFor(() => {
      expect(result.current.beads[0].comments[0]?.text).toBe('External comment');
    });
    expect(loadProjectBeadsMock.mock.calls[1][1]).toEqual({
      withSource: true,
      updatedAfter: undefined,
    });
  });

  it('polls CLI-backed filesystem projects with a full refresh', async () => {
    let poll: (() => void) | undefined;
    const realSetInterval = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation((handler, timeout, ...args) => {
      if (timeout === 15_000) {
        poll = handler as () => void;
      }
      return realSetInterval(handler, timeout, ...args);
    });

    loadProjectBeadsMock
      .mockResolvedValueOnce({ beads: [baseBead], source: 'cli' })
      .mockResolvedValueOnce({
        beads: [{
          ...baseBead,
          comments: [{
            id: 'comment-1',
            issue_id: baseBead.id,
            author: 'user',
            text: 'Polled comment',
            created_at: '2026-01-02T00:00:00Z',
          }],
        }],
        source: 'cli',
      });

    const { result } = renderHook(() => useBeads('C:\\project'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(poll).toBeTypeOf('function'));

    act(() => {
      poll?.();
    });

    await waitFor(() => {
      expect(result.current.beads[0].comments[0]?.text).toBe('Polled comment');
    });
    expect(loadProjectBeadsMock.mock.calls[1][1]).toEqual({
      withSource: true,
      updatedAfter: undefined,
    });
  });
});
