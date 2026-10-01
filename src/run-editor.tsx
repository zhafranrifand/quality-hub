import { useState } from "react";
import { api } from "./api";
import { Field, Form, Modal } from "./components";
import type { Plan } from "./types";

type RunEditorProps = {
  plan: Plan;
  close: () => void;
  done: (id: string) => Promise<void>;
};

export function RunEditor({ plan, close, done }: RunEditorProps) {
  const [build, setBuild] = useState("");
  const [kind, setKind] = useState("manual");

  return (
    <Modal title="Start test run" onClose={close}>
      <Form
        submit="Start run"
        onCancel={close}
        onSubmit={async () => {
          const run = await api(`/plans/${plan.id}/runs`, "POST", {
            build,
            kind,
          });
          close();
          await done(run.id);
        }}
      >
        <p>
          {plan.name} · {plan.items.length} combinations
        </p>
        <Field label="Build identifier">
          <input
            required
            placeholder="e.g. commit SHA or build-42"
            value={build}
            onChange={(event) => setBuild(event.target.value)}
          />
        </Field>
        <Field label="Execution type">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="manual">Manual</option>
            <option value="automated">Playwright import</option>
          </select>
        </Field>
      </Form>
    </Modal>
  );
}
