import { Skeleton } from "@/components/ui";

/** Skeleton while a screen loads (UI-FLOWS §0.9) — light, no spinners or images. */
export default function Loading() {
  return (
    <div aria-busy className="flex flex-col gap-4">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-36" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  );
}
