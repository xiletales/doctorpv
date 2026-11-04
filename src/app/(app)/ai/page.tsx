import { Suspense } from "react";
import { AiView } from "./ai-view";

export default function AiPage() {
  return (
    <Suspense>
      <AiView />
    </Suspense>
  );
}
