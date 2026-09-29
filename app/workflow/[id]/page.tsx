"use client";
import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useWorkflowStore } from "@/lib/store";
import { useSpaceSync } from "@/lib/useSpaceSync";
import { QuickAssist } from "@/components/QuickAssist";

const WorkflowCanvas = dynamic(() => import("@/components/WorkflowCanvas"), {
  ssr: false,
});

export default function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const switchSpace = useWorkflowStore((s) => s.switchSpace);
  const spaces = useWorkflowStore((s) => s.spaces);

  const { loaded } = useSpaceSync();

  // Guard: if this ID doesn't exist in the store, redirect home.
  // Also ensures the correct space is active on direct URL access.
  //
  // `spaces` arrives asynchronously (DB fetch after hydration), so an empty
  // list on the first render means "not loaded yet", not "missing" — the old
  // version redirected home on every direct link because of that.
  useEffect(() => {
    if (spaces.some((sp) => sp.id === id)) {
      switchSpace(id);
      return;
    }
    if (!loaded) return;
    router.replace("/");
  }, [id, switchSpace, router, spaces, loaded]);

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <WorkflowCanvas />
      <QuickAssist />
    </div>
  );
}
