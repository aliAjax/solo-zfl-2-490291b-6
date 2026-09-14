import { Link } from 'react-router-dom';
import { Keyboard, ArrowLeft } from 'lucide-react';

export default function GroupBuyHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-700/60 bg-ink-900/85 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="keycap !h-10 !w-10 !min-w-[40px] !rounded-lg !text-base">
            <Keyboard className="h-5 w-5" />
          </div>
          <div className="flex flex-col leading-tight">
            <h1 className="font-mono text-lg font-bold tracking-tight text-gradient-brass">
              GroupBuy Desk
            </h1>
            <p className="font-mono text-[11px] text-ink-500">键 · 帽 · 团 · 购</p>
          </div>
        </div>
        <Link to="/" className="btn-ghost text-xs">
          <ArrowLeft className="h-3.5 w-3.5" />
          返回手感日志
        </Link>
      </div>
    </header>
  );
}
