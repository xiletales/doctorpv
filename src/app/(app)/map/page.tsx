"use client";
import dynamic from "next/dynamic";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/card";

const MapView = dynamic(() => import("@/components/map/map-view").then((m) => m.MapView), {
  ssr: false,
  loading: () => <Skeleton className="m-4 h-[calc(100%-2rem)] rounded-2xl" />,
});

export default function MapPage() {
  return (
    <Suspense>
      <MapView />
    </Suspense>
  );
}
