import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, T } from './primitives';
import { C, R, S } from './theme';

/** Bottom sheet used for confirmations and short forms. Works the same on iOS, Android and web. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.62)' }} />
        <View style={{ backgroundColor: '#0A140E', borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, borderWidth: 1, borderColor: C.lineStrong, maxHeight: '88%', width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          <View style={{ alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: C.faint, marginTop: 10 }} />
          <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: insets.bottom + S.xl }} keyboardShouldPersistTaps="handled">
            <T v="h2" style={{ marginBottom: S.md }}>{title}</T>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Confirm({ visible, onClose, title, body, confirm, onConfirm, danger }: { visible: boolean; onClose: () => void; title: string; body: string; confirm: string; onConfirm: () => void; danger?: boolean }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <T style={{ marginBottom: S.xl }}>{body}</T>
      <Button title={confirm} kind={danger ? 'danger' : 'primary'} onPress={() => { onClose(); onConfirm(); }} />
      <Button title="Not now" kind="ghost" onPress={onClose} style={{ marginTop: S.md }} />
    </Sheet>
  );
}
