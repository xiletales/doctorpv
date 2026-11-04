import { requireUser, route } from "@/lib/api";
import { live } from "@/lib/live/store";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const user = await requireUser();
  await live.init();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      send("snapshot", live.snapshot(user));
      const unsubscribe = live.subscribe(user, send);
      const beat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 15000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The client already closed the stream.
        }
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
