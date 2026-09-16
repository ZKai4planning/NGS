"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewProjectPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    clientName: "",
    clientPhone: "",
    clientAddress: "",
    jobType: "roof" as "roof" | "window" | "roof_and_window",
    title: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.clientName || !form.title) {
      setError("Client name and job title are required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create project");
      const { project } = await res.json();
      router.push(`/projects/${project.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card card-pad" style={{ maxWidth: 420, margin: "0 auto" }}>
      <h1 style={{ fontSize: 18, marginBottom: 18 }}>New project</h1>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Client name</label>
          <input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
        </div>

        <div className="field">
          <label>Phone</label>
          <input value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} />
        </div>

        <div className="field">
          <label>Address</label>
          <input value={form.clientAddress} onChange={(e) => setForm({ ...form, clientAddress: e.target.value })} />
        </div>

        <div className="field">
          <label>Job type</label>
          <select value={form.jobType} onChange={(e) => setForm({ ...form, jobType: e.target.value as any })}>
            <option value="roof">Roof</option>
            <option value="window">Window</option>
            <option value="roof_and_window">Roof + window</option>
          </select>
        </div>

        <div className="field">
          <label>Job title</label>
          <input
            placeholder="e.g. Webb residence - roof replacement"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>

        {error && <p className="field-error">{error}</p>}

        <button type="submit" disabled={submitting} className="btn primary full">
          {submitting ? "Creating..." : "Create project"}
        </button>
      </form>
    </div>
  );
}
