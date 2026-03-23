'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationSummary } from '@/lib/chat-types';

const CONVERSATIONS_QUERY_KEY = ['conversations'] as const;

async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await fetch('/api/conversations');
  if (!res.ok) {
    throw new Error(`Failed to fetch conversations: ${res.status}`);
  }
  return res.json();
}

export function useConversations() {
  const queryClient = useQueryClient();

  const query = useQuery<ConversationSummary[]>({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: fetchConversations,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  /** Manually invalidate the conversation list (e.g. after saving a search) */
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
  }

  return {
    conversations: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    invalidate,
  };
}

export { CONVERSATIONS_QUERY_KEY };
