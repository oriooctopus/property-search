'use client';

import type { FiltersState } from '@/components/Filters';

/** A single parsed criterion from the AI response */
export interface ParsedFilter {
  label: string;
  filterKey: keyof FiltersState;
  filterValue: FiltersState[keyof FiltersState];
}

/** A chat message in a conversation */
export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parsedFilters?: ParsedFilter[];
  listingCount?: number;
  timestamp: number;
}

/** A conversation summary for the sidebar */
export interface ConversationSummary {
  id: string;
  name: string | null;
  firstMessage: string;
  updatedAt: number;
  isSaved: boolean;
}

/** Full conversation data */
export interface Conversation {
  id: string;
  name: string | null;
  messages: ChatMessageData[];
  filters: FiltersState;
  isSaved: boolean;
  createdAt: number;
  updatedAt: number;
}
