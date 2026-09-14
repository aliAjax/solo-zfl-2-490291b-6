import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from '@/pages/Home';
import GroupBuyPage from '@/pages/GroupBuyPage';
import GroupBuyHeader from '@/components/groupbuy/GroupBuyHeader';

function GroupBuyLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <GroupBuyHeader />
      <main className="container w-full flex-1 py-6 sm:py-8">
        <GroupBuyPage />
      </main>
      <footer className="mt-8 border-t border-ink-700/40 py-6">
        <div className="container flex flex-col items-center justify-between gap-3 font-mono text-xs text-ink-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="keycap !h-6 !text-[10px]">G</span>
            <span>KeyFeeling · 键帽团购与分期结算台</span>
          </div>
          <div className="flex items-center gap-4">
            <span>数据保存在本地浏览器</span>
            <span className="text-ink-600">·</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/groupbuy" element={<GroupBuyLayout />} />
      </Routes>
    </Router>
  );
}
