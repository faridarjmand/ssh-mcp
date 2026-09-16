import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ManagedSshHost, PublicSshHost } from "../shared";
import { Icon } from "./icons";

interface Props {
  host: PublicSshHost | null;
  onClose: () => void;
  onSave: (host: ManagedSshHost) => Promise<void>;
}

export function HostEditorModal({ host, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const [alias, setAlias] = useState(host?.alias ?? "");
  const [hostname, setHostname] = useState(host?.hostname ?? "");
  const [user, setUser] = useState(host?.user ?? "");
  const [port, setPort] = useState(String(host?.port ?? 22));
  const [proxyJump, setProxyJump] = useState(host?.proxyJump ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("input:not(:disabled)")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) onClose();
      if (event.key !== "Tab" || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[href],[tabindex]:not([tabindex="-1"])')];
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave({
        alias: alias.trim(),
        hostname: hostname.trim(),
        user: user.trim() || undefined,
        port: Number(port),
        proxyJump: proxyJump.trim() || undefined,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save SSH host");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <div className="host-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="host-editor-title" ref={dialog}>
        <header className="dialog-header">
          <div>
            <p className="eyebrow">MANAGED SSH CONFIG</p>
            <h2 id="host-editor-title">{host ? `Edit ${host.alias}` : "Add SSH server"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Close server editor"><Icon name="close" /></button>
        </header>
        <p className="dialog-intro">
          {host?.managed
            ? "This entry is owned by SSH Nexus. Saving updates only the managed config file."
            : host
              ? "Saving creates a managed override. The original SSH config entry remains untouched."
              : "Create a structured host entry without exposing private keys or raw SSH configuration to the browser."}
        </p>

        <form className="host-editor-form" onSubmit={submit}>
          <label>
            <span>Alias</span>
            <input value={alias} onChange={(event) => setAlias(event.target.value)} disabled={Boolean(host) || saving} required maxLength={255} placeholder="production-web" autoComplete="off" spellCheck={false} />
          </label>
          <label>
            <span>Hostname or IP</span>
            <input value={hostname} onChange={(event) => setHostname(event.target.value)} disabled={saving} required maxLength={255} placeholder="203.0.113.10" autoComplete="off" spellCheck={false} />
          </label>
          <div className="host-editor-form__row">
            <label>
              <span>User <small>optional</small></span>
              <input value={user} onChange={(event) => setUser(event.target.value)} disabled={saving} maxLength={128} placeholder="deploy" autoComplete="off" spellCheck={false} />
            </label>
            <label>
              <span>Port</span>
              <input type="number" value={port} onChange={(event) => setPort(event.target.value)} disabled={saving} min={1} max={65535} required inputMode="numeric" />
            </label>
          </div>
          <label>
            <span>ProxyJump aliases <small>optional, comma-separated</small></span>
            <input value={proxyJump} onChange={(event) => setProxyJump(event.target.value)} disabled={saving} maxLength={512} placeholder="bastion" autoComplete="off" spellCheck={false} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="host-editor-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-button" type="submit" disabled={saving}><Icon name="check" />{saving ? "Saving…" : host?.managed ? "Save changes" : "Save managed entry"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
