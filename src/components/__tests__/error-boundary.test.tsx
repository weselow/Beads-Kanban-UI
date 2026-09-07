import { useState } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ErrorBoundary } from '../error-boundary';

function Boom({ fail }: { fail: boolean }): React.ReactElement {
  if (fail) throw new Error('render failed');
  return <div>content is fine</div>;
}

/** Lets a test flip the child from broken to working before pressing "Try again". */
function Harness() {
  const [fail, setFail] = useState(true);
  return (
    <>
      <button onClick={() => setFail(false)}>repair</button>
      <ErrorBoundary label="Kanban Board">
        <Boom fail={fail} />
      </ErrorBoundary>
    </>
  );
}

/**
 * React re-throws a caught render error as a global "error" event, which jsdom
 * then prints in full. Swallow it so the run output stays readable.
 */
function swallowUncaught(event: ErrorEvent) {
  event.preventDefault();
}

beforeEach(() => {
  window.addEventListener('error', swallowUncaught);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  window.removeEventListener('error', swallowUncaught);
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders children while nothing fails', () => {
    render(
      <ErrorBoundary label="Kanban Board">
        <Boom fail={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('content is fine')).toBeInTheDocument();
  });

  it('shows the label and the error message when a child throws', () => {
    render(
      <ErrorBoundary label="Kanban Board">
        <Boom fail />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Kanban Board encountered an error');
    expect(screen.getByText('render failed')).toBeInTheDocument();
  });

  it('renders the children again after the cause is gone and "Try again" is pressed', () => {
    render(<Harness />);

    expect(screen.getByText('Kanban Board encountered an error')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'repair' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('content is fine')).toBeInTheDocument();
  });

  it('offers a page reload as the second way out', () => {
    render(
      <ErrorBoundary label="Kanban Board">
        <Boom fail />
      </ErrorBoundary>
    );

    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  });
});
