import { Card, Badge, Table } from "./ui";

export function SkillsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Skills</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage and discover agent skills
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card title="Total Skills">
          <div className="text-3xl font-bold text-white">12</div>
        </Card>
        <Card title="Loaded">
          <div className="text-3xl font-bold text-emerald-400">5</div>
        </Card>
        <Card title="Drafts">
          <div className="text-3xl font-bold text-amber-400">3</div>
        </Card>
        <Card title="Auto-generated">
          <div className="text-3xl font-bold text-blue-400">2</div>
        </Card>
      </div>

      <Card title="Skill Library">
        <Table
          headers={["Name", "Version", "Status", "Source", "Description"]}
          rows={[
            [
              <span className="font-mono text-emerald-400">code-review</span>,
              "1.0.0",
              <Badge variant="success">loaded</Badge>,
              "built-in",
              "Automated code review with security scanning",
            ],
            [
              <span className="font-mono text-emerald-400">agent-builder</span>,
              "1.2.0",
              <Badge variant="success">loaded</Badge>,
              "built-in",
              "Guide for building new agent instances",
            ],
            [
              <span className="font-mono text-gray-300">test-runner</span>,
              "0.9.0",
              <Badge variant="info">available</Badge>,
              "built-in",
              "Run and analyze test suites",
            ],
            [
              <span className="font-mono text-gray-300">doc-writer</span>,
              "1.1.0",
              <Badge variant="info">available</Badge>,
              "built-in",
              "Technical documentation generation",
            ],
            [
              <span className="font-mono text-gray-300">debug-analyzer</span>,
              "0.8.0",
              <Badge variant="info">available</Badge>,
              "built-in",
              "Root cause analysis for failures",
            ],
            [
              <span className="font-mono text-amber-400">deploy-helper</span>,
              "0.1.0",
              <Badge variant="warning">draft</Badge>,
              "auto-generated",
              "Deployment automation (auto-generated from patterns)",
            ],
          ]}
        />
      </Card>

      <Card title="Skill Architecture">
        <div className="space-y-3 text-sm text-gray-400">
          <p>
            Skills use YAML frontmatter + Markdown. They follow a two-layer
            loading model: index in prompt, full content loaded on demand.
          </p>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs text-gray-500 mb-2">Loading Model</div>
              <div className="space-y-1">
                <div>Layer 1: Index in system prompt</div>
                <div>Layer 2: Full SKILL.md loaded on demand</div>
                <div>Security: Pre-load scan for injection</div>
              </div>
            </div>
            <div className="bg-gray-800/50 rounded p-3">
              <div className="text-xs text-gray-500 mb-2">Auto-Generation</div>
              <div className="space-y-1">
                <div>Pattern detection from tool sequences</div>
                <div>Review signal extraction</div>
                <div>User correction capture</div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
