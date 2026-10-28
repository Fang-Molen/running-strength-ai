import { useEffect, useState } from 'react';
import { validateVideoManifest } from '@/lib/character/identity';

/** 已审核同角色视频清单（键：`${gender}:${exerciseId}`）。清单缺失、不可用或格式不对时返回空集合，不会把动作标成已审核。 */
export function useApprovedVideos(): ReadonlySet<string> {
  const [approved, setApproved] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const controller = new AbortController();
    fetch('/fangkun-video/manifest-r6.json', { signal: controller.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok || /text\/html/i.test(response.headers.get('content-type') || '')) throw Error('审核列表不可用'); return response.json(); })
      .then((data: unknown) => { if (!controller.signal.aborted) setApproved(validateVideoManifest(data) ? new Set(data.assets.map(item => `${item.gender}:${item.exerciseId}`)) : new Set()); })
      .catch(() => { if (!controller.signal.aborted) setApproved(new Set()); });
    return () => controller.abort();
  }, []);
  return approved;
}
