import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Icon } from "./icons";

interface Props {
  alias: string;
  onClose: () => void;
}

export function TerminalModal({ alias, onClose }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState("Connecting");

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      lineHeight: 1.25,
      theme: {
        background: "#050810",
        foreground: "#d8e2f0",
        cursor: "#4ade80",
        selectionBackground: "#1d4ed866",
        black: "#0b1020",
        red: "#fb7185",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#f8fafc",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    if (container.current) term.open(container.current);
    requestAnimationFrame(() => {
      fit.fit();
      term.focus();
    });

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = sessionStorage.getItem("ssh-nexus-token") ?? "";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal?host=${encodeURIComponent(alias)}&token=${encodeURIComponent(token)}`);
    ws.addEventListener("open", () => {
      setConnection("Authenticating");
      term.writeln(`\x1b[90mOpening SSH session for ${alias}…\x1b[0m`);
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; data: string };
      if (message.type === "output") term.write(message.data);
      if (message.type === "status") {
        setConnection(message.data.startsWith("Connected") ? "Connected" : message.data);
        term.writeln(`\r\n\x1b[90m${message.data}\x1b[0m`);
      }
      if (message.type === "error") term.writeln(`\r\n\x1b[31m${message.data}\x1b[0m`);
    });
    ws.addEventListener("close", () => setConnection("Closed"));
    ws.addEventListener("error", () => setConnection("Connection error"));
    const input = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });
    const resize = new ResizeObserver(() => fit.fit());
    if (container.current) resize.observe(container.current);

    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      resize.disconnect();
      input.dispose();
      ws.close();
      term.dispose();
      previouslyFocused?.focus();
    };
  }, [alias, onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="terminal-dialog" role="dialog" aria-modal="true" aria-labelledby="terminal-title" ref={dialog}>
        <header className="terminal-bar">
          <div className="terminal-lights" aria-hidden="true"><span /><span /><span /></div>
          <div className="terminal-title">
            <Icon name="terminal" />
            <span id="terminal-title">{alias}</span>
            <span className={`terminal-state terminal-state--${connection === "Connected" ? "online" : "pending"}`}>{connection}</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close terminal"><Icon name="close" /></button>
        </header>
        <div className="terminal-canvas" ref={container} />
        <footer className="terminal-footer">
          <span>SSH session uses your local OpenSSH configuration</span>
          <span>Esc to close</span>
        </footer>
      </div>
    </div>
  );
}
