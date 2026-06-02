'use client';

import { Globe } from 'lucide-react';

// Lucide 1.8.0 (this project's version) does not ship brand icons,
// so GitHub is inlined. Path from simple-icons (CC0).
function GithubMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.95 3.21 9.15 7.66 10.63.56.1.77-.24.77-.54 0-.27-.01-1.16-.02-2.11-3.12.68-3.78-1.32-3.78-1.32-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.73 1.16 1.73 1.16 1 .71 2.63 1.21 3.27.93.1-.72.39-1.21.7-1.49-2.49-.28-5.11-1.24-5.11-5.52 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.95 0 0 .94-.3 3.07 1.15.89-.25 1.84-.37 2.79-.37.95 0 1.9.12 2.79.37 2.13-1.45 3.07-1.15 3.07-1.15.61 1.53.23 2.67.11 2.95.72.78 1.15 1.78 1.15 3 0 4.29-2.62 5.24-5.12 5.51.4.35.76 1.03.76 2.08 0 1.5-.01 2.71-.01 3.08 0 .3.2.65.78.54 4.44-1.48 7.65-5.68 7.65-10.63C23.25 5.48 18.27.5 12 .5z" />
    </svg>
  );
}

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

const COLUMNS: Array<{ heading: string; links: FooterLink[] }> = [
  {
    heading: 'Product',
    links: [
      { label: 'Launch Studio', href: '/studio' },
      { label: 'Features', href: '#features' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      {
        label: 'GitHub',
        href: 'https://github.com/Code4neverCompany/MashupForge',
        external: true,
      },
      {
        label: 'Leonardo.ai',
        href: 'https://leonardo.ai',
        external: true,
      },
      {
        label: 'pi.dev',
        href: 'https://pi.dev',
        external: true,
      },
    ],
  },
  {
    heading: 'Company',
    links: [
      {
        label: '4neverCompany',
        href: 'https://4nevercompany.com',
        external: true,
      },
      { label: 'Contact', href: 'mailto:hello@4nevercompany.com' },
    ],
  },
];

export function Footer() {
  return (
    <footer
      aria-labelledby="footer-heading"
      className="relative bg-[#050505] px-6 pt-16 pb-10"
    >
      <h2 id="footer-heading" className="sr-only">
        Footer
      </h2>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#c5a062]/25 to-transparent"
      />

      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#c5a062]/40 bg-[#c5a062]/10"
              >
                <span className="font-mono text-sm font-bold text-[#c5a062]">
                  4N
                </span>
              </div>
              <div>
                <div className="font-sans text-sm font-semibold tracking-tight text-white">
                  MashupForge
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  by 4neverCompany
                </div>
              </div>
            </div>

            <p className="mt-5 max-w-sm text-sm leading-relaxed text-zinc-400">
              An AI creative studio for crossover art. Local-first, brand-safe,
              and built to ship on a schedule.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[#c5a062]">
                {col.heading}
              </h3>
              <ul role="list" className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(link.external
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                      className="text-sm text-zinc-400 transition-colors duration-200 hover:text-[#00e6ff] focus:outline-none focus-visible:text-[#00e6ff] focus-visible:underline"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-[#c5a062]/15 pt-6 sm:flex-row sm:items-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-600">
            © {new Date().getFullYear()} 4neverCompany · Agency Black · Metallic Gold · Electric Blue
          </p>

          <div className="flex items-center gap-3">
            <a
              href="https://github.com/4nevercompany"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="4neverCompany on GitHub"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#c5a062]/20 text-zinc-400 transition-colors duration-200 hover:border-[#c5a062]/50 hover:text-[#c5a062] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c5a062] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
            >
              <GithubMark className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href="https://4nevercompany.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="4neverCompany website"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#c5a062]/20 text-zinc-400 transition-colors duration-200 hover:border-[#c5a062]/50 hover:text-[#c5a062] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c5a062] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
            >
              <Globe className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
