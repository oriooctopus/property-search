'use client';

import { useCallback, useRef, useState } from 'react';
import type { FiltersState, MaxListingAge } from '@/components/Filters';
import type { ChatMessageData, Conversation, ParsedFilter } from '@/lib/chat-types';
import { getDefaultValue } from '@/components/FilterPills';

// Utility: generate a unique ID
function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Default filters matching what page.tsx uses */
const DEFAULT_FILTERS: FiltersState = {
  sort: 'price',
  selectedBeds: null,
  minBaths: null,
  includeNaBaths: false,
  minRent: null,
  maxRent: null,
  priceMode: 'total' as const,
  maxListingAge: null as MaxListingAge,
  photosFirst: false,
  selectedSources: null,
  minYearBuilt: null,
  maxYearBuilt: null,
  minSqft: null,
  maxSqft: null,
  excludeNoSqft: false,
  minAvailableDate: null,
  maxAvailableDate: null,
  commuteRules: [],
};

interface UseConversationOptions {
  /** Called whenever filters change so the parent can update the listing view */
  onFiltersChange: (filters: FiltersState) => void;
  /** Current total matching listing count (for embedding in assistant messages) */
  getListingCount: () => number;
}

export interface UseConversationReturn {
  conversation: Conversation | null;
  messages: ChatMessageData[];
  filters: FiltersState;
  isLoading: boolean;
  sendMessage: (text: string) => Promise<boolean>;
  removeFilter: (key: keyof FiltersState) => void;
  reAddFilter: (key: keyof FiltersState, value: FiltersState[keyof FiltersState]) => void;
  saveConversation: (name: string) => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  newConversation: () => void;
}

export function useConversation({
  onFiltersChange,
  getListingCount,
}: UseConversationOptions): UseConversationReturn {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [filters, setFiltersInternal] = useState<FiltersState>(DEFAULT_FILTERS);
  const [isLoading, setIsLoading] = useState(false);

  // Keep a ref for listing count so we don't stale-close over it
  const getListingCountRef = useRef(getListingCount);
  getListingCountRef.current = getListingCount;

  const setFilters = useCallback(
    (next: FiltersState) => {
      setFiltersInternal(next);
      onFiltersChange(next);
    },
    [onFiltersChange],
  );

  const addMessage = useCallback((msg: ChatMessageData) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------
  const sendMessage = useCallback(
    async (text: string) => {
      const userMsg: ChatMessageData = {
        id: uid(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
      addMessage(userMsg);
      setIsLoading(true);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            conversationId: conversation?.id ?? null,
            currentFilters: filters,
          }),
        });

        if (!res.ok) {
          throw new Error(`Chat API returned ${res.status}`);
        }

        const data = await res.json();

        // Update filters if the API returned new ones
        if (data.mergedFilters) {
          const newFilters: FiltersState = { ...filters, ...data.mergedFilters };
          setFilters(newFilters);
        }

        // Use a small delay so the listing count can settle after filter change
        await new Promise((r) => setTimeout(r, 50));

        const assistantMsg: ChatMessageData = {
          id: uid(),
          role: 'assistant',
          content: data.reply ?? 'Here are the matching listings.',
          parsedFilters: data.extractedCriteria ?? [],
          listingCount: data.listingCount ?? getListingCountRef.current(),
          timestamp: Date.now(),
        };
        addMessage(assistantMsg);

        // Update conversation metadata
        setConversation((prev) => {
          const now = Date.now();
          if (!prev) {
            return {
              id: data.conversationId ?? uid(),
              name: null,
              messages: [userMsg, assistantMsg],
              filters: data.mergedFilters ? { ...filters, ...data.mergedFilters } : filters,
              isSaved: false,
              createdAt: now,
              updatedAt: now,
            };
          }
          return {
            ...prev,
            messages: [...prev.messages, userMsg, assistantMsg],
            filters: data.mergedFilters ? { ...filters, ...data.mergedFilters } : filters,
            updatedAt: now,
          };
        });
        return true;
      } catch (err) {
        const errorMsg: ChatMessageData = {
          id: uid(),
          role: 'system',
          content: 'Something went wrong. Please try again.',
          timestamp: Date.now(),
        };
        addMessage(errorMsg);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [conversation, filters, addMessage, setFilters],
  );

  // ---------------------------------------------------------------------------
  // removeFilter
  // ---------------------------------------------------------------------------
  const removeFilter = useCallback(
    (key: keyof FiltersState) => {
      const defaultVal = getDefaultValue(key);
      const newFilters = { ...filters, [key]: defaultVal };
      setFilters(newFilters);

      // Build a human-readable label for the removed filter
      const labelMap: Record<keyof FiltersState, string> = {
        selectedBeds: 'bedrooms',
        minBaths: 'minimum baths',
        includeNaBaths: 'include N/A baths',
        minRent: 'minimum rent',
        maxRent: 'maximum rent',
        priceMode: 'price mode',
        sort: 'sort',
        maxListingAge: 'listing age',
        photosFirst: 'photos first',
        selectedSources: 'sources',
        minYearBuilt: 'minimum year built',
        maxYearBuilt: 'maximum year built',
        minSqft: 'minimum sqft',
        maxSqft: 'maximum sqft',
        excludeNoSqft: 'exclude no sqft',
        minAvailableDate: 'earliest move-in date',
        maxAvailableDate: 'latest move-in date',
        commuteRules: 'commute rules',
      };

      const sysMsg: ChatMessageData = {
        id: uid(),
        role: 'system',
        content: `\u2014 Removed '${labelMap[key] ?? key}' filter \u2014`,
        timestamp: Date.now(),
      };
      addMessage(sysMsg);
    },
    [filters, setFilters, addMessage],
  );

  // ---------------------------------------------------------------------------
  // reAddFilter
  // ---------------------------------------------------------------------------
  const reAddFilter = useCallback(
    (key: keyof FiltersState, value: FiltersState[keyof FiltersState]) => {
      const newFilters = { ...filters, [key]: value };
      setFilters(newFilters);

      const labelMap: Record<keyof FiltersState, string> = {
        selectedBeds: 'bedrooms',
        minBaths: 'minimum baths',
        includeNaBaths: 'include N/A baths',
        minRent: 'minimum rent',
        maxRent: 'maximum rent',
        priceMode: 'price mode',
        sort: 'sort',
        maxListingAge: 'listing age',
        photosFirst: 'photos first',
        selectedSources: 'sources',
        minYearBuilt: 'minimum year built',
        maxYearBuilt: 'maximum year built',
        minSqft: 'minimum sqft',
        maxSqft: 'maximum sqft',
        excludeNoSqft: 'exclude no sqft',
        minAvailableDate: 'earliest move-in date',
        maxAvailableDate: 'latest move-in date',
        commuteRules: 'commute rules',
      };

      const sysMsg: ChatMessageData = {
        id: uid(),
        role: 'system',
        content: `\u2014 Re-added '${labelMap[key] ?? key}' filter \u2014`,
        timestamp: Date.now(),
      };
      addMessage(sysMsg);
    },
    [filters, setFilters, addMessage],
  );

  // ---------------------------------------------------------------------------
  // saveConversation
  // ---------------------------------------------------------------------------
  const saveConversation = useCallback(
    async (name: string) => {
      if (!conversation) return;

      try {
        await fetch(`/api/conversations/${conversation.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, is_saved: true }),
        });

        setConversation((prev) =>
          prev ? { ...prev, name, isSaved: true, updatedAt: Date.now() } : prev,
        );
      } catch {
        // Silently fail — we can retry later
      }
    },
    [conversation],
  );

  // ---------------------------------------------------------------------------
  // loadConversation
  // ---------------------------------------------------------------------------
  const loadConversation = useCallback(
    async (id: string) => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/conversations/${id}`);
        if (!res.ok) throw new Error(`Failed to load conversation: ${res.status}`);
        const data = await res.json();

        // API returns { conversation: {...}, messages: [...] }
        const conv = data.conversation;
        const msgs: ChatMessageData[] = (data.messages ?? []).map((m: { id: string; role: string; content: string; parsed_filters?: ParsedFilter[]; created_at: string }) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          parsedFilters: m.parsed_filters ?? [],
          timestamp: new Date(m.created_at).getTime(),
        }));

        const conversation: Conversation = {
          id: conv.id,
          name: conv.name,
          messages: msgs,
          filters: conv.filters ?? DEFAULT_FILTERS,
          isSaved: conv.is_saved ?? false,
          createdAt: new Date(conv.created_at).getTime(),
          updatedAt: new Date(conv.updated_at).getTime(),
        };

        setConversation(conversation);
        setMessages(msgs);
        if (conv.filters) {
          setFilters(conv.filters as FiltersState);
        }
      } catch {
        // On failure, just keep current state
      } finally {
        setIsLoading(false);
      }
    },
    [setFilters],
  );

  // ---------------------------------------------------------------------------
  // newConversation
  // ---------------------------------------------------------------------------
  const newConversation = useCallback(() => {
    setConversation(null);
    setMessages([]);
    setFilters(DEFAULT_FILTERS);
  }, [setFilters]);

  return {
    conversation,
    messages,
    filters,
    isLoading,
    sendMessage,
    removeFilter,
    reAddFilter,
    saveConversation,
    loadConversation,
    newConversation,
  };
}
