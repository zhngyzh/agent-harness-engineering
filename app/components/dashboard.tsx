import { Card, Stat } from "./ui";

export function Dashboard() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="text-sm text-gray-500 mt-1">
          Agent Harness Engineering Platform — overview
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card title="Active Agents">
          <Stat label="Running" value={3} accent />
        </Card>
        <Card title="Sessions">
          <Stat label="Total" value={47} />
        </Card>
        <Card title="Skills Loaded">
          <Stat label="Available" value={12} accent />
        </Card>
        <Card title="Eval Score">
          <Stat label="Pass@1" value="87.3%" accent />
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="System Architecture">
          <div className="space-y-2 text-sm">
            <ArchItem label="Core" desc="Agent Loop · Tool Registry · Session · Types" />
            <ArchItem label="Context" desc="Builder · Compaction · Layers · Cache · Bootstrap" />
            <ArchItem label="Intelligence" desc="Memory · Skills · Workspace" />
            <ArchItem label="Channels" desc="CLI · WebSocket Gateway · Base" />
            <ArchItem label="Delivery" desc="Queue · Resilience · Retry" />
            <ArchItem label="Concurrency" desc="Lanes · Heartbeat · Cron" />
            <ArchItem label="Collaboration" desc="Subagent · Team · Protocols · Autonomous" />
            <ArchItem label="Evolution" desc="Self-Review · Skill Gen · Memory Scan · Nudge" />
            <ArchItem label="Evaluation" desc="Graders · Metrics · Sampler" />
            <ArchItem label="Security" desc="Permissions · Injection · Hooks · Sandbox" />
            <ArchItem label="Observability" desc="Tracing · Events · Logger" />
          </div>
        </Card>

        <Card title="Design Principles">
          <div className="space-y-3 text-sm">
            <Principle
              num={1}
              text="Harness > Model — Stability from peripheral engineering"
            />
            <Principle
              num={2}
              text="Context 5-layer separation — Resident / On-demand / Runtime / Memory / System"
            />
            <Principle
              num={3}
              text="Deterministic logic stays out of context — Hooks and code over prompts"
            />
            <Principle
              num={4}
              text="Skills = Knowledge injection — YAML frontmatter + Markdown, loaded on demand"
            />
            <Principle
              num={5}
              text="Three-layer compaction — Micro (per-turn) / Auto (threshold) / Manual"
            />
            <Principle
              num={6}
              text="ACI tool design — Goal-oriented with structured errors and suggestions"
            />
            <Principle
              num={7}
              text="Dual-path self-evolution — Skill generation + RL training data collection"
            />
            <Principle
              num={8}
              text="Pre-write security scanning — Memory/skills scanned before write, auto-rollback"
            />
            <Principle
              num={9}
              text="Event stream architecture — Publish once, multiple consumers"
            />
            <Principle
              num={10}
              text="Evaluate before optimizing — First failure = first test case"
            />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Security Layers">
          <div className="space-y-2 text-sm">
            <LayerItem name="Permission Engine" status="active" />
            <LayerItem name="Injection Defense (3-layer)" status="active" />
            <LayerItem name="Hook System (6 lifecycle points)" status="active" />
            <LayerItem name="Sandbox Isolation" status="active" />
            <LayerItem name="Audit Logging (JSONL)" status="active" />
          </div>
        </Card>

        <Card title="Recent Activity">
          <div className="space-y-2 text-sm">
            <ActivityItem
              time="14:32"
              text="Session sess-042 completed — 23 turns"
            />
            <ActivityItem
              time="14:28"
              text="Skill 'code-review' loaded for session"
            />
            <ActivityItem
              time="14:15"
              text="Eval run eval-007 — Pass@1: 91.2%"
            />
            <ActivityItem
              time="13:58"
              text="Self-review completed — 2 nudges generated"
            />
            <ActivityItem
              time="13:40"
              text="Subagent sub-003 claimed task from board"
            />
          </div>
        </Card>

        <Card title="Quick Links">
          <div className="space-y-2 text-sm">
            <QuickLink href="/agents" label="Manage Agents" />
            <QuickLink href="/sessions" label="Browse Sessions" />
            <QuickLink href="/skills" label="Skill Library" />
            <QuickLink href="/eval" label="Run Evaluation" />
          </div>
        </Card>
      </div>
    </div>
  );
}

function ArchItem({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-emerald-400 font-mono w-28 shrink-0">{label}</span>
      <span className="text-gray-500">—</span>
      <span className="text-gray-400">{desc}</span>
    </div>
  );
}

function Principle({ num, text }: { num: number; text: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-600 font-mono w-4 shrink-0">{num}.</span>
      <span className="text-gray-400">{text}</span>
    </div>
  );
}

function LayerItem({ name, status }: { name: string; status: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{name}</span>
      <span className="text-emerald-400 text-xs">{status}</span>
    </div>
  );
}

function ActivityItem({ time, text }: { time: string; text: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-600 font-mono w-12 shrink-0">{time}</span>
      <span className="text-gray-400">{text}</span>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="block text-emerald-400 hover:text-emerald-300 transition-colors"
    >
      → {label}
    </a>
  );
}
