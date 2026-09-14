import { useGBStore } from '@/store/useGBStore';
import BatchListView from '@/components/groupbuy/BatchListView';
import BatchDetailView, { GBModals } from '@/components/groupbuy/BatchDetailView';
import GBToast from '@/components/groupbuy/GBToast';

export default function GroupBuyPage() {
  const selectedBatchId = useGBStore((s) => s.ui.selectedBatchId);
  return (
    <div className="space-y-1">
      {selectedBatchId ? <BatchDetailView batchId={selectedBatchId} /> : <BatchListView />}
      <GBModals />
      <GBToast />
    </div>
  );
}
