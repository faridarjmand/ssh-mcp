import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

interface ClientConfigurations {
  codex: { command: string; verify: string; config: string; httpConfig: string };
  claudeCode: { command: string; verify: string };
  claudeDesktop: { config: string };
  generic: { stdio: unknown; streamableHttp: unknown };
}

interface Props {
  configs: ClientConfigurations | null;
  onClose: () => void;
}

const tabs = ["Codex", "Claude Code", "Claude Desktop", "Other MCP"] as const;

export function AgentModal({ configs, onClose }: Props) {
  const [active, setActive] = useState<(typeof tabs)[number]>("Codex");
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])')];
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose]);

  let content = "Loading configuration…";
  let verify = "";
  if (configs) {
    if (active === "Codex") { content = configs.codex.command; verify = configs.codex.verify; }
    if (active === "Claude Code") { content = configs.claudeCode.command; verify = configs.claudeCode.verify; }
    if (active === "Claude Desktop") content = configs.claudeDesktop.config;
    if (active === "Other MCP") content = JSON.stringify(configs.generic, null, 2);
  }

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="agent-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-title" ref={dialog}>
        <header className="dialog-header">
          <div><p className="eyebrow">MCP CONNECTION</p><h2 id="agent-title">Connect an AI agent</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button>
        </header>
        <p className="dialog-intro">Build the project first, then add the same local MCP server to your preferred client. No AI API key is stored by SSH Nexus.</p>
        <div className="agent-tabs" role="tablist" aria-label="AI client">
          {tabs.map((tab) => <button key={tab} type="button" role="tab" aria-selected={active === tab} onClick={() => setActive(tab)}>{tab}</button>)}
        </div>
        <div className="code-panel">
          <div className="code-panel__bar"><span>{active === "Claude Desktop" || active === "Other MCP" ? "Configuration" : "Terminal command"}</span><button type="button" onClick={copy}><Icon name={copied ? "check" : "copy"} />{copied ? "Copied" : "Copy"}</button></div>
          <pre><code>{content}</code></pre>
        </div>
        {verify && <p className="verify-line"><Icon name="check" /> Verify with <code>{verify}</code></p>}
        <div className="dialog-note"><Icon name="activity" /><span>Read-only inventory and metrics work immediately. Arbitrary SSH commands remain disabled until the operator opts in.</span></div>
      </div>
    </div>
  );
}
