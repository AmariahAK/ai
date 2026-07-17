import { useObject } from '@ai-sdk/react';
import { useEffect, useState } from 'react';
import { z } from 'zod';

const schema = z.object({
  sequence: z.number(),
});

export default function Issue5795Page() {
  const [completedCount, setCompletedCount] = useState(0);
  const [pageLoadCount, setPageLoadCount] = useState<number>();
  const [sequence, setSequence] = useState(0);

  const { submit, isLoading, object, error } = useObject({
    api: '/api/reproduction/issue-5795',
    schema,
    onFinish({ object }) {
      if (object != null) {
        setCompletedCount(count => count + 1);
      }
    },
  });

  useEffect(() => {
    const storageKey = 'ai-sdk-issue-5795-page-load-count';
    const nextCount = Number(sessionStorage.getItem(storageKey) ?? 0) + 1;
    sessionStorage.setItem(storageKey, String(nextCount));
    setPageLoadCount(nextCount);
  }, []);

  const submitNext = () => {
    setSequence(current => {
      const next = current + 1;
      submit({ sequence: next });
      return next;
    });
  };

  return (
    <main>
      <p data-testid="page-load-count">{pageLoadCount}</p>
      <p data-testid="completed-count">{completedCount}</p>
      <p data-testid="object">{JSON.stringify(object)}</p>
      <p data-testid="error">{error?.message}</p>

      <button
        data-testid="direct-submit"
        type="button"
        disabled={isLoading}
        onClick={submitNext}
      >
        Direct submit
      </button>

      <form
        onSubmit={event => {
          event.preventDefault();
          submitNext();
        }}
      >
        <input data-testid="form-input" defaultValue="issue 5795" />
        <button data-testid="form-submit" type="submit" disabled={isLoading}>
          Form submit
        </button>
      </form>
    </main>
  );
}
