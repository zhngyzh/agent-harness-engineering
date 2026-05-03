import { Card, Badge, Table } from "./ui";

export function AgentsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Agents</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage and monitor agent instances
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Total Agents">
          <div className="text-3xl font-bold text-white">3</div>
        </Card>
        <Card title="Active">
          <div className="text-3xl font-bold text-emerald-400">2</div>
        </Card>
        <Card title="Idle">
          <div className="text-3xl font-bold text-amber-400">1</div>
        </Card>
      </div>

      <Card title="Agent Instances">
        <Table
          headers={["ID", "Name", "Model", "Status", "Lane", "Session"]}
          rows={[
            [
              <code className="text-xs text-gray-500">agent-001</code>,
              "Main Agent",
              "claude-sonnet-4-6",
              <Badge variant="success">active</Badge>,
              "default",
              "sess-042",
            ],
            [
              <code className="text-xs text-gray-500">agent-002</code>,
              "Subagent: Code Review",
              "claude-sonnet-4-6",
              <Badge variant="success">active</Badge>,
              "subagent",
              "sess-043",
            ],
            [
              <code className="text-xs text-gray-500">agent-003</code>,
              "Subagent: Eval Runner",
              "claude-haiku-4-5",
              <Badge variant="warning">idle</Badge>,
              "eval",
              "—",
            ],
          ]}
        />
      </Card>

      <Card title="Architecture">
        <div className="space-y-3 text-sm text-gray-400">
          <p>
            Agents run in isolated lanes with dedicated session contexts. The main
            agent orchestrates subagents for parallel task execution.
          </p>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs text-gray-500 mb-2">Lane Assignment</div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>default</span>
                  <span className="text-emerald-400">Main Agent</span>
                </div>
                <div className="flex justify-between">
                  <span>subagent</span>
                  <span className="text-emerald-400">Code Review</span>
                </div>
                <div className="flex justify-between">
                  <span>eval</span>
                  <span className="text-amber-400">Eval Runner</span>
                </div>
              </div>
            </div>
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs text-gray-500 mb-2">Concurrency Model</div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>Named Lanes</span>
                  <span className="text-gray-300">3 active</span>
                </div>
                <div className="flex justify-between">
                  <span>Generation Tracking</span>
                  <span className="text-gray-300">gen-1</span>
                </div>
                <div className="flex justify-between">
                  <span>Queue Depth</span>
                  <span className="text-gray-300">0 pending</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
