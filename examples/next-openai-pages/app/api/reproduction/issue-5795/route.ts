const encoder = new TextEncoder();

export async function POST(request: Request) {
  const input = (await request.json()) as { sequence: number };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode('{"sequence":'));
      await new Promise(resolve => setTimeout(resolve, 5));
      controller.enqueue(encoder.encode(`${input.sequence}}`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
