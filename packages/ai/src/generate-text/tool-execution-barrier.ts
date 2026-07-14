type ToolExecutionBarrierRegistration = {
  barrier: ToolExecutionBarrier;
  key: object;
  smoothStreamId: symbol;
};

const registrationsByChunk = new WeakMap<
  object,
  ToolExecutionBarrierRegistration[]
>();

type InternalToolExecutionBarrier = {
  register(chunk: object): void;
  seal(): void;
  wait(abortSignal?: AbortSignal): Promise<void>;
  release(): void;
  process(key: object): void;
};

export type ToolExecutionBarrier = Omit<
  InternalToolExecutionBarrier,
  'process'
>;

export function createToolExecutionBarrier({
  smoothStreamId,
  onSettled,
}: {
  smoothStreamId: symbol;
  onSettled?: () => void;
}): ToolExecutionBarrier {
  const pendingChunks = new Set<object>();
  let isSealed = false;
  let isSettled = false;
  let resolve!: () => void;
  const promise = new Promise<void>(resolveParam => {
    resolve = resolveParam;
  });

  function settle() {
    if (isSettled || !isSealed || pendingChunks.size > 0) {
      return;
    }

    isSettled = true;
    resolve();
    onSettled?.();
  }

  const barrier: InternalToolExecutionBarrier = {
    register(chunk) {
      if (isSettled) {
        return;
      }

      pendingChunks.add(chunk);

      const registrations = registrationsByChunk.get(chunk) ?? [];
      registrations.push({
        barrier,
        key: chunk,
        smoothStreamId,
      });
      registrationsByChunk.set(chunk, registrations);
    },

    seal() {
      isSealed = true;
      settle();
    },

    async wait(abortSignal) {
      if (abortSignal?.aborted || isSettled) {
        return;
      }

      if (abortSignal == null) {
        await promise;
        return;
      }

      let onAbort!: () => void;
      const abortPromise = new Promise<void>(resolveAbort => {
        onAbort = () => {
          barrier.release();
          resolveAbort();
        };
        abortSignal.addEventListener('abort', onAbort, { once: true });
      });

      try {
        await Promise.race([promise, abortPromise]);
      } finally {
        abortSignal.removeEventListener('abort', onAbort);
      }
    },

    release() {
      if (isSettled) {
        return;
      }

      pendingChunks.clear();
      isSealed = true;
      settle();
    },

    process(key) {
      pendingChunks.delete(key);
      settle();
    },
  };

  return barrier;
}

export function completeToolExecutionBarrierChunks({
  inputChunks,
  outputChunk,
  smoothStreamId,
}: {
  inputChunks: object[];
  outputChunk: object | undefined;
  smoothStreamId: symbol;
}) {
  for (const inputChunk of inputChunks) {
    const registrations = registrationsByChunk.get(inputChunk);

    if (registrations == null) {
      continue;
    }

    registrationsByChunk.delete(inputChunk);

    for (const registration of registrations) {
      if (registration.smoothStreamId === smoothStreamId) {
        (registration.barrier as InternalToolExecutionBarrier).process(
          registration.key,
        );
      } else if (outputChunk != null) {
        const outputRegistrations = registrationsByChunk.get(outputChunk) ?? [];
        outputRegistrations.push(registration);
        registrationsByChunk.set(outputChunk, outputRegistrations);
      } else {
        registration.barrier.release();
      }
    }
  }
}

export function releaseToolExecutionBarriersForChunk(chunk: object) {
  const registrations = registrationsByChunk.get(chunk);

  if (registrations == null) {
    return;
  }

  registrationsByChunk.delete(chunk);

  for (const registration of registrations) {
    registration.barrier.release();
  }
}
