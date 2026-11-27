import Link from "next/link";
import { AuthCallbackForwarder } from "@/components/marketing/auth-callback-forwarder";
import {
  ArrowRight,
  Cloud,
  Database,
  FileText,
  FolderKanban,
  GitBranch,
  HardDrive,
  Lock,
  Mail,
  Monitor,
  ShieldCheck,
  Sparkles,
  Users,
  WifiOff,
} from "lucide-react";

const FEATURES = [
  {
    icon: WifiOff,
    title: "Local-First Sync Engine",
    body: "Every keystroke writes immediately to local IndexedDB so notes stay responsive offline and reconcile automatically once reconnected.",
  },
  {
    icon: Users,
    title: "Shared Team Workspaces",
    body: "Separate personal writing from shared team workspaces with role-based access, invitation management, and granular per-note grants.",
  },
  {
    icon: ShieldCheck,
    title: "Defense-in-Depth Security",
    body: "PostgreSQL Row-Level Security isolates every tenant row, paired with SHA-256 PIN-locked notes, strict CSP headers, and zero third-party trackers.",
  },
  {
    icon: FileText,
    title: "Rich Editor & Private Media",
    body: "Write with Markdown shortcuts, checklists, tables, code blocks, voice notes, and 25 MB attachments delivered through short-lived signed URLs.",
  },
  {
    icon: Sparkles,
    title: "Bring-Your-Own-Key AI",
    body: "Summarize and structure long notes directly from your browser using any OpenAI-compatible inference endpoint—keys stay strictly on device.",
  },
  {
    icon: Monitor,
    title: "Web PWA & Native Desktop",
    body: "Run from any mobile or desktop browser as an installable PWA, or use the native Rust/Tauri Windows client with automatic local disk backups.",
  },
] as const;

const ARCHITECTURE_PILLARS = [
  {
    icon: HardDrive,
    label: "Client Persistence",
    title: "IndexedDB + Outbox Queue",
    detail:
      "Dexie-backed local cache and deterministic outbox queue guarantee zero-latency editing and reliable offline conflict resolution.",
  },
  {
    icon: Database,
    label: "Data & Auth Layer",
    title: "PostgreSQL with Strict RLS",
    detail:
      "Every table—notes, workspaces, grants, shares, and attachment metadata—is governed by row-level policies verified on every query.",
  },
  {
    icon: Cloud,
    label: "Cloud Scaling Roadmap",
    title: "Multi-Region Cloud Infrastructure",
    detail:
      "Designed for Asia-Pacific cloud deployment with managed PostgreSQL, object storage for encrypted media, edge caching, and scalable AI inference.",
  },
] as const;

const PLANS = [
  {
    name: "Personal",
    price: "$0",
    cadence: "free & open source",
    description: "Everything an individual engineer or writer needs across web and desktop.",
    ctaLabel: "Open Web Workspace",
    ctaHref: "/app",
    featured: false,
    items: [
      "Unlimited local-first notes & nested folders",
      "Real-time multi-device cloud sync",
      "PIN-locked private notes & JSON export",
      "Installable PWA + Windows desktop client",
    ],
  },
  {
    name: "Team Workspace",
    price: "Early Access",
    cadence: "for small product & engineering teams",
    description: "Collaborative workspaces with row-level tenant isolation and shared collections.",
    ctaLabel: "Launch Team Workspace",
    ctaHref: "/app",
    featured: true,
    items: [
      "Shared workspaces with member invitations",
      "Per-note read/edit grants & revocable links",
      "Private attachment & voice-note storage",
      "BYOK AI summaries with zero server key storage",
    ],
  },
  {
    name: "Self-Hosted",
    price: "MIT",
    cadence: "deploy on your own cloud",
    description: "Full source code and database migrations for organizations requiring strict data residency.",
    ctaLabel: "Explore Repository",
    ctaHref: "https://github.com/aplatogg/tether-notes",
    featured: false,
    items: [
      "Auditable Next.js, TypeScript & Rust source",
      "Versioned PostgreSQL schema & RLS migrations",
      "Strict nonce-based CSP & SHA-256 desktop builds",
      "No vendor lock-in or telemetry dependencies",
    ],
  },
] as const;

export function LandingPage() {
  return (
    <div className="landing-shell">
      <AuthCallbackForwarder />
      <header className="landing-nav-wrap">
        <div className="landing-container landing-nav">
          <Link className="brand-lockup landing-brand" href="/">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
            </span>
            <span>Tether Notes</span>
          </Link>

          <nav className="landing-nav-links" aria-label="Primary navigation">
            <a href="#product">Product</a>
            <a href="#architecture">Architecture</a>
            <a href="#plans">Plans</a>
            <a href="#about">Company</a>
            <Link href="/privacy">Privacy</Link>
          </nav>

          <div className="landing-nav-actions">
            <Link className="secondary-button landing-btn-sm" href="/app">
              Sign in
            </Link>
            <Link className="primary-button landing-btn-sm" href="/app">
              Open App
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-container landing-hero-grid">
            <div className="landing-hero-copy">
              <p className="landing-eyebrow">
                <span>Tether Notes Software</span>
                <span aria-hidden="true">·</span>
                <span>v0.4 · Web PWA &amp; Windows Desktop</span>
              </p>
              <h1>Local-first notes and team workspaces, engineered for speed and privacy.</h1>
              <p className="landing-lead">
                Tether Notes is a modern knowledge workspace built for developers, researchers, and
                distributed teams. Write offline in local storage, sync changes in real time across
                devices, and protect sensitive documentation with row-level security and PIN locks.
              </p>
              <div className="landing-cta-row">
                <Link className="primary-button landing-btn-lg" href="/app">
                  Launch Web Workspace
                  <ArrowRight aria-hidden="true" />
                </Link>
                <a
                  className="secondary-button landing-btn-lg"
                  href="https://github.com/aplatogg/tether-notes"
                  target="_blank"
                  rel="noreferrer"
                >
                  <GitBranch aria-hidden="true" />
                  View Source on GitHub
                </a>
              </div>
              <dl className="landing-metrics">
                <div>
                  <dt>Storage Model</dt>
                  <dd>Local-First</dd>
                </div>
                <div>
                  <dt>Access Control</dt>
                  <dd>PostgreSQL RLS</dd>
                </div>
                <div>
                  <dt>Platforms</dt>
                  <dd>Web · iOS · Windows</dd>
                </div>
              </dl>
            </div>

            <div className="landing-mockup" aria-label="Tether Notes workspace preview">
              <div className="landing-mockup-bar">
                <div className="landing-mockup-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="landing-mockup-url">tethernotes.me/app</span>
                <span className="landing-sync-pill">Synced · Offline-ready</span>
              </div>
              <div className="landing-mockup-body">
                <aside className="landing-mockup-side">
                  <div className="landing-mockup-group">WORKSPACES</div>
                  <div className="landing-mockup-item is-active">
                    <FolderKanban aria-hidden="true" />
                    <span>Product Engineering</span>
                  </div>
                  <div className="landing-mockup-item">
                    <FileText aria-hidden="true" />
                    <span>Personal Notes</span>
                  </div>
                  <div className="landing-mockup-item">
                    <Users aria-hidden="true" />
                    <span>Shared With Me</span>
                  </div>
                  <div className="landing-mockup-group">SECURITY</div>
                  <div className="landing-mockup-item">
                    <Lock aria-hidden="true" />
                    <span>Locked Vault (3)</span>
                  </div>
                </aside>
                <div className="landing-mockup-editor">
                  <div className="landing-mockup-tags">
                    <span>#architecture</span>
                    <span>#cloud-sync</span>
                    <span>#q4-roadmap</span>
                  </div>
                  <h2>Asia-Pacific Cloud Sync Migration Plan</h2>
                  <p>
                    Local IndexedDB outbox flushes deterministic diffs to managed PostgreSQL
                    instances while object storage serves encrypted media via signed URLs.
                  </p>
                  <ul className="landing-mockup-checks">
                    <li className="is-done">Row-level security enforced across all 7 tables</li>
                    <li className="is-done">Strict nonce CSP &amp; SHA-256 Tauri desktop bundle</li>
                    <li>Regional cloud compute &amp; AI summary endpoint rollout</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="product" className="landing-section">
          <div className="landing-container">
            <div className="landing-section-head">
              <p className="landing-kicker">Product Capabilities</p>
              <h2>Built for fast daily capture and reliable team knowledge management.</h2>
              <p>
                No bloated block wrappers or opaque lock-in. Tether Notes pairs a crisp editing
                surface with a resilient sync architecture.
              </p>
            </div>
            <div className="landing-feature-grid">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article key={feature.title} className="landing-card">
                    <div className="landing-card-icon">
                      <Icon aria-hidden="true" />
                    </div>
                    <h3>{feature.title}</h3>
                    <p>{feature.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="architecture" className="landing-section landing-section-alt">
          <div className="landing-container">
            <div className="landing-section-head">
              <p className="landing-kicker">Architecture &amp; Security</p>
              <h2>Designed from the ground up for resilient cloud-backed operation.</h2>
              <p>
                Our infrastructure separates fast client-side writing from verifiable cloud
                persistence, making Tether Notes dependable on unstable connections and ready for
                regional cloud scale.
              </p>
            </div>
            <div className="landing-arch-grid">
              {ARCHITECTURE_PILLARS.map((pillar) => {
                const Icon = pillar.icon;
                return (
                  <article key={pillar.title} className="landing-arch-card">
                    <div className="landing-arch-meta">
                      <Icon aria-hidden="true" />
                      <span>{pillar.label}</span>
                    </div>
                    <h3>{pillar.title}</h3>
                    <p>{pillar.detail}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="plans" className="landing-section">
          <div className="landing-container">
            <div className="landing-section-head">
              <p className="landing-kicker">Plans &amp; Editions</p>
              <h2>Start free on web or desktop, scale with your team.</h2>
              <p>
                Core personal note-taking stays open and free. Team collaboration and managed cloud
                deployments are actively expanding.
              </p>
            </div>
            <div className="landing-plan-grid">
              {PLANS.map((plan) => (
                <article
                  key={plan.name}
                  className={plan.featured ? "landing-plan-card is-featured" : "landing-plan-card"}
                >
                  <div className="landing-plan-top">
                    <h3>{plan.name}</h3>
                    <p className="landing-plan-price">{plan.price}</p>
                    <p className="landing-plan-cadence">{plan.cadence}</p>
                    <p className="landing-plan-desc">{plan.description}</p>
                  </div>
                  <ul className="landing-plan-list">
                    {plan.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {plan.ctaHref.startsWith("http") ? (
                    <a
                      className="secondary-button landing-plan-cta"
                      href={plan.ctaHref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {plan.ctaLabel}
                    </a>
                  ) : (
                    <Link
                      className={
                        plan.featured
                          ? "primary-button landing-plan-cta"
                          : "secondary-button landing-plan-cta"
                      }
                      href={plan.ctaHref}
                    >
                      {plan.ctaLabel}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="about" className="landing-section landing-section-alt">
          <div className="landing-container landing-about-grid">
            <div>
              <p className="landing-kicker">About Tether Notes</p>
              <h2>An independent software studio focused on durable local-first tools.</h2>
              <p className="landing-about-copy">
                Tether Notes is developed and operated as a dedicated productivity software
                initiative headquartered in Indonesia, serving developers and small teams globally.
                Our mission is to build lightweight, privacy-first cloud workspaces that keep users
                in full control of their knowledge—online or offline.
              </p>
              <p className="landing-about-copy">
                We are actively scaling our cloud backend, object storage, and real-time sync
                infrastructure across Asia-Pacific to support larger collaborative workspaces and
                low-latency AI assistance.
              </p>
            </div>
            <aside className="landing-contact-card" aria-label="Company and contact details">
              <h3>Official Project Details</h3>
              <dl className="landing-contact-list">
                <div>
                  <dt>Organization</dt>
                  <dd>Tether Notes Studio</dd>
                </div>
                <div>
                  <dt>Official Website</dt>
                  <dd>
                    <a href="https://tethernotes.me">https://tethernotes.me</a>
                  </dd>
                </div>
                <div>
                  <dt>Business &amp; Support</dt>
                  <dd>
                    <a href="mailto:hello@tethernotes.me">
                      <Mail aria-hidden="true" />
                      hello@tethernotes.me
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>Open Source Repository</dt>
                  <dd>
                    <a
                      href="https://github.com/aplatogg/tether-notes"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <GitBranch aria-hidden="true" />
                      github.com/aplatogg/tether-notes
                    </a>
                  </dd>
                </div>
              </dl>
            </aside>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <div className="landing-footer-brand">
            <div className="brand-lockup">
              <span className="brand-mark" aria-hidden="true">
                <span />
                <span />
              </span>
              <span>Tether Notes</span>
            </div>
            <p>© {new Date().getFullYear()} Tether Notes Studio. Local-first notes &amp; workspaces.</p>
          </div>
          <div className="landing-footer-links">
            <Link href="/app">Web Workspace</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <a href="mailto:hello@tethernotes.me">Contact</a>
            <a
              href="https://github.com/aplatogg/tether-notes"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
