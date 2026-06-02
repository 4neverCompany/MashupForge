'use client';

import { motion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';

export interface HeroProps {
  /** href for the primary CTA — typically /app or an anchor to the app route */
  ctaHref?: string;
  /** Optional onClick — overrides href navigation when provided (e.g. router.push) */
  onCtaClick?: () => void;
}

export function Hero({ ctaHref = '/studio', onCtaClick }: HeroProps) {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden bg-[#050505] px-6 pt-28 pb-24 sm:pt-36 sm:pb-32 lg:pt-44 lg:pb-40"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute left-1/2 top-1/3 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#00e6ff]/10 blur-[140px]" />
        <div className="absolute right-[-10%] top-[10%] h-[360px] w-[360px] rounded-full bg-[#c5a062]/10 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #c5a062 1px, transparent 1px), linear-gradient(to bottom, #c5a062 1px, transparent 1px)',
            backgroundSize: '64px 64px',
            maskImage:
              'radial-gradient(ellipse at center, black 40%, transparent 75%)',
          }}
        />
      </div>

      <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="inline-flex items-center gap-2 rounded-full border border-[#c5a062]/30 bg-[#c5a062]/5 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#c5a062]"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>4neverCompany · MashupForge v0.8</span>
        </motion.div>

        <motion.h1
          id="hero-heading"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05, ease: 'easeOut' }}
          className="mt-8 font-sans text-5xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl"
        >
          <span className="block">MashupForge</span>
          <span className="mt-2 block bg-gradient-to-r from-[#c5a062] via-[#e8d0a0] to-[#c5a062] bg-clip-text text-transparent">
            AI-Powered Creative Crossover Studio
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
          className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg"
        >
          Generate, caption, and schedule crossover art from the universes you
          love — ideas in, post-ready content out. One pipeline, zero busywork.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25, ease: 'easeOut' }}
          className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4"
        >
          <a
            href={ctaHref}
            onClick={
              onCtaClick
                ? (e) => {
                    e.preventDefault();
                    onCtaClick();
                  }
                : undefined
            }
            className="group inline-flex items-center gap-2 rounded-xl bg-[#00e6ff] px-6 py-3.5 text-sm font-bold text-[#050505] shadow-[0_0_32px_rgba(0,230,255,0.35)] transition-all duration-200 hover:bg-[#33eaff] hover:shadow-[0_0_48px_rgba(0,230,255,0.55)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e6ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505] active:bg-[#00b8cc]"
          >
            Launch Studio
            <ArrowRight
              className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </a>

          <a
            href="#features"
            className="inline-flex items-center gap-2 rounded-xl border border-[#c5a062]/50 px-6 py-3.5 text-sm font-semibold text-[#c5a062] transition-all duration-200 hover:border-[#c5a062] hover:bg-[#c5a062]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c5a062] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
          >
            See what it does
          </a>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-10 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-600"
        >
          Leonardo.ai · pi.dev (GLM) · Next.js 16 · Tauri 2
        </motion.p>
      </div>
    </section>
  );
}

export default Hero;
