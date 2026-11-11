import { Redirect } from 'expo-router';
import React from 'react';
import { useApp } from '@/store';

export default function Index() {
  const onboarded = useApp((s) => s.user?.onboarded);
  const trek = useApp((s) => s.trek);
  if (!onboarded) return <Redirect href="/onboarding" />;
  // A trek that survived a restart takes the user straight back to it.
  return <Redirect href={trek ? '/(tabs)/trek' : '/(tabs)'} />;
}
