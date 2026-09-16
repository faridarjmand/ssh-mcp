import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { HostMetrics, HostState, HostStatus, ManagedSshHost, ProjectIndex, PublicSshHost, SearchMatch } from "../shared";
import { AgentModal } from "./AgentModal";
import { mapWithConcurrency } from "./fleet-refresh";
import { HostEditorModal } from "./HostEditorModal";
import { Icon } from "./icons";

const TerminalModal = lazy(() => import("./TerminalModal").then((module) => ({ default: module.TerminalModal })));
const FLEET_REFRESH_CONCURRENCY = 8;

interface Health {
  status: string;
  authRequired: boolean;
  remoteCommandsEnabled: boolean;
  sshConfigWritesEnabled: boolean;
}

interface HostMutationResult {
  host?: PublicSshHost;
  hosts: PublicSshHost[];
}

function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (Math.abs(amount) >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

function percent(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

function ageLabel(iso?: string): string {
  if (!iso) return "Never checked";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function withoutEntry<T>(values: Record<string, T>, key: string): Record<string, T> {
  if (!Object.hasOwn(values, key)) return values;
  const next = { ...values };
  delete next[key];
  return next;
}

function MetricBar({ label, value, detail, icon }: { label: string; value: number | null; detail: string; icon: "cpu" | "memory" | "drive" }) {
  return (
    <div className="metric-row">
      <div className="metric-label"><span><Icon name={icon} />{label}</span><strong>{value === null ? "—" : `${value.toFixed(0)}%`}</strong></div>
      <div className="metric-track" role="meter" aria-label={`${label} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
        <span style={{ width: `${value ?? 0}%` }} />
      </div>
      <span className="metric-detail">{detail}</span>
    </div>
  );
}

function stateLabel(state: HostState): string {
  return { unknown: "Not checked", checking: "Checking", online: "Online", offline: "Offline" }[state];
}

function HostCard({
  host,
  status,
  metrics,
  metricError,
  onOpen,
  onRefresh,
  onEdit,
  editingEnabled,
}: {
  host: PublicSshHost;
  status?: HostStatus;
  metrics?: HostMetrics;
  metricError?: string;
  onOpen: () => void;
  onRefresh: () => void;
  onEdit: () => void;
  editingEnabled: boolean;
}) {
  const state = status?.state ?? "unknown";
  const memoryPercent = metrics ? percent(metrics.memoryUsedBytes, metrics.memoryTotalBytes) : null;
  const diskPercent = metrics ? percent(metrics.diskUsedBytes, metrics.diskTotalBytes) : null;
  return (
    <article className={`host-card host-card--${state}`}>
      <button className="host-card__surface" type="button" onClick={onOpen} aria-label={`Open terminal for ${host.alias}`}>
        <div className="host-card__head">
          <div className="server-mark"><Icon name="server" /></div>
          <div><h3>{host.alias}</h3><p>{host.user ? `${host.user}@` : ""}{host.hostname}:{host.port}</p></div>
          <span className={`status-chip status-chip--${state}`}><i />{stateLabel(state)}</span>
        </div>
        <div className="host-meta">
          <span>{host.proxyJump ? `via ${host.proxyJump}` : "Direct connection"}</span>
          <span>{status?.latencyMs ? `${status.latencyMs} ms` : `${host.source}${host.managed ? " · managed" : ""}`}</span>
        </div>
        <div className="metric-stack">
          {metrics ? (
            <>
              <MetricBar icon="cpu" label="CPU" value={metrics.cpuPercent} detail={metrics.load1 === null ? metrics.os : `Load ${metrics.load1.toFixed(2)}`} />
              <MetricBar icon="memory" label="Memory" value={memoryPercent} detail={`${bytes(metrics.memoryUsedBytes)} / ${bytes(metrics.memoryTotalBytes)}`} />
              <MetricBar icon="drive" label="Root disk" value={diskPercent} detail={`${bytes(metrics.diskUsedBytes)} / ${bytes(metrics.diskTotalBytes)}`} />
              <div className="io-row"><span>DISK I/O</span><strong>R {bytes(metrics.readBytesPerSecond)}/s</strong><strong>W {bytes(metrics.writeBytesPerSecond)}/s</strong></div>
            </>
          ) : (
            <div className={`metric-empty ${metricError ? "metric-empty--error" : ""}`}>
              <Icon name={metricError ? "activity" : "cpu"} />
              <span>{metricError ?? (state === "online" ? "Waiting for authenticated SSH metrics" : "Metrics available when the host is online")}</span>
            </div>
          )}
        </div>
        <div className="open-terminal"><Icon name="terminal" /><span>Open terminal</span><Icon name="arrow" /></div>
      </button>
      <div className="host-card__foot">
        <span>Updated {ageLabel(status?.checkedAt)}</span>
        <div className="host-card__actions">
          <button type="button" onClick={onEdit} disabled={!editingEnabled} title={editingEnabled ? "Edit with an SSH Nexus managed entry" : "Enable ALLOW_SSH_CONFIG_WRITES to edit"} aria-label={`Edit ${host.alias}`}><Icon name="edit" />Edit</button>
          <button type="button" onClick={onRefresh} disabled={state === "checking"} aria-label={`Refresh ${host.alias}`}><Icon name="refresh" />Refresh</button>
        </div>
      </div>
    </article>
  );
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [token, setToken] = useState(() => sessionStorage.getItem("ssh-nexus-token") ?? "");
  const [tokenDraft, setTokenDraft] = useState("");
  const [authError, setAuthError] = useState("");
  const [hosts, setHosts] = useState<PublicSshHost[]>([]);
  const [statuses, setStatuses] = useState<Record<string, HostStatus>>({});
  const [metrics, setMetrics] = useState<Record<string, HostMetrics>>({});
  const [metricErrors, setMetricErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [filter, setFilter] = useState<"all" | "online" | "offline">("all");
  const [search, setSearch] = useState("");
  const [terminalHost, setTerminalHost] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [clientConfigs, setClientConfigs] = useState<any>(null);
  const [project, setProject] = useState<ProjectIndex | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [notice, setNotice] = useState("");
  const [editorHost, setEditorHost] = useState<PublicSshHost | null | undefined>(undefined);
  const hostRefreshes = useRef(new Map<string, Promise<void>>());
  const fleetRefresh = useRef<Promise<void> | null>(null);

  const api = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    return body as T;
  }, [token]);

  const refreshHost = useCallback((host: PublicSshHost): Promise<void> => {
    const existing = hostRefreshes.current.get(host.alias);
    if (existing) return existing;

    const operation = (async () => {
      setStatuses((current) => ({ ...current, [host.alias]: { alias: host.alias, state: "checking" } }));
      setMetricErrors((current) => withoutEntry(current, host.alias));
      try {
        const status = await api<HostStatus>(`/api/hosts/${encodeURIComponent(host.alias)}/check`, { method: "POST" });
        setStatuses((current) => ({ ...current, [host.alias]: status }));
        if (status.state !== "online") {
          setMetrics((current) => withoutEntry(current, host.alias));
          return;
        }

        try {
          const value = await api<HostMetrics>(`/api/hosts/${encodeURIComponent(host.alias)}/metrics`);
          setMetrics((current) => ({ ...current, [host.alias]: value }));
        } catch (error) {
          setMetrics((current) => withoutEntry(current, host.alias));
          setMetricErrors((current) => ({ ...current, [host.alias]: error instanceof Error ? error.message : "Metrics unavailable" }));
        }
      } catch (error) {
        setMetrics((current) => withoutEntry(current, host.alias));
        setStatuses((current) => ({
          ...current,
          [host.alias]: {
            alias: host.alias,
            state: "offline",
            checkedAt: new Date().toISOString(),
            message: error instanceof Error ? error.message : "Check failed",
          },
        }));
      }
    })().finally(() => {
      hostRefreshes.current.delete(host.alias);
    });

    hostRefreshes.current.set(host.alias, operation);
    return operation;
  }, [api]);

  const refreshAll = useCallback((items: PublicSshHost[]): Promise<void> => {
    if (fleetRefresh.current) return fleetRefresh.current;

    setRefreshingAll(true);
    const operation = mapWithConcurrency(items, FLEET_REFRESH_CONCURRENCY, refreshHost)
      .then(() => undefined)
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : "Fleet refresh failed");
      });
    fleetRefresh.current = operation;
    const complete = () => {
      if (fleetRefresh.current !== operation) return;
      fleetRefresh.current = null;
      setRefreshingAll(false);
    };
    void operation.then(complete, complete);
    return operation;
  }, [refreshHost]);

  useEffect(() => {
    fetch("/api/health").then((response) => response.json()).then(setHealth).catch(() => setHealth({ status: "error", authRequired: false, remoteCommandsEnabled: false, sshConfigWritesEnabled: false }));
  }, []);

  useEffect(() => {
    if (!health || (health.authRequired && !token)) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    Promise.all([
      api<{ hosts: PublicSshHost[] }>("/api/hosts"),
      api<{ index: ProjectIndex | null }>("/api/project"),
    ]).then(([hostResult, projectResult]) => {
      if (!active) return;
      setHosts(hostResult.hosts);
      setProject(projectResult.index);
      setAuthError("");
      setLoading(false);
      void refreshAll(hostResult.hosts);
    }).catch((error) => {
      if (!active) return;
      setLoading(false);
      setAuthError(error instanceof Error ? error.message : "Unable to load dashboard");
    });
    return () => { active = false; };
  }, [api, health, refreshAll, token]);

  useEffect(() => {
    if (!hosts.length) return;
    const interval = window.setInterval(() => void refreshAll(hosts), 30_000);
    return () => window.clearInterval(interval);
  }, [hosts, refreshAll]);

  const counts = useMemo(() => ({
    online: hosts.filter((host) => statuses[host.alias]?.state === "online").length,
    offline: hosts.filter((host) => statuses[host.alias]?.state === "offline").length,
  }), [hosts, statuses]);

  const visibleHosts = useMemo(() => hosts.filter((host) => {
    const state = statuses[host.alias]?.state ?? "unknown";
    const matchesFilter = filter === "all" || state === filter;
    const needle = search.toLocaleLowerCase();
    return matchesFilter && (!needle || `${host.alias} ${host.hostname} ${host.user ?? ""}`.toLocaleLowerCase().includes(needle));
  }), [filter, hosts, search, statuses]);

  const unlock = (event: FormEvent) => {
    event.preventDefault();
    sessionStorage.setItem("ssh-nexus-token", tokenDraft);
    setToken(tokenDraft);
  };

  const openAgents = async () => {
    setAgentOpen(true);
    if (!clientConfigs) {
      try { setClientConfigs(await api("/api/client-configs")); }
      catch (error) { setNotice(error instanceof Error ? error.message : "Could not load configurations"); }
    }
  };

  const buildIndex = async () => {
    setIndexing(true); setNotice("Indexing project…");
    try {
      const result = await api<{ index: ProjectIndex }>("/api/project/index", { method: "POST", body: "{}" });
      setProject(result.index); setNotice(`Indexed ${result.index.fileCount} files`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Indexing failed"); }
    finally { setIndexing(false); }
  };

  const searchProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!projectQuery.trim()) return;
    try {
      const result = await api<{ matches: SearchMatch[] }>(`/api/project/search?q=${encodeURIComponent(projectQuery)}`);
      setMatches(result.matches); setNotice(`${result.matches.length} project matches`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Search failed"); }
  };

  const saveManagedHost = async (host: ManagedSshHost) => {
    const result = await api<HostMutationResult>(`/api/managed-hosts/${encodeURIComponent(host.alias)}`, {
      method: "PUT",
      body: JSON.stringify(host),
    });
    setHosts(result.hosts);
    setStatuses((current) => withoutEntry(current, host.alias));
    setMetrics((current) => withoutEntry(current, host.alias));
    setMetricErrors((current) => withoutEntry(current, host.alias));
    setEditorHost(undefined);
    setNotice(`Saved managed SSH host ${host.alias}`);
    if (result.host) void refreshHost(result.host);
  };

  const closeTerminal = useCallback(() => setTerminalHost(null), []);
  const closeAgents = useCallback(() => setAgentOpen(false), []);
  const closeEditor = useCallback(() => setEditorHost(undefined), []);

  if (!health || loading) return <div className="loading-screen"><div className="brand-orbit"><span /></div><p>Loading SSH Nexus</p></div>;

  if (health.authRequired && !token) {
    return <div className="auth-screen"><div className="auth-card"><div className="brand-lock"><Icon name="terminal" /></div><p className="eyebrow">PROTECTED DASHBOARD</p><h1>Enter access token</h1><p>This dashboard is protected because <code>SSH_NEXUS_TOKEN</code> is configured.</p><form onSubmit={unlock}><label htmlFor="access-token">Bearer token</label><input id="access-token" type="password" value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} autoFocus /><button type="submit">Unlock dashboard<Icon name="arrow" /></button></form>{authError && <p className="form-error">{authError}</p>}</div></div>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="SSH Nexus home"><div className="brand-orbit"><span /></div><div><strong>SSH NEXUS</strong><small>CONTROL PLANE</small></div></a>
        <nav aria-label="Primary navigation">
          <a className="active" href="#inventory"><Icon name="server" />Inventory</a>
          <a href="#project"><Icon name="database" />Project index</a>
          <button type="button" onClick={openAgents}><Icon name="code" />AI connections</button>
        </nav>
        <div className="sidebar-foot">
          <span className="local-badge"><i />LOCAL ONLY</span>
          <p>OpenSSH credentials never enter the browser.</p>
        </div>
      </aside>

      <main id="top">
        <header className="topbar">
          <div><p className="eyebrow">INFRASTRUCTURE / LIVE INVENTORY</p><h1>Your servers, one command away.</h1></div>
          <div className="topbar-actions"><button className="secondary-button" type="button" onClick={() => void refreshAll(hosts)} disabled={refreshingAll || !hosts.length}><Icon name="refresh" />{refreshingAll ? "Refreshing…" : "Refresh"}</button><button className="primary-button" type="button" onClick={openAgents}><Icon name="code" />Connect AI</button></div>
        </header>

        <section className="overview" aria-label="Inventory overview">
          <div><span>Total hosts</span><strong>{hosts.length.toString().padStart(2, "0")}</strong><small>source + managed config</small></div>
          <div><span>Online</span><strong className="online-text">{counts.online.toString().padStart(2, "0")}</strong><small>accepting connections</small></div>
          <div><span>Offline</span><strong className="offline-text">{counts.offline.toString().padStart(2, "0")}</strong><small>needs attention</small></div>
          <div><span>Project files</span><strong>{project?.fileCount.toLocaleString() ?? "—"}</strong><small>{project ? `indexed ${ageLabel(project.generatedAt)}` : "not indexed yet"}</small></div>
        </section>

        <section id="inventory" className="section-block">
          <div className="section-heading"><div><p className="eyebrow">SERVER FLEET</p><h2>SSH inventory</h2></div><span className="sync-label" aria-live="polite"><i />{refreshingAll ? "Refresh in progress" : "Auto-refresh every 30 seconds"} · max {FLEET_REFRESH_CONCURRENCY} concurrent</span></div>
          <div className="inventory-tools">
            <label className="search-box"><Icon name="search" /><span className="sr-only">Search hosts</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search alias, host, or user" /></label>
            <div className="inventory-actions">
              <div className="filter-tabs" role="group" aria-label="Filter server status">
                {(["all", "online", "offline"] as const).map((item) => <button type="button" key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item === "all" ? `All ${hosts.length}` : `${item[0].toUpperCase()}${item.slice(1)} ${counts[item]}`}</button>)}
              </div>
              <button className="secondary-button add-server-button" type="button" onClick={() => setEditorHost(null)} disabled={!health.sshConfigWritesEnabled} title={health.sshConfigWritesEnabled ? "Add a managed SSH server" : "Set SSH_NEXUS_TOKEN and ALLOW_SSH_CONFIG_WRITES=true"}><Icon name="plus" />Add server</button>
            </div>
          </div>
          {!health.sshConfigWritesEnabled && <div className="config-write-notice"><Icon name="activity" /><span>Server editing is off by default. Set <code>SSH_NEXUS_TOKEN</code> and <code>ALLOW_SSH_CONFIG_WRITES=true</code> to enable managed entries.</span></div>}
          {authError && <div className="inline-error"><Icon name="activity" />{authError}</div>}
          <div className="host-grid">
            {visibleHosts.map((host) => <HostCard key={host.alias} host={host} status={statuses[host.alias]} metrics={metrics[host.alias]} metricError={metricErrors[host.alias]} onOpen={() => setTerminalHost(host.alias)} onRefresh={() => void refreshHost(host)} onEdit={() => setEditorHost(host)} editingEnabled={health.sshConfigWritesEnabled} />)}
          </div>
          {!visibleHosts.length && <div className="empty-state"><Icon name="server" /><h3>No hosts found</h3><p>{hosts.length ? "Change the search or status filter." : "Add an explicit SSH alias or enable managed server editing."}</p></div>}
        </section>

        <section id="project" className="project-section">
          <div className="project-copy"><p className="eyebrow">AGENT CONTEXT</p><h2>A project map every agent can use.</h2><p>Build a metadata index of source files, languages, hashes, and line counts. Secret-like files, symlinks, dependencies, and generated output stay outside the index.</p><div className="project-actions"><button className="primary-button" type="button" onClick={buildIndex} disabled={indexing}><Icon name="database" />{indexing ? "Indexing…" : project ? "Refresh index" : "Build index"}</button>{project && <span>{project.fileCount.toLocaleString()} files · {bytes(project.totalBytes)}</span>}</div></div>
          <div className="index-card">
            <div className="index-card__head"><span>PROJECT_INDEX</span><span className={project ? "ready" : "pending"}>{project ? "READY" : "EMPTY"}</span></div>
            {project ? <><div className="language-list">{Object.entries(project.languages).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => <div key={name}><span>{name}</span><strong>{count}</strong></div>)}</div><form className="project-search" onSubmit={searchProject}><label htmlFor="project-query">Search indexed source</label><div><input id="project-query" value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="function, route, keyword…" /><button type="submit" aria-label="Search project"><Icon name="search" /></button></div></form>{matches.length > 0 && <div className="search-results">{matches.slice(0, 5).map((match) => <p key={`${match.path}:${match.line}`}><code>{match.path}:{match.line}</code><span>{match.preview}</span></p>)}</div>}</> : <div className="index-empty"><Icon name="database" /><p>No generated index yet.</p><span>Click Build index to create .ssh-nexus/index.json</span></div>}
          </div>
        </section>

        <footer className="page-footer"><span>SSH NEXUS / v0.1.0</span><span>MCP over stdio + Streamable HTTP</span></footer>
      </main>

      <div className="sr-only" aria-live="polite">{notice}</div>
      {terminalHost && <Suspense fallback={<div className="modal-backdrop"><div className="modal-loading">Loading terminal…</div></div>}><TerminalModal alias={terminalHost} onClose={closeTerminal} /></Suspense>}
      {agentOpen && <AgentModal configs={clientConfigs} onClose={closeAgents} />}
      {editorHost !== undefined && <HostEditorModal host={editorHost} onClose={closeEditor} onSave={saveManagedHost} />}
    </div>
  );
}
