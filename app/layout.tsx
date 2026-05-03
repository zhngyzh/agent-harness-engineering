import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Harness Engineering",
  description: "Production-grade Agent Harness Engineering Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <div className="flex min-h-screen">
          <nav className="w-60 bg-gray-900 border-r border-gray-800 shrink-0">
            <div className="p-4 border-b border-gray-800">
              <h1 className="text-lg font-bold text-white">🛡️ Agent Harness</h1>
              <p className="text-xs text-gray-500 mt-1">Engineering Platform</p>
            </div>
            <ul className="p-2 space-y-1">
              <NavItem href="/" label="📊 Dashboard" />
              <NavItem href="/agents" label="🤖 Agents" />
              <NavItem href="/sessions" label="💬 Sessions" />
              <NavItem href="/skills" label="🧩 Skills" />
              <NavItem href="/eval" label="📈 Evaluation" />
            </ul>
          </nav>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}

function NavItem({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a
        href={href}
        className="block px-3 py-2 rounded-md text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
      >
        {label}
      </a>
    </li>
  );
}
