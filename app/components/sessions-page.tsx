import { Card, Table, ProgressBar } from "./ui";

export function SessionsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Sessions</h2>
        <p className="text-sm text-gray-500 mt-1">
          Browse and inspect agent sessions
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card title="Total Sessions">
          <div className="text-3xl font-bold text-white">47</div>
        </Card>
        <Card title="Active">
          <div className="text-3xl font-bold text-emerald-400">3</div>
        </Card>
        <Card title="Avg Turns">
          <div className="text-3xl font-bold text-white">18.4</div>
        </Card>
        <Card title="Compactions">
          <div className="text-3xl font-bold text-amber-400">12</div>
        </Card>
      </div>

      <Card title="Active Sessions">
        <Table
          headers={["ID", "Agent", "Turns", "Context", "Compactions", "Last Active"]}
          rows={[
            [
              <code className="text-xs text-gray-500">sess-042</code>,
              "Main Agent",
              23,
              <ProgressBar value={67} max={100} />,
              1,
              "2 min ago",
            ],
            [
              <code className="text-xs text-gray-500">sess-043</code>,
              "Code Review",
              8,
              <ProgressBar value={24} max={100} />,
              0,
              "5 min ago",
            ],
            [
              <code className="text-xs text-gray-500">sess-041</code>,
              "Main Agent",
              45,
              <ProgressBar value={89} max={100} />,
              3,
              "1 hr ago",
            ],
          ]}
        />
      </Card>

      <Card title="Session Architecture">
        <div className="space-y-3 text-sm text-gray-400">
          <p>
            Sessions are persisted as JSONL files with automatic compaction.
            Context is managed through a 5-layer model with progressive loading.
          </p>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs text-gray-500 mb-2">Persistence</div>
              <div className="space-y-1">
                <div>Format: JSONL</div>
                <div>Location: workspace/sessions/</div>
                <div>Atomic writes: tmp + rename</div>
              </div>
            </div>
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs text-gray-500 mb-2">Compaction</div>
              <div className="space-y-1">
                <div>Micro: Per-turn cleanup</div>
                <div>Auto: Threshold-based</div>
                <div>Manual: User-triggered</div>
              </div>
            </div>
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs text-gray-500 mb-2">Context Layers</div>
              <div className="space-y-1">
                <div>Resident: Always loaded</div>
                <div>On-demand: @-syntax injection</div>
                <div>Runtime: Turn-specific</div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
