import { describe, expect, it, vi } from 'vitest';
import { createToolExecutionBarrier } from './tool-execution-barrier';

describe('tool execution barrier', () => {
  it('does not share completion state between model calls', async () => {
    const firstBarrier = createToolExecutionBarrier({
      smoothStreamId: Symbol('smoothStream'),
    });
    const secondBarrier = createToolExecutionBarrier({
      smoothStreamId: Symbol('smoothStream'),
    });
    let secondBarrierSettled = false;

    firstBarrier.seal();
    secondBarrier.register({});
    secondBarrier.seal();

    await firstBarrier.wait();
    void secondBarrier.wait().then(() => {
      secondBarrierSettled = true;
    });
    await Promise.resolve();

    expect(secondBarrierSettled).toBe(false);

    secondBarrier.release();
    await secondBarrier.wait();
  });

  it('removes its abort listener after an aborted wait', async () => {
    const abortController = new AbortController();
    const addEventListener = vi.spyOn(
      abortController.signal,
      'addEventListener',
    );
    const removeEventListener = vi.spyOn(
      abortController.signal,
      'removeEventListener',
    );
    const barrier = createToolExecutionBarrier({
      smoothStreamId: Symbol('smoothStream'),
    });

    barrier.register({});
    barrier.seal();

    const wait = barrier.wait(abortController.signal);
    abortController.abort();
    await wait;

    expect(addEventListener).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith(
      'abort',
      expect.any(Function),
    );
  });
});
