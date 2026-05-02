'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationSummary } from '@/lib/chat-types';

const CONVERSATIONS_QUERY_KEY = ['conversations'] as const;

async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await fetch('/api/conversations');
  if (!res.ok) {
    // If unauthorized (not logged in), return empty array instead of throwing
    if (res.status === 401) return [];
    throw new Error(`Failed to fetch conversations: ${res.status}`);
  }
  const data = await res.json();
  // The API returns { conversations: [...] } — unwrap the array
  const raw: Array<Record<string, unknown>> = Array.isArray(data) ? data : (data.conversations ?? []);
  // Map snake_case API fields to camelCase ConversationSummary
  return raw.map((c) => ({
    id: c.id as string,
    name: (c.name as string | null) ?? null,
    firstMessage: (c.first_message as string | undefined) ?? '',
    updatedAt: typeof c.updated_at === 'string' ? new Date(c.updated_at as string).getTime() : (c.updated_at as number ?? Date.now()),
    isSaved: (c.is_saved as boolean) ?? false,
  }));
}

export function useConversations(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery<ConversationSummary[]>({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: fetchConversations,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // Don't poll an auth-gated endpoint for anon users — would 401 on every cold load
    enabled: Boolean(userId),
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
