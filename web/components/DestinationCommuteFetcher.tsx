'use client';

import { useDestinationCommutes } from '@/lib/hooks/useDestinationCommutes';
import { useSavedDestination } from '@/lib/hooks/useSavedDestination';

interface DestinationCommuteFetcherProps {
  listings: Array<{ id: number; lat?: number | null; lon?: number | null }>;
}

/**
 * Headless component — mounted once at the page level. Reads the saved
 * destination from localStorage and triggers the per-listing OTP burst for
 * the currently visible listings. Cards subscribe to the resolved data via
 * `useListingDestinationCommute` so this component renders nothing.
 */
export default function DestinationCommuteFetcher({ listings }: DestinationCommuteFetcherProps) {
  const { destinations } = useSavedDestination();
  useDestinationCommutes(listings, destinations);
  return null;
}
