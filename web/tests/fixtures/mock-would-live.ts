import type { Database } from "@/lib/types";

type WouldLiveThereRow =
  Database["public"]["Tables"]["would_live_there"]["Row"];

/** No would-live-there data in visual tests */
export const MOCK_WOULD_LIVE_THERE: WouldLiveThereRow[] = [];
