import React from 'react';
import { Image, View } from 'react-native';
import { initials } from '@/core/profile';
import type { User } from '@/db/repo';
import { T, Tap } from './primitives';
import { C, F } from './theme';

/** The user's own photo, or their initials — never a stock placeholder face. */
export function Avatar({ user, size = 46, onPress }: { user: Pick<User, 'photoUri' | 'name' | 'preferredName'> | null; size?: number; onPress?: () => void }) {
  const body = (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: C.forest2, borderWidth: 1, borderColor: C.lineStrong, alignItems: 'center', justifyContent: 'center' }}>
      {user?.photoUri
        ? <Image source={{ uri: user.photoUri }} style={{ width: size, height: size }} />
        : <T style={{ fontFamily: F.display, fontSize: size * 0.36, color: C.lime }}>{initials({ fullName: user?.name ?? null, preferredName: user?.preferredName ?? null })}</T>}
    </View>
  );
  return onPress ? <Tap onPress={onPress} label="Profile">{body}</Tap> : body;
}
