"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteProjectButton({
  projectId,
  projectTitle,
  afterDelete,
}: {
  projectId: string;
  projectTitle: string;
  /** Called instead of router.refresh() - e.g. redirect away when deleting from inside the project's own page. */
  afterDelete?: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!confirming) {
      setConfirming(true);
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to delete");
      if (afterDelete) afterDelete();
      else router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete project");
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      onBlur={() => setConfirming(false)}
      disabled={deleting}
      className="btn"
      style={
        confirming
          ? { borderColor: "var(--red)", color: "var(--red)", background: "var(--red-dim)" }
          : { color: "var(--muted)" }
      }
      title={confirming ? `Click again to permanently delete "${projectTitle}"` : "Delete project"}
    >
      {deleting ? "Deleting…" : confirming ? "Confirm delete?" : "Delete"}
    </button>
  );
}
