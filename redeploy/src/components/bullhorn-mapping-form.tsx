"use client";

import { useActionState, useState, useTransition } from "react";

import { discoverBullhornFields, updateBullhornStipendMapping, type ActionState } from "@/app/actions";

type FieldOption = { name: string; label: string };

/**
 * Lets the owner tell Redeploy which Bullhorn custom field holds housing and
 * which holds M&IE. There is no sensible default — every agency names these
 * differently in their own Bullhorn admin — so this either discovers the
 * agency's real fields (with whatever label they gave them) or falls back to
 * typing a raw field name for someone who already knows it.
 */
export function BullhornMappingForm({
  housingField,
  mieField,
  canEdit,
}: {
  housingField: string;
  mieField: string;
  canEdit: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    updateBullhornStipendMapping,
    null,
  );
  const [discovering, startDiscover] = useTransition();
  const [fields, setFields] = useState<FieldOption[] | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [housing, setHousing] = useState(housingField);
  const [mie, setMie] = useState(mieField);

  const runDiscover = () => {
    setDiscoverError(null);
    startDiscover(async () => {
      const result = await discoverBullhornFields();
      if (result.error) {
        setDiscoverError(result.error);
        return;
      }
      setFields(result.fields ?? []);
    });
  };

  // Once real fields are loaded, offer them as a dropdown; a saved value
  // that no longer exists in Bullhorn still shows up, rather than vanishing.
  const optionsFor = (current: string) => {
    const opts = fields ?? [];
    if (current && !opts.some((f) => f.name === current)) {
      return [{ name: current, label: `${current} (no longer found)` }, ...opts];
    }
    return opts;
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Bullhorn field mapping</h2>
        <span className="note">
          {canEdit ? "Only the owner can change this." : "Read-only — ask the owner to change this."}
        </span>
      </div>

      <div style={{ padding: 16, display: "grid", gap: 14 }}>
        <p className="sub2">
          Housing and M&amp;IE stipends live in custom fields your agency configured inside
          Bullhorn — there is no default that works across agencies. Discover your fields, or
          type a raw name like <code>customFloat3</code> if you already know it.
        </p>

        {canEdit && (
          <div>
            <button type="button" className="btn" onClick={runDiscover} disabled={discovering}>
              {discovering ? "Looking up fields…" : "Discover fields from Bullhorn"}
            </button>
            {discoverError && <p className="warn bad" style={{ marginTop: 10 }}>{discoverError}</p>}
            {fields && !discoverError && (
              <p className="sub2" style={{ marginTop: 8 }}>
                {fields.length === 0
                  ? "Bullhorn reported no custom fields on Placement for this tenant."
                  : `Found ${fields.length} custom field${fields.length === 1 ? "" : "s"}.`}
              </p>
            )}
          </div>
        )}

        <form action={action} style={{ display: "grid", gap: 14 }}>
          {state?.error && <p className="warn bad">{state.error}</p>}
          {state?.ok && <p className="warn ok">{state.ok}</p>}

          <div className="calc-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label className="f" htmlFor="housingField">
                Housing stipend field
              </label>
              {fields ? (
                <select
                  id="housingField"
                  name="housingField"
                  value={housing}
                  onChange={(e) => setHousing(e.target.value)}
                  disabled={!canEdit}
                >
                  <option value="">— none —</option>
                  {optionsFor(housing).map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.label} ({f.name})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="housingField"
                  name="housingField"
                  value={housing}
                  onChange={(e) => setHousing(e.target.value)}
                  disabled={!canEdit}
                  placeholder="e.g. customFloat3"
                />
              )}
            </div>

            <div>
              <label className="f" htmlFor="mieField">
                M&amp;IE stipend field
              </label>
              {fields ? (
                <select
                  id="mieField"
                  name="mieField"
                  value={mie}
                  onChange={(e) => setMie(e.target.value)}
                  disabled={!canEdit}
                >
                  <option value="">— none —</option>
                  {optionsFor(mie).map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.label} ({f.name})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="mieField"
                  name="mieField"
                  value={mie}
                  onChange={(e) => setMie(e.target.value)}
                  disabled={!canEdit}
                  placeholder="e.g. customFloat4"
                />
              )}
            </div>
          </div>

          {canEdit && (
            <div>
              <button type="submit" className="btn btn-primary">
                Save mapping
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
