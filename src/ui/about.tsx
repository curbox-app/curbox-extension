import type { ReactNode } from "react";
import { btnPrimary, btnOutline } from "./components";

const LINKS = {
  discord: "https://discord.com/invite/Vs9mwUtuCN",
  donate: "https://curbox.app/donate",
  android: "https://curbox.app/install-android",
  github: "https://github.com/curbox-app",
  instagram: "https://instagram.com/curb.me",
};

function ArrowLink({ href, children, className }: { href: string; children: ReactNode; className: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={className}>
      {children}
    </a>
  );
}

export function AboutPanel() {
  return (
    <div className="flex flex-col gap-6">
      <section className="card p-6">
        <p className="label mb-3">About the Developer</p>
        <p className="text-sm leading-relaxed text-ink">
          Hey, I'm Nethical, the person behind Curbox. I'm 18, fresh out of high school, and a little obsessed
          with tech, art, and building cool things from scratch. A while back I went looking for a free app
          blocker that actually did what I wanted. Nothing came close, so I built my own. Curbox is that app,
          and I've been pouring into it almost every day for over two years now. So happy you're here. I hope it
          helps you take your time back.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <ArrowLink href={LINKS.github} className={btnOutline}>
            View on GitHub ↗
          </ArrowLink>
          <ArrowLink href={LINKS.instagram} className={btnOutline}>
            Follow Curbox · @curb.me
          </ArrowLink>
        </div>
      </section>

      <section className="card p-6">
        <p className="label mb-3">Join the Focus Pack</p>
        <p className="text-sm leading-relaxed text-muted">
          Don't fix your screen time alone. Join our Discord of like minded people holding each other accountable
          and sharing focus strategies to improve themselves.
        </p>
        <div className="mt-5">
          <ArrowLink href={LINKS.discord} className={btnPrimary}>
            Join the Discord
          </ArrowLink>
        </div>
      </section>

      <section className="card p-6">
        <p className="label mb-3">Donate</p>
        <p className="text-sm leading-relaxed text-muted">
          I've put 1500+ hours into Curbox, building it alongside school, exams and study, to save millions of
          minutes worldwide. Donate to help me keep it free and growing for everyone.
        </p>
        <div className="mt-5">
          <ArrowLink href={LINKS.donate} className={btnPrimary}>
            Donate ❤
          </ArrowLink>
        </div>
        <p className="mt-4 text-xs text-faint">Cannot donate? Sharing the project is helpful too!</p>
      </section>

      <section className="card flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label mb-2">Curbox for Android</p>
          <p className="text-sm text-muted">The original app, where Curbox began.</p>
        </div>
        <ArrowLink href={LINKS.android} className={btnOutline}>
          Get the app ↗
        </ArrowLink>
      </section>
    </div>
  );
}
