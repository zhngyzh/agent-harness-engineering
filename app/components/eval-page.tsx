import { Card, Badge, Table } from "./ui";

export function EvalPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Evaluation</h2>
        <p className="text-sm text-gray-500 mt-1">
          Run and monitor agent evaluations
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card title="Total Runs">
          <div className="text-3xl font-bold text-white">28</div>
        </Card>
        <Card title="Pass@1">
          <div className="text-3xl font-bold text-emerald-400">87.3%</div>
        </Card>
        <Card title="Pass@3">
          <div className="text-3xl font-bold text-emerald-400">94.1%</div>
        </Card>
        <Card title="Avg MRR">
          <div className="text-3xl font-bold text-white">0.91</div>
        </Card>
      </div>

      <Card title="Recent Eval Runs">
        <Table
          headers={["ID", "Task Type", "Pass@1", "Pass@3", "Samples", "Date"]}
          rows={[
            [
              <code key="id" className="text-xs text-gray-500">eval-007</code>,
              "code-generation",
              <Badge key="p1" variant="success">91.2%</Badge>,
              <Badge key="p3" variant="success">96.5%</Badge>,
              50,
              "2026-05-03",
            ],
            [
              <code key="id" className="text-xs text-gray-500">eval-006</code>,
              "debugging",
              <Badge key="p1" variant="success">88.0%</Badge>,
              <Badge key="p3" variant="success">93.0%</Badge>,
              30,
              "2026-05-02",
            ],
            [
              <code key="id" className="text-xs text-gray-500">eval-005</code>,
              "code-review",
              <Badge key="p1" variant="success">92.5%</Badge>,
              <Badge key="p3" variant="success">97.0%</Badge>,
              40,
              "2026-05-02",
            ],
            [
              <code key="id" className="text-xs text-gray-500">eval-004</code>,
              "refactoring",
              <Badge key="p1" variant="warning">78.3%</Badge>,
              <Badge key="p3" variant="success">89.1%</Badge>,
              25,
              "2026-05-01",
            ],
            [
              <code key="id" className="text-xs text-gray-500">eval-003</code>,
              "documentation",
              <Badge key="p1" variant="success">85.0%</Badge>,
              <Badge key="p3" variant="success">92.0%</Badge>,
              35,
              "2026-05-01",
            ],
          ]}
        />
      </Card>

      <Card title="Grader Architecture">
        <div className="space-y-3 text-sm text-gray-400">
          <p>
            Three-level grader cascade: L1 deterministic (exact/regex/schema) → L2
            heuristic (rubric-based) → L3 LLM-as-Judge. Metrics include Pass@k,
            Pass^k, and MRR with Wilson score confidence intervals.
          </p>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs text-gray-500 mb-2">L1: Deterministic</div>
              <div className="space-y-1">
                <div>Exact match</div>
                <div>Regex match</div>
                <div>JSON schema validation</div>
              </div>
            </div>
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs text-gray-500 mb-2">L2: Heuristic</div>
              <div className="space-y-1">
                <div>Rubric-based scoring</div>
                <div>Weighted criteria</div>
                <div>Partial credit</div>
              </div>
            </div>
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs text-gray-500 mb-2">L3: LLM-as-Judge</div>
              <div className="space-y-1">
                <div>Qualitative assessment</div>
                <div>Complex reasoning tasks</div>
                <div>Most expensive, least used</div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
